"""Import/export between HyQSim circuit format and bosonic qiskit Python code.

Uses Python's ast module for safe parsing (never executes user code).
"""

import ast
import math
import uuid
from typing import Optional

from .models import (
    Wire,
    WireType,
    CircuitElement,
    Position,
    ImportResponse,
    ExportResponse,
)

# ---------------------------------------------------------------------------
# Gate mapping tables
# ---------------------------------------------------------------------------

# Bosonic qiskit method name -> HyQSim gate info
IMPORT_MAP: dict[str, dict] = {
    # Single-qubit gates (no params)
    "h":   {"gateId": "h",   "wire": "qubit", "params": []},
    "x":   {"gateId": "x",   "wire": "qubit", "params": []},
    "y":   {"gateId": "y",   "wire": "qubit", "params": []},
    "z":   {"gateId": "z",   "wire": "qubit", "params": []},
    "s":   {"gateId": "s",   "wire": "qubit", "params": []},
    "sdg": {"gateId": "sdg", "wire": "qubit", "params": []},
    "t":   {"gateId": "t",   "wire": "qubit", "params": []},
    # Parameterized single-qubit gates
    "rx":  {"gateId": "rx",  "wire": "qubit", "params": ["theta"]},
    "ry":  {"gateId": "ry",  "wire": "qubit", "params": ["theta"]},
    "rz":  {"gateId": "rz",  "wire": "qubit", "params": ["theta"]},
    # Two-qubit gate
    "cx":  {"gateId": "cnot", "wire": "qubit2", "params": []},
    # Qumode gates
    "cv_d":    {"gateId": "displace", "wire": "qumode",  "params": ["alpha"]},
    "cv_sq":   {"gateId": "squeeze",  "wire": "qumode",  "params": ["z"]},
    "cv_r":    {"gateId": "rotate",   "wire": "qumode",  "params": ["theta"]},
    "cv_bs":   {"gateId": "bs",       "wire": "qumode2", "params": ["theta"]},
    "cv_kerr": {"gateId": "kerr",     "wire": "qumode",  "params": ["kappa"]},
    # Hybrid gates
    "cv_c_d":  {"gateId": "cdisp", "wire": "hybrid", "params": ["alpha"]},
    "cv_c_r":  {"gateId": "cr",    "wire": "hybrid", "params": ["theta"]},
}

# HyQSim gateId -> bosonic qiskit method info
EXPORT_MAP: dict[str, dict] = {
    "h":   {"method": "h",   "wire": "qubit", "params": []},
    "x":   {"method": "x",   "wire": "qubit", "params": []},
    "y":   {"method": "y",   "wire": "qubit", "params": []},
    "z":   {"method": "z",   "wire": "qubit", "params": []},
    "s":   {"method": "s",   "wire": "qubit", "params": []},
    "sdg": {"method": "sdg", "wire": "qubit", "params": []},
    "t":   {"method": "t",   "wire": "qubit", "params": []},
    "rx":  {"method": "rx",  "wire": "qubit", "params": ["theta"]},
    "ry":  {"method": "ry",  "wire": "qubit", "params": ["theta"]},
    "rz":  {"method": "rz",  "wire": "qubit", "params": ["theta"]},
    "cnot":     {"method": "cx",      "wire": "qubit2",  "params": []},
    "displace": {"method": "cv_d",    "wire": "qumode",  "params": ["alpha"]},
    "squeeze":  {"method": "cv_sq",   "wire": "qumode",  "params": ["z"]},
    "rotate":   {"method": "cv_r",    "wire": "qumode",  "params": ["theta"]},
    "bs":       {"method": "cv_bs",   "wire": "qumode2", "params": ["theta"]},
    "kerr":     {"method": "cv_kerr", "wire": "qumode",  "params": ["kappa"]},
    "cdisp":    {"method": "cv_c_d",  "wire": "hybrid",  "params": ["alpha"]},
    "cr":       {"method": "cv_c_r",  "wire": "hybrid",  "params": ["theta"]},
}

# Gate methods to silently skip during import (initialization, measurement, etc.)
SKIP_METHODS = {"cv_initialize", "measure", "barrier"}

# Spacing between gate columns on the canvas (in pixels)
GATE_X_SPACING = 60

# ---------------------------------------------------------------------------
# Safe numeric evaluator (operates on AST nodes, never executes code)
# ---------------------------------------------------------------------------

def _eval_numeric(node: ast.AST) -> complex | float:
    """Safely evaluate a numeric expression from an AST node."""
    if isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float, complex)):
            return node.value
        raise ValueError(f"Non-numeric constant: {node.value}")

    if isinstance(node, ast.UnaryOp):
        operand = _eval_numeric(node.operand)
        if isinstance(node.op, ast.USub):
            return -operand
        if isinstance(node.op, ast.UAdd):
            return +operand
        raise ValueError(f"Unsupported unary op: {type(node.op).__name__}")

    if isinstance(node, ast.BinOp):
        left = _eval_numeric(node.left)
        right = _eval_numeric(node.right)
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if isinstance(node.op, ast.Div):
            if right == 0:
                raise ValueError("Division by zero")
            return left / right
        if isinstance(node.op, ast.Pow):
            return left ** right
        raise ValueError(f"Unsupported binary op: {type(node.op).__name__}")

    # Handle np.pi, math.pi
    if isinstance(node, ast.Attribute):
        if isinstance(node.value, ast.Name) and node.attr == "pi":
            if node.value.id in ("np", "numpy", "math"):
                return math.pi
        if isinstance(node.value, ast.Name) and node.attr == "e":
            if node.value.id in ("np", "numpy", "math"):
                return math.e
        raise ValueError(f"Unsupported attribute: {ast.dump(node)}")

    # Handle pi as a bare name
    if isinstance(node, ast.Name):
        if node.id == "pi":
            return math.pi
        raise ValueError(f"Unsupported variable: {node.id}")

    # Handle complex(re, im) calls
    if isinstance(node, ast.Call):
        func_name = _get_call_name(node)
        if func_name == "complex":
            if len(node.args) == 2:
                re = _eval_numeric(node.args[0])
                im = _eval_numeric(node.args[1])
                return complex(float(re), float(im))
            if len(node.args) == 1:
                return complex(_eval_numeric(node.args[0]))
            raise ValueError("complex() expects 1 or 2 arguments")
        # np.exp / math.exp
        if func_name in ("np.exp", "numpy.exp", "math.exp", "cmath.exp"):
            arg = _eval_numeric(node.args[0])
            import cmath
            return cmath.exp(arg)
        # np.sqrt / math.sqrt
        if func_name in ("np.sqrt", "numpy.sqrt", "math.sqrt"):
            arg = _eval_numeric(node.args[0])
            import cmath
            return cmath.sqrt(arg)
        raise ValueError(f"Unsupported function call: {func_name}")

    raise ValueError(f"Cannot evaluate AST node: {ast.dump(node)}")


def _get_call_name(node: ast.Call) -> str:
    """Get the dotted name of a function call."""
    if isinstance(node.func, ast.Name):
        return node.func.id
    if isinstance(node.func, ast.Attribute):
        if isinstance(node.func.value, ast.Name):
            return f"{node.func.value.id}.{node.func.attr}"
        if isinstance(node.func.value, ast.Attribute):
            # e.g. c2qa.QumodeRegister
            if isinstance(node.func.value.value, ast.Name):
                return f"{node.func.value.value.id}.{node.func.value.attr}.{node.func.attr}"
    return ""


def _resolve_register_arg(node: ast.AST, register_vars: dict) -> Optional[tuple[str, int]]:
    """Resolve qbr[0] or qmr[1] to (register_name, index)."""
    if isinstance(node, ast.Subscript):
        if isinstance(node.value, ast.Name) and node.value.id in register_vars:
            reg_name = node.value.id
            if isinstance(node.slice, ast.Constant) and isinstance(node.slice.value, int):
                return (reg_name, node.slice.value)
    return None


# ---------------------------------------------------------------------------
# Parser: bosonic qiskit code -> HyQSim circuit
# ---------------------------------------------------------------------------

def parse_bosonic_qiskit(code: str) -> ImportResponse:
    """Parse bosonic qiskit Python code into HyQSim circuit data."""
    warnings: list[str] = []

    # Parse the source
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return ImportResponse(
            success=False,
            error=f"Python syntax error at line {e.lineno}: {e.msg}",
        )

    # Track register variables and their info
    # register_vars[var_name] = {"type": "qumode"|"qubit", "count": N}
    register_vars: dict[str, dict] = {}
    circuit_var: Optional[str] = None

    # First pass: find register declarations and circuit variable
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        if not node.targets or not isinstance(node.targets[0], ast.Name):
            continue

        var_name = node.targets[0].id
        value = node.value

        if isinstance(value, ast.Call):
            call_name = _get_call_name(value)

            # QumodeRegister
            if call_name in ("c2qa.QumodeRegister", "QumodeRegister"):
                num_qumodes = 1
                for kw in value.keywords:
                    if kw.arg == "num_qumodes":
                        try:
                            num_qumodes = int(_eval_numeric(kw.value))
                        except (ValueError, TypeError):
                            pass
                if value.args:
                    try:
                        num_qumodes = int(_eval_numeric(value.args[0]))
                    except (ValueError, TypeError):
                        pass
                register_vars[var_name] = {"type": "qumode", "count": num_qumodes}

            # QuantumRegister
            elif call_name in ("qiskit.QuantumRegister", "QuantumRegister"):
                num_qubits = 1
                if value.args:
                    try:
                        num_qubits = int(_eval_numeric(value.args[0]))
                    except (ValueError, TypeError):
                        pass
                register_vars[var_name] = {"type": "qubit", "count": num_qubits}

            # CVCircuit
            elif call_name in ("c2qa.CVCircuit", "CVCircuit"):
                circuit_var = var_name

    if not circuit_var:
        return ImportResponse(
            success=False,
            error="Could not find CVCircuit instantiation in the code.",
        )

    if not register_vars:
        return ImportResponse(
            success=False,
            error="Could not find QumodeRegister or QuantumRegister declarations.",
        )

    # Build wire list: qumodes first, then qubits (matching bosonic.py convention)
    wires: list[Wire] = []
    # Maps (register_var_name, index) -> wire array index
    wire_index_map: dict[tuple[str, int], int] = {}

    for reg_name, reg_info in register_vars.items():
        for i in range(reg_info["count"]):
            wire_idx = len(wires)
            wire_type = WireType.qumode if reg_info["type"] == "qumode" else WireType.qubit
            wires.append(Wire(
                id=f"wire-{uuid.uuid4().hex[:8]}",
                type=wire_type,
                index=wire_idx,
                initialState=0 if wire_type == WireType.qumode else "0",
            ))
            wire_index_map[(reg_name, i)] = wire_idx

    # Second pass: extract gate operations
    elements: list[CircuitElement] = []
    # Track next x position per wire for layout
    wire_column: dict[int, int] = {i: 0 for i in range(len(wires))}

    for node in ast.iter_child_nodes(tree):
        if not isinstance(node, ast.Expr):
            continue
        if not isinstance(node.value, ast.Call):
            continue

        call = node.value
        # Match circuit.<method>(...)
        if not (isinstance(call.func, ast.Attribute) and
                isinstance(call.func.value, ast.Name) and
                call.func.value.id == circuit_var):
            continue

        method_name = call.func.attr

        # Skip known non-gate methods
        if method_name in SKIP_METHODS:
            continue

        mapping = IMPORT_MAP.get(method_name)
        if not mapping:
            warnings.append(f"Skipped unrecognized method: {circuit_var}.{method_name}()")
            continue

        gate_id = mapping["gateId"]
        wire_type = mapping["wire"]
        param_names = mapping["params"]

        # Extract arguments
        try:
            if wire_type == "qubit":
                # method(qbr[i]) or method(param, qbr[i])
                param_values = _extract_qubit_gate_params(call, param_names, register_vars)
                reg_arg = _resolve_register_arg(call.args[-1], register_vars)
                if not reg_arg:
                    warnings.append(f"Could not resolve wire for {method_name}()")
                    continue
                wire_idx = wire_index_map.get(reg_arg)
                if wire_idx is None:
                    warnings.append(f"Register index out of bounds: {reg_arg[0]}[{reg_arg[1]}]")
                    continue
                col = wire_column[wire_idx]
                wire_column[wire_idx] = col + 1
                elements.append(CircuitElement(
                    id=f"el-{uuid.uuid4().hex[:8]}",
                    gateId=gate_id,
                    position=Position(x=col * GATE_X_SPACING + 30, y=0),
                    wireIndex=wire_idx,
                    parameterValues=param_values if param_values else None,
                ))

            elif wire_type == "qubit2":
                # cx(qbr[i], qbr[j])
                if len(call.args) < 2:
                    warnings.append(f"{method_name} requires 2 qubit arguments")
                    continue
                ctrl_arg = _resolve_register_arg(call.args[0], register_vars)
                tgt_arg = _resolve_register_arg(call.args[1], register_vars)
                if not ctrl_arg or not tgt_arg:
                    warnings.append(f"Could not resolve wires for {method_name}()")
                    continue
                ctrl_idx = wire_index_map.get(ctrl_arg)
                tgt_idx = wire_index_map.get(tgt_arg)
                if ctrl_idx is None or tgt_idx is None:
                    warnings.append(f"Register index out of bounds for {method_name}()")
                    continue
                col = max(wire_column[ctrl_idx], wire_column[tgt_idx])
                wire_column[ctrl_idx] = col + 1
                wire_column[tgt_idx] = col + 1
                elements.append(CircuitElement(
                    id=f"el-{uuid.uuid4().hex[:8]}",
                    gateId=gate_id,
                    position=Position(x=col * GATE_X_SPACING + 30, y=0),
                    wireIndex=ctrl_idx,
                    targetWireIndices=[tgt_idx],
                ))

            elif wire_type == "qumode":
                # cv_d(alpha, qmr[i]) or cv_r(theta, qmr[i])
                param_values = _extract_qumode_gate_params(call, param_names, gate_id, register_vars, warnings)
                reg_arg = _resolve_register_arg(call.args[-1], register_vars)
                if not reg_arg:
                    warnings.append(f"Could not resolve wire for {method_name}()")
                    continue
                wire_idx = wire_index_map.get(reg_arg)
                if wire_idx is None:
                    warnings.append(f"Register index out of bounds: {reg_arg[0]}[{reg_arg[1]}]")
                    continue
                col = wire_column[wire_idx]
                wire_column[wire_idx] = col + 1
                elements.append(CircuitElement(
                    id=f"el-{uuid.uuid4().hex[:8]}",
                    gateId=gate_id,
                    position=Position(x=col * GATE_X_SPACING + 30, y=0),
                    wireIndex=wire_idx,
                    parameterValues=param_values if param_values else None,
                ))

            elif wire_type == "qumode2":
                # cv_bs(theta, qmr[i], qmr[j])
                param_values = _extract_qumode_gate_params(call, param_names, gate_id, register_vars, warnings)
                if len(call.args) < 3:
                    warnings.append(f"{method_name} requires theta and 2 qumode arguments")
                    continue
                qm1_arg = _resolve_register_arg(call.args[-2], register_vars)
                qm2_arg = _resolve_register_arg(call.args[-1], register_vars)
                if not qm1_arg or not qm2_arg:
                    warnings.append(f"Could not resolve wires for {method_name}()")
                    continue
                qm1_idx = wire_index_map.get(qm1_arg)
                qm2_idx = wire_index_map.get(qm2_arg)
                if qm1_idx is None or qm2_idx is None:
                    warnings.append(f"Register index out of bounds for {method_name}()")
                    continue
                col = max(wire_column[qm1_idx], wire_column[qm2_idx])
                wire_column[qm1_idx] = col + 1
                wire_column[qm2_idx] = col + 1
                elements.append(CircuitElement(
                    id=f"el-{uuid.uuid4().hex[:8]}",
                    gateId=gate_id,
                    position=Position(x=col * GATE_X_SPACING + 30, y=0),
                    wireIndex=qm1_idx,
                    targetWireIndices=[qm2_idx],
                    parameterValues=param_values if param_values else None,
                ))

            elif wire_type == "hybrid":
                # cv_c_d(alpha, qmr[j], qbr[i]) or cv_c_r(theta, qmr[j], qbr[i])
                param_values = _extract_hybrid_gate_params(call, param_names, gate_id, register_vars, warnings)
                if len(call.args) < 3:
                    warnings.append(f"{method_name} requires param, qumode, and qubit arguments")
                    continue
                qm_arg = _resolve_register_arg(call.args[-2], register_vars)
                qb_arg = _resolve_register_arg(call.args[-1], register_vars)
                if not qm_arg or not qb_arg:
                    warnings.append(f"Could not resolve wires for {method_name}()")
                    continue
                qm_idx = wire_index_map.get(qm_arg)
                qb_idx = wire_index_map.get(qb_arg)
                if qm_idx is None or qb_idx is None:
                    warnings.append(f"Register index out of bounds for {method_name}()")
                    continue
                col = max(wire_column[qm_idx], wire_column[qb_idx])
                wire_column[qm_idx] = col + 1
                wire_column[qb_idx] = col + 1
                # HyQSim convention: qubit is primary wire, qumode is target
                elements.append(CircuitElement(
                    id=f"el-{uuid.uuid4().hex[:8]}",
                    gateId=gate_id,
                    position=Position(x=col * GATE_X_SPACING + 30, y=0),
                    wireIndex=qb_idx,
                    targetWireIndices=[qm_idx],
                    parameterValues=param_values if param_values else None,
                ))

        except Exception as e:
            warnings.append(f"Error processing {method_name}: {str(e)}")
            continue

    if not elements:
        warnings.append("No gate operations found in the code.")

    return ImportResponse(
        success=True,
        wires=wires,
        elements=elements,
        warnings=warnings,
    )


def _extract_qubit_gate_params(
    call: ast.Call,
    param_names: list[str],
    register_vars: dict,
) -> Optional[dict[str, float]]:
    """Extract parameters from a qubit gate call like rx(theta, qbr[0])."""
    if not param_names:
        return None
    params = {}
    for i, pname in enumerate(param_names):
        if i < len(call.args) - 1:  # last arg is the register
            try:
                val = _eval_numeric(call.args[i])
                params[pname] = float(val.real if isinstance(val, complex) else val)
            except ValueError:
                pass
    return params if params else None


def _extract_qumode_gate_params(
    call: ast.Call,
    param_names: list[str],
    gate_id: str,
    register_vars: dict,
    warnings: list[str],
) -> Optional[dict[str, float]]:
    """Extract parameters from a qumode gate call."""
    if not param_names:
        return None
    params = {}

    if gate_id == "displace" and "alpha" in param_names:
        # cv_d(alpha, qmr[0]) — alpha can be complex
        if call.args:
            try:
                val = _eval_numeric(call.args[0])
                if isinstance(val, complex):
                    params["alpha_re"] = round(val.real, 6)
                    params["alpha_im"] = round(val.imag, 6)
                else:
                    params["alpha_re"] = round(float(val), 6)
                    params["alpha_im"] = 0.0
            except ValueError:
                warnings.append("Could not evaluate alpha for displacement, using defaults")

    elif gate_id == "squeeze" and "z" in param_names:
        # cv_sq(z, qmr[0]) — z can be complex, r=|z|, phi=angle(z)
        if call.args:
            try:
                val = _eval_numeric(call.args[0])
                if isinstance(val, complex):
                    params["r"] = round(abs(val), 6)
                    import cmath
                    params["phi"] = round(cmath.phase(val), 6)
                else:
                    params["r"] = round(float(val), 6)
                    params["phi"] = 0.0
            except ValueError:
                warnings.append("Could not evaluate squeeze parameter, using defaults")

    elif gate_id in ("rotate", "kerr") and param_names:
        pname = "theta" if gate_id == "rotate" else "kappa"
        if call.args:
            try:
                val = _eval_numeric(call.args[0])
                params[pname] = round(float(val.real if isinstance(val, complex) else val), 6)
            except ValueError:
                warnings.append(f"Could not evaluate {pname}, using default")

    elif gate_id == "bs" and "theta" in param_names:
        # cv_bs(complex(theta), qmr[0], qmr[1])
        if call.args:
            try:
                val = _eval_numeric(call.args[0])
                params["theta"] = round(float(val.real if isinstance(val, complex) else val), 6)
            except ValueError:
                warnings.append("Could not evaluate beam splitter theta, using default")

    return params if params else None


def _extract_hybrid_gate_params(
    call: ast.Call,
    param_names: list[str],
    gate_id: str,
    register_vars: dict,
    warnings: list[str],
) -> Optional[dict[str, float]]:
    """Extract parameters from a hybrid gate call."""
    if not param_names:
        return None
    params = {}

    if gate_id == "cdisp" and "alpha" in param_names:
        # cv_c_d(alpha, qmr[0], qbr[0])
        if call.args:
            try:
                val = _eval_numeric(call.args[0])
                if isinstance(val, complex):
                    params["alpha_re"] = round(val.real, 6)
                    params["alpha_im"] = round(val.imag, 6)
                else:
                    params["alpha_re"] = round(float(val), 6)
                    params["alpha_im"] = 0.0
            except ValueError:
                warnings.append("Could not evaluate alpha for controlled displacement, using defaults")

    elif gate_id == "cr" and "theta" in param_names:
        # cv_c_r(theta, qmr[0], qbr[0])
        if call.args:
            try:
                val = _eval_numeric(call.args[0])
                params["theta"] = round(float(val.real if isinstance(val, complex) else val), 6)
            except ValueError:
                warnings.append("Could not evaluate theta for controlled rotation, using default")

    return params if params else None


# ---------------------------------------------------------------------------
# Generator: HyQSim circuit -> bosonic qiskit code
# ---------------------------------------------------------------------------

def _format_number(value: float) -> str:
    """Format a float nicely, detecting pi multiples."""
    if value == 0:
        return "0"

    # Check common pi multiples
    ratio = value / math.pi
    pi_fractions = {
        1.0: "np.pi",
        -1.0: "-np.pi",
        0.5: "np.pi / 2",
        -0.5: "-np.pi / 2",
        0.25: "np.pi / 4",
        -0.25: "-np.pi / 4",
        2.0: "2 * np.pi",
        -2.0: "-2 * np.pi",
    }
    for frac, expr in pi_fractions.items():
        if abs(ratio - frac) < 1e-9:
            return expr

    # General formatting
    rounded = round(value, 6)
    if rounded == int(rounded):
        return str(int(rounded))
    return str(rounded)


def _format_complex(re: float, im: float) -> str:
    """Format a complex number for code output."""
    if im == 0:
        return _format_number(re)
    if re == 0:
        return f"{_format_number(im)}j"
    return f"complex({_format_number(re)}, {_format_number(im)})"


def generate_bosonic_qiskit(
    wires: list[Wire],
    elements: list[CircuitElement],
    fock_truncation: int = 10,
) -> ExportResponse:
    """Generate bosonic qiskit Python code from HyQSim circuit data."""
    try:
        # Count wire types and build register index maps
        qumode_wires = [(i, w) for i, w in enumerate(wires) if w.type == WireType.qumode]
        qubit_wires = [(i, w) for i, w in enumerate(wires) if w.type == WireType.qubit]

        num_qumodes = len(qumode_wires)
        num_qubits = len(qubit_wires)

        if num_qumodes == 0 and num_qubits == 0:
            return ExportResponse(success=False, error="Circuit has no wires.")

        # Map wire array index -> register index
        qumode_reg_idx = {}  # wire_array_index -> qmr register index
        qubit_reg_idx = {}   # wire_array_index -> qbr register index
        for reg_i, (wire_arr_i, _) in enumerate(qumode_wires):
            qumode_reg_idx[wire_arr_i] = reg_i
        for reg_i, (wire_arr_i, _) in enumerate(qubit_wires):
            qubit_reg_idx[wire_arr_i] = reg_i

        # Compute num_qubits_per_qumode from fock_truncation
        num_qubits_per_qumode = max(1, int(math.log2(fock_truncation))) if fock_truncation > 0 else 4

        # Generate code
        lines: list[str] = []
        lines.append("import numpy as np")
        lines.append("import qiskit")
        lines.append("import c2qa")
        lines.append("")

        if num_qumodes > 0:
            lines.append(
                f"qmr = c2qa.QumodeRegister(num_qumodes={num_qumodes}, "
                f"num_qubits_per_qumode={num_qubits_per_qumode})"
            )
        if num_qubits > 0:
            lines.append(f"qbr = qiskit.QuantumRegister({num_qubits})")

        # Build CVCircuit args
        circuit_args = []
        if num_qumodes > 0:
            circuit_args.append("qmr")
        if num_qubits > 0:
            circuit_args.append("qbr")
        lines.append(f"circuit = c2qa.CVCircuit({', '.join(circuit_args)})")
        lines.append("")

        # Sort elements by position.x (left to right order)
        sorted_elements = sorted(elements, key=lambda e: e.position.x)

        for elem in sorted_elements:
            gate_id = elem.gateId
            mapping = EXPORT_MAP.get(gate_id)

            if not mapping:
                if gate_id in ("custom", "custom_cv", "custom_cvdv"):
                    lines.append(f"# Skipped custom generator gate (not representable in bosonic qiskit)")
                elif gate_id in ("annihilate", "create"):
                    lines.append(f"# Skipped non-unitary operator: {gate_id}")
                else:
                    lines.append(f"# Skipped unsupported gate: {gate_id}")
                continue

            method = mapping["method"]
            wire = mapping["wire"]
            params = elem.parameterValues or {}

            if wire == "qubit":
                qi = qubit_reg_idx.get(elem.wireIndex)
                if qi is None:
                    lines.append(f"# Skipped {gate_id}: wire {elem.wireIndex} is not a qubit")
                    continue
                if mapping["params"]:
                    theta = params.get("theta", 0)
                    lines.append(f"circuit.{method}({_format_number(theta)}, qbr[{qi}])")
                else:
                    lines.append(f"circuit.{method}(qbr[{qi}])")

            elif wire == "qubit2":
                qi_ctrl = qubit_reg_idx.get(elem.wireIndex)
                qi_tgt = qubit_reg_idx.get(
                    elem.targetWireIndices[0] if elem.targetWireIndices else -1
                )
                if qi_ctrl is None or qi_tgt is None:
                    lines.append(f"# Skipped {gate_id}: could not resolve qubit wires")
                    continue
                lines.append(f"circuit.{method}(qbr[{qi_ctrl}], qbr[{qi_tgt}])")

            elif wire == "qumode":
                mi = qumode_reg_idx.get(elem.wireIndex)
                if mi is None:
                    lines.append(f"# Skipped {gate_id}: wire {elem.wireIndex} is not a qumode")
                    continue
                param_str = _get_qumode_param_str(gate_id, params)
                if param_str:
                    lines.append(f"circuit.{method}({param_str}, qmr[{mi}])")
                else:
                    lines.append(f"circuit.{method}(qmr[{mi}])")

            elif wire == "qumode2":
                mi1 = qumode_reg_idx.get(elem.wireIndex)
                mi2 = qumode_reg_idx.get(
                    elem.targetWireIndices[0] if elem.targetWireIndices else -1
                )
                if mi1 is None or mi2 is None:
                    lines.append(f"# Skipped {gate_id}: could not resolve qumode wires")
                    continue
                param_str = _get_qumode_param_str(gate_id, params)
                if param_str:
                    lines.append(f"circuit.{method}({param_str}, qmr[{mi1}], qmr[{mi2}])")
                else:
                    lines.append(f"circuit.{method}(qmr[{mi1}], qmr[{mi2}])")

            elif wire == "hybrid":
                # HyQSim: wireIndex = qubit, targetWireIndices[0] = qumode
                qi = qubit_reg_idx.get(elem.wireIndex)
                mi = qumode_reg_idx.get(
                    elem.targetWireIndices[0] if elem.targetWireIndices else -1
                )
                if qi is None or mi is None:
                    lines.append(f"# Skipped {gate_id}: could not resolve hybrid wires")
                    continue
                param_str = _get_hybrid_param_str(gate_id, params)
                # bosonic qiskit: cv_c_d(alpha, qmr[j], qbr[i])
                lines.append(f"circuit.{method}({param_str}, qmr[{mi}], qbr[{qi}])")

        lines.append("")
        return ExportResponse(success=True, code="\n".join(lines))

    except Exception as e:
        return ExportResponse(success=False, error=str(e))


def _get_qumode_param_str(gate_id: str, params: dict[str, float]) -> str:
    """Format parameter string for a qumode gate."""
    if gate_id == "displace":
        re = params.get("alpha_re", 1.0)
        im = params.get("alpha_im", 0.0)
        return _format_complex(re, im)
    elif gate_id == "squeeze":
        r = params.get("r", 0.5)
        phi = params.get("phi", 0.0)
        if phi == 0:
            return _format_number(r)
        import cmath
        z = r * cmath.exp(1j * phi)
        return _format_complex(z.real, z.imag)
    elif gate_id == "rotate":
        return _format_number(params.get("theta", 0))
    elif gate_id == "kerr":
        return _format_number(params.get("kappa", 0))
    elif gate_id == "bs":
        theta = params.get("theta", 0)
        return f"complex({_format_number(theta)})"
    return ""


def _get_hybrid_param_str(gate_id: str, params: dict[str, float]) -> str:
    """Format parameter string for a hybrid gate."""
    if gate_id == "cdisp":
        re = params.get("alpha_re", 1.0)
        im = params.get("alpha_im", 0.0)
        return _format_complex(re, im)
    elif gate_id == "cr":
        return _format_number(params.get("theta", 0))
    return "0"
