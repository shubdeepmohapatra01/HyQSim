/**
 * Import/export between HyQSim circuit format and HybridLane (PennyLane) Python code.
 *
 * Runs entirely in the browser — no Python backend required.
 * Handles the decorator-based @qml.qnode pattern and dynamic wire type inference.
 */

import type { Wire, CircuitElement, ImportCircuitResponse, ExportCircuitResponse } from '../types/circuit';
import { evalNumericExpr, splitArgs, formatNumber, type ComplexVal } from './qiskitIO';

// ---------------------------------------------------------------------------
// Gate mapping tables
// ---------------------------------------------------------------------------

interface HLImportMapping {
  gateId: string;
  wire: 'qubit' | 'qubit2' | 'qumode' | 'qumode2' | 'hybrid';
  /** Parameter names in HyQSim for this gate */
  hyqsimParams: string[];
  /** How many positional params before the wires arg */
  numParams: number;
  /** Whether this gate needs polar→cartesian conversion for displacement params */
  polarToCartesian?: boolean;
}

// qml.* gates (PennyLane standard qubit gates)
const QML_IMPORT_MAP: Record<string, HLImportMapping> = {
  'Hadamard':  { gateId: 'h',    wire: 'qubit',  hyqsimParams: [], numParams: 0 },
  'H':         { gateId: 'h',    wire: 'qubit',  hyqsimParams: [], numParams: 0 },
  'PauliX':    { gateId: 'x',    wire: 'qubit',  hyqsimParams: [], numParams: 0 },
  'X':         { gateId: 'x',    wire: 'qubit',  hyqsimParams: [], numParams: 0 },
  'PauliY':    { gateId: 'y',    wire: 'qubit',  hyqsimParams: [], numParams: 0 },
  'Y':         { gateId: 'y',    wire: 'qubit',  hyqsimParams: [], numParams: 0 },
  'PauliZ':    { gateId: 'z',    wire: 'qubit',  hyqsimParams: [], numParams: 0 },
  'Z':         { gateId: 'z',    wire: 'qubit',  hyqsimParams: [], numParams: 0 },
  'S':         { gateId: 's',    wire: 'qubit',  hyqsimParams: [], numParams: 0 },
  'T':         { gateId: 't',    wire: 'qubit',  hyqsimParams: [], numParams: 0 },
  'RX':        { gateId: 'rx',   wire: 'qubit',  hyqsimParams: ['theta'], numParams: 1 },
  'RY':        { gateId: 'ry',   wire: 'qubit',  hyqsimParams: ['theta'], numParams: 1 },
  'RZ':        { gateId: 'rz',   wire: 'qubit',  hyqsimParams: ['theta'], numParams: 1 },
  'CNOT':      { gateId: 'cnot', wire: 'qubit2', hyqsimParams: [], numParams: 0 },
};

// hqml.* gates (HybridLane CV and hybrid gates)
const HQML_IMPORT_MAP: Record<string, HLImportMapping> = {
  // CV gates
  'Displacement': { gateId: 'displace', wire: 'qumode',  hyqsimParams: ['alpha_re', 'alpha_im'], numParams: 2, polarToCartesian: true },
  'D':            { gateId: 'displace', wire: 'qumode',  hyqsimParams: ['alpha_re', 'alpha_im'], numParams: 2, polarToCartesian: true },
  'Squeezing':    { gateId: 'squeeze',  wire: 'qumode',  hyqsimParams: ['r', 'phi'], numParams: 2 },
  'S':            { gateId: 'squeeze',  wire: 'qumode',  hyqsimParams: ['r', 'phi'], numParams: 2 },
  'Rotation':     { gateId: 'rotate',   wire: 'qumode',  hyqsimParams: ['theta'], numParams: 1 },
  'R':            { gateId: 'rotate',   wire: 'qumode',  hyqsimParams: ['theta'], numParams: 1 },
  'Beamsplitter': { gateId: 'bs',       wire: 'qumode2', hyqsimParams: ['theta', 'phi'], numParams: 2 },
  'BS':           { gateId: 'bs',       wire: 'qumode2', hyqsimParams: ['theta', 'phi'], numParams: 2 },
  'Kerr':         { gateId: 'kerr',     wire: 'qumode',  hyqsimParams: ['kappa'], numParams: 1 },
  'K':            { gateId: 'kerr',     wire: 'qumode',  hyqsimParams: ['kappa'], numParams: 1 },
  // Hybrid gates
  'ConditionalDisplacement': { gateId: 'cdisp', wire: 'hybrid', hyqsimParams: ['alpha_re', 'alpha_im'], numParams: 2, polarToCartesian: true },
  'CD':                      { gateId: 'cdisp', wire: 'hybrid', hyqsimParams: ['alpha_re', 'alpha_im'], numParams: 2, polarToCartesian: true },
  'ConditionalRotation':     { gateId: 'cr',    wire: 'hybrid', hyqsimParams: ['theta'], numParams: 1 },
  'CR':                      { gateId: 'cr',    wire: 'hybrid', hyqsimParams: ['theta'], numParams: 1 },
};

// Export mapping: HyQSim gate ID → hybridlane code generation info
interface HLExportMapping {
  prefix: 'qml' | 'hqml';
  method: string;
  wire: 'qubit' | 'qubit2' | 'qumode' | 'qumode2' | 'hybrid';
  /** How to format params for this gate */
  paramFormat: 'none' | 'theta' | 'displacement' | 'squeeze' | 'two_angle' | 'kappa';
}

const HL_EXPORT_MAP: Record<string, HLExportMapping> = {
  h:        { prefix: 'qml',  method: 'Hadamard', wire: 'qubit',   paramFormat: 'none' },
  x:        { prefix: 'qml',  method: 'PauliX',   wire: 'qubit',   paramFormat: 'none' },
  y:        { prefix: 'qml',  method: 'PauliY',   wire: 'qubit',   paramFormat: 'none' },
  z:        { prefix: 'qml',  method: 'PauliZ',   wire: 'qubit',   paramFormat: 'none' },
  s:        { prefix: 'qml',  method: 'S',         wire: 'qubit',   paramFormat: 'none' },
  sdg:      { prefix: 'qml',  method: 'adjoint(qml.S)', wire: 'qubit', paramFormat: 'none' },
  t:        { prefix: 'qml',  method: 'T',         wire: 'qubit',   paramFormat: 'none' },
  rx:       { prefix: 'qml',  method: 'RX',        wire: 'qubit',   paramFormat: 'theta' },
  ry:       { prefix: 'qml',  method: 'RY',        wire: 'qubit',   paramFormat: 'theta' },
  rz:       { prefix: 'qml',  method: 'RZ',        wire: 'qubit',   paramFormat: 'theta' },
  cnot:     { prefix: 'qml',  method: 'CNOT',      wire: 'qubit2',  paramFormat: 'none' },
  displace: { prefix: 'hqml', method: 'Displacement', wire: 'qumode',  paramFormat: 'displacement' },
  squeeze:  { prefix: 'hqml', method: 'Squeezing',    wire: 'qumode',  paramFormat: 'squeeze' },
  rotate:   { prefix: 'hqml', method: 'Rotation',     wire: 'qumode',  paramFormat: 'theta' },
  bs:       { prefix: 'hqml', method: 'Beamsplitter',  wire: 'qumode2', paramFormat: 'two_angle' },
  kerr:     { prefix: 'hqml', method: 'Kerr',          wire: 'qumode',  paramFormat: 'kappa' },
  cdisp:    { prefix: 'hqml', method: 'ConditionalDisplacement', wire: 'hybrid', paramFormat: 'displacement' },
  cr:       { prefix: 'hqml', method: 'ConditionalRotation',     wire: 'hybrid', paramFormat: 'theta' },
};

const GATE_X_SPACING = 60;

let _hlUid = 0;
function hlUid(prefix: string): string {
  return `${prefix}-hl-${++_hlUid}`;
}

// ---------------------------------------------------------------------------
// Parser: hybridlane code -> HyQSim circuit
// ---------------------------------------------------------------------------

/**
 * Parse a wire reference from hybridlane code.
 * Integer wires → qubit, string wires → qumode.
 */
function parseWireRef(s: string): { id: string; type: 'qubit' | 'qumode' } | null {
  const trimmed = s.trim();
  // Integer wire: 0, 1, 2, ...
  if (/^\d+$/.test(trimmed)) {
    return { id: trimmed, type: 'qubit' };
  }
  // String wire: "m0", "m", 'm1', etc.
  const strMatch = trimmed.match(/^["'](.+?)["']$/);
  if (strMatch) {
    return { id: strMatch[1], type: 'qumode' };
  }
  return null;
}

/**
 * Extract wires from a gate call's arguments.
 * Handles both: `wires=[0, "m"]` keyword and positional wire args.
 */
function extractWires(argsStr: string, numParams: number): { wireRefs: string[]; paramArgs: string[] } {
  const args = splitArgs(argsStr);

  // Look for wires= keyword argument
  for (let i = 0; i < args.length; i++) {
    const wiresMatch = args[i].match(/^wires\s*=\s*(.+)$/);
    if (wiresMatch) {
      const wiresVal = wiresMatch[1].trim();
      const paramArgs = args.slice(0, i);
      // List: [0, "m"] or [0, 1]
      const listMatch = wiresVal.match(/^\[(.+)\]$/);
      if (listMatch) {
        return { wireRefs: splitArgs(listMatch[1]), paramArgs };
      }
      // Single wire
      return { wireRefs: [wiresVal], paramArgs };
    }
  }

  // No wires= keyword found. Last arg(s) after params are wires.
  // For single-wire gates: last arg is wire
  // For multi-wire gates: last arg should be a list
  const paramArgs = args.slice(0, numParams);
  const wireArgs = args.slice(numParams);

  if (wireArgs.length === 1) {
    const listMatch = wireArgs[0].match(/^\[(.+)\]$/);
    if (listMatch) {
      return { wireRefs: splitArgs(listMatch[1]), paramArgs };
    }
    return { wireRefs: wireArgs, paramArgs };
  }

  return { wireRefs: wireArgs, paramArgs };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function parseHybridLane(code: string): ImportCircuitResponse {
  const warnings: string[] = [];
  const lines = code.split('\n');

  // Collect unique wires in order of first appearance
  const wireOrder: { id: string; type: 'qubit' | 'qumode' }[] = [];
  const wireSet = new Set<string>();

  function registerWire(id: string, type: 'qubit' | 'qumode'): number {
    const key = `${type}:${id}`;
    if (!wireSet.has(key)) {
      wireSet.add(key);
      wireOrder.push({ id, type });
    }
    return wireOrder.findIndex(w => `${w.type}:${w.id}` === key);
  }

  // Pattern for gate calls: prefix.GateName(args)
  // Matches both qml.X(0) and hqml.Displacement(0.5, 0, wires="m0")
  const qmlCallRe = /^\s*qml\.(\w+)\((.+)\)\s*$/;
  const hqmlCallRe = /^\s*hqml\.(\w+)\((.+)\)\s*$/;
  // Also match qml.adjoint(qml.S)(wire)
  const adjointRe = /^\s*qml\.adjoint\(qml\.(\w+)\)\((.+)\)\s*$/;

  // First pass: scan for gate calls to collect wires and build elements
  const elements: CircuitElement[] = [];
  const wireColumn: Record<number, number> = {};

  for (const rawLine of lines) {
    // Strip trailing inline comments (e.g.  # Vj beta_im), then split on semicolons
    // so that multi-statement lines like  qml.H(wires=1); qml.Z(wires=1)  are each processed.
    const noComment = rawLine.replace(/\s*#.*$/, '');
    const statements = noComment.split(';');

    for (const line of statements) {
    // Normalize: strip 'return' keyword and trailing comma (handles both single-line
    // returns and individual expval lines in multi-line return tuples).
    let trimmed = line.trim();
    if (trimmed.startsWith('return ')) trimmed = trimmed.slice('return '.length).trim();
    if (trimmed.endsWith(',')) trimmed = trimmed.slice(0, -1).trim();

    if (trimmed.startsWith('#') || trimmed.startsWith('import ') || trimmed.startsWith('from ') ||
        trimmed.startsWith('@') || trimmed.startsWith('def ') ||
        trimmed.startsWith('dev ') || trimmed.startsWith('dev=') || trimmed === '' ||
        trimmed === '(' || trimmed === ')' ||
        trimmed.startsWith('result')) {
      continue;
    }

    // Handle qml.expval() — place measurement gates based on observable basis:
    //   PauliZ  → measure
    //   PauliX  → H + measure
    //   PauliY  → S† + H + measure
    // hqml.expval(hqml.N(...)) (qumode expectation) is silently skipped.
    const expvalRe = /qml\.expval\(\s*qml\.(PauliZ|PauliX|PauliY)\s*\(\s*wires\s*=\s*(\d+)\s*\)\s*\)/g;
    let evm: RegExpExecArray | null;
    let foundExpval = false;
    while ((evm = expvalRe.exec(trimmed)) !== null) {
      foundExpval = true;
      const basis = evm[1];
      const wireNum = parseInt(evm[2], 10);
      const wireIdx = registerWire(String(wireNum), 'qubit');
      if (!(wireIdx in wireColumn)) wireColumn[wireIdx] = Math.max(0, ...Object.values(wireColumn));
      // Align measurements to the current circuit end (global max column)
      const col = Math.max(0, ...Object.values(wireColumn));
      if (basis === 'PauliX') {
        elements.push({ id: hlUid('el'), gateId: 'h',       position: { x: col * GATE_X_SPACING + 30,       y: 0 }, wireIndex: wireIdx });
        wireColumn[wireIdx] = col + 1;
        elements.push({ id: hlUid('el'), gateId: 'measure', position: { x: (col + 1) * GATE_X_SPACING + 30, y: 0 }, wireIndex: wireIdx });
        wireColumn[wireIdx] = col + 2;
      } else if (basis === 'PauliY') {
        elements.push({ id: hlUid('el'), gateId: 'sdg',     position: { x: col * GATE_X_SPACING + 30,       y: 0 }, wireIndex: wireIdx });
        wireColumn[wireIdx] = col + 1;
        elements.push({ id: hlUid('el'), gateId: 'h',       position: { x: (col + 1) * GATE_X_SPACING + 30, y: 0 }, wireIndex: wireIdx });
        wireColumn[wireIdx] = col + 2;
        elements.push({ id: hlUid('el'), gateId: 'measure', position: { x: (col + 2) * GATE_X_SPACING + 30, y: 0 }, wireIndex: wireIdx });
        wireColumn[wireIdx] = col + 3;
      } else {
        // PauliZ — bare measurement
        elements.push({ id: hlUid('el'), gateId: 'measure', position: { x: col * GATE_X_SPACING + 30,       y: 0 }, wireIndex: wireIdx });
        wireColumn[wireIdx] = col + 1;
      }
    }
    if (foundExpval) continue;

    // Check for adjoint pattern: qml.adjoint(qml.S)(wire)
    let adjM = trimmed.match(adjointRe);
    if (adjM) {
      const gateName = adjM[1];
      const argsStr = adjM[2];
      if (gateName === 'S') {
        // S-dagger
        const { wireRefs } = extractWires(argsStr, 0);
        if (wireRefs.length >= 1) {
          const wr = parseWireRef(wireRefs[0]);
          if (wr) {
            const wireIdx = registerWire(wr.id, wr.type);
            if (!(wireIdx in wireColumn)) wireColumn[wireIdx] = Math.max(0, ...Object.values(wireColumn));
            const col = wireColumn[wireIdx];
            wireColumn[wireIdx] = col + 1;
            elements.push({
              id: hlUid('el'),
              gateId: 'sdg',
              position: { x: col * GATE_X_SPACING + 30, y: 0 },
              wireIndex: wireIdx,
            });
          }
        }
      }
      continue;
    }

    // Check qml.* gates
    let m = trimmed.match(qmlCallRe);
    if (m) {
      const gateName = m[1];
      const argsStr = m[2];
      const mapping = QML_IMPORT_MAP[gateName];
      if (!mapping) {
        warnings.push(`Skipped unrecognized qml gate: qml.${gateName}()`);
        continue;
      }

      try {
        processGateCall(mapping, argsStr, elements, wireColumn, warnings, registerWire);
      } catch (e) {
        warnings.push(`Error processing qml.${gateName}: ${e instanceof Error ? e.message : String(e)}`);
      }
      continue;
    }

    // Check hqml.* gates
    m = trimmed.match(hqmlCallRe);
    if (m) {
      const gateName = m[1];
      const argsStr = m[2];
      const mapping = HQML_IMPORT_MAP[gateName];
      if (!mapping) {
        warnings.push(`Skipped unrecognized hqml gate: hqml.${gateName}()`);
        continue;
      }

      try {
        processGateCall(mapping, argsStr, elements, wireColumn, warnings, registerWire);
      } catch (e) {
        warnings.push(`Error processing hqml.${gateName}: ${e instanceof Error ? e.message : String(e)}`);
      }
      continue;
    }
    } // end for (const line of statements)
  } // end for (const rawLine of lines)

  // Reorder wires: qumodes first (by name), then qubits sorted by integer wire number.
  // Sorting qubits by integer ID preserves the original 0→1→2 ordering regardless of
  // which wire appears first in the code (e.g. the first CD gate may be on wire 2).
  const reordered = [
    ...wireOrder.filter(w => w.type === 'qumode').sort((a, b) => a.id.localeCompare(b.id)),
    ...wireOrder.filter(w => w.type === 'qubit').sort((a, b) => parseInt(a.id) - parseInt(b.id)),
  ];

  // Build old-index → new-index mapping and remap all element wireIndex / targetWireIndices
  const oldToNew = new Map<number, number>(
    wireOrder.map((w, oldIdx) => [
      oldIdx,
      reordered.findIndex(rw => rw.type === w.type && rw.id === w.id),
    ])
  );
  for (const elem of elements) {
    elem.wireIndex = oldToNew.get(elem.wireIndex) ?? elem.wireIndex;
    if (elem.targetWireIndices) {
      elem.targetWireIndices = elem.targetWireIndices.map(ti => oldToNew.get(ti) ?? ti);
    }
  }

  const wires: Wire[] = reordered.map((w, i) => ({
    id: hlUid('wire'),
    type: w.type,
    index: i,
    initialState: w.type === 'qumode' ? 0 as const : '0' as const,
  }));

  if (elements.length === 0) {
    warnings.push('No gate operations found in the code.');
  }

  return { success: true, wires, elements, warnings };
}

function processGateCall(
  mapping: HLImportMapping,
  argsStr: string,
  elements: CircuitElement[],
  wireColumn: Record<number, number>,
  warnings: string[],
  registerWire: (id: string, type: 'qubit' | 'qumode') => number,
): void {
  const { gateId, wire: wireType, hyqsimParams, numParams, polarToCartesian } = mapping;
  const { wireRefs, paramArgs } = extractWires(argsStr, numParams);

  // Evaluate parameters
  const paramVals: ComplexVal[] = [];
  for (const pArg of paramArgs) {
    try {
      paramVals.push(evalNumericExpr(pArg));
    } catch {
      paramVals.push({ re: 0, im: 0 });
    }
  }

  if (wireType === 'qubit') {
    if (wireRefs.length < 1) { warnings.push(`Missing wire for ${gateId}`); return; }
    const wr = parseWireRef(wireRefs[0]);
    if (!wr) { warnings.push(`Could not parse wire for ${gateId}`); return; }
    const wireIdx = registerWire(wr.id, 'qubit');
    if (!(wireIdx in wireColumn)) wireColumn[wireIdx] = Math.max(0, ...Object.values(wireColumn));

    let parameterValues: Record<string, number> | undefined;
    if (hyqsimParams.length > 0 && paramVals.length > 0) {
      parameterValues = {};
      for (let i = 0; i < hyqsimParams.length && i < paramVals.length; i++) {
        parameterValues[hyqsimParams[i]] = round6(paramVals[i].re);
      }
    }

    const col = wireColumn[wireIdx];
    wireColumn[wireIdx] = col + 1;
    elements.push({
      id: hlUid('el'),
      gateId,
      position: { x: col * GATE_X_SPACING + 30, y: 0 },
      wireIndex: wireIdx,
      parameterValues,
    });

  } else if (wireType === 'qubit2') {
    if (wireRefs.length < 2) { warnings.push(`CNOT requires 2 qubit wires`); return; }
    const wr0 = parseWireRef(wireRefs[0]);
    const wr1 = parseWireRef(wireRefs[1]);
    if (!wr0 || !wr1) { warnings.push(`Could not parse wires for CNOT`); return; }
    const ctrlIdx = registerWire(wr0.id, 'qubit');
    const tgtIdx = registerWire(wr1.id, 'qubit');
    if (!(ctrlIdx in wireColumn)) wireColumn[ctrlIdx] = Math.max(0, ...Object.values(wireColumn));
    if (!(tgtIdx in wireColumn)) wireColumn[tgtIdx] = Math.max(0, ...Object.values(wireColumn));

    // Use global max so the gate clears all single-qubit gates on intermediate wires
    const col = Math.max(...Object.values(wireColumn));
    for (const k in wireColumn) wireColumn[Number(k)] = col + 1;
    elements.push({
      id: hlUid('el'),
      gateId,
      position: { x: col * GATE_X_SPACING + 30, y: 0 },
      wireIndex: ctrlIdx,
      targetWireIndices: [tgtIdx],
    });

  } else if (wireType === 'qumode') {
    if (wireRefs.length < 1) { warnings.push(`Missing wire for ${gateId}`); return; }
    const wr = parseWireRef(wireRefs[0]);
    if (!wr) { warnings.push(`Could not parse wire for ${gateId}`); return; }
    const wireIdx = registerWire(wr.id, 'qumode');
    if (!(wireIdx in wireColumn)) wireColumn[wireIdx] = Math.max(0, ...Object.values(wireColumn));

    let parameterValues: Record<string, number> | undefined;
    if (hyqsimParams.length > 0 && paramVals.length > 0) {
      parameterValues = {};
      if (polarToCartesian && paramVals.length >= 2) {
        // Convert polar (a, phi) → cartesian (re, im)
        const a = paramVals[0].re;
        const phi = paramVals[1].re;
        parameterValues.alpha_re = round6(a * Math.cos(phi));
        parameterValues.alpha_im = round6(a * Math.sin(phi));
      } else {
        for (let i = 0; i < hyqsimParams.length && i < paramVals.length; i++) {
          parameterValues[hyqsimParams[i]] = round6(paramVals[i].re);
        }
      }
    }

    const col = wireColumn[wireIdx];
    wireColumn[wireIdx] = col + 1;
    elements.push({
      id: hlUid('el'),
      gateId,
      position: { x: col * GATE_X_SPACING + 30, y: 0 },
      wireIndex: wireIdx,
      parameterValues,
    });

  } else if (wireType === 'qumode2') {
    if (wireRefs.length < 2) { warnings.push(`${gateId} requires 2 qumode wires`); return; }
    const wr0 = parseWireRef(wireRefs[0]);
    const wr1 = parseWireRef(wireRefs[1]);
    if (!wr0 || !wr1) { warnings.push(`Could not parse wires for ${gateId}`); return; }
    const qm0Idx = registerWire(wr0.id, 'qumode');
    const qm1Idx = registerWire(wr1.id, 'qumode');
    if (!(qm0Idx in wireColumn)) wireColumn[qm0Idx] = Math.max(0, ...Object.values(wireColumn));
    if (!(qm1Idx in wireColumn)) wireColumn[qm1Idx] = Math.max(0, ...Object.values(wireColumn));

    let parameterValues: Record<string, number> | undefined;
    if (hyqsimParams.length > 0 && paramVals.length > 0) {
      parameterValues = {};
      for (let i = 0; i < hyqsimParams.length && i < paramVals.length; i++) {
        parameterValues[hyqsimParams[i]] = round6(paramVals[i].re);
      }
    }

    const col = Math.max(...Object.values(wireColumn));
    for (const k in wireColumn) wireColumn[Number(k)] = col + 1;
    elements.push({
      id: hlUid('el'),
      gateId,
      position: { x: col * GATE_X_SPACING + 30, y: 0 },
      wireIndex: qm0Idx,
      targetWireIndices: [qm1Idx],
      parameterValues,
    });

  } else if (wireType === 'hybrid') {
    // Hybrid gates: first wire(s) = qubit, last wire(s) = qumode
    if (wireRefs.length < 2) { warnings.push(`${gateId} requires qubit and qumode wires`); return; }
    const qbWr = parseWireRef(wireRefs[0]);
    const qmWr = parseWireRef(wireRefs[1]);
    if (!qbWr || !qmWr) { warnings.push(`Could not parse wires for ${gateId}`); return; }
    const qbIdx = registerWire(qbWr.id, 'qubit');
    const qmIdx = registerWire(qmWr.id, 'qumode');
    if (!(qbIdx in wireColumn)) wireColumn[qbIdx] = Math.max(0, ...Object.values(wireColumn));
    if (!(qmIdx in wireColumn)) wireColumn[qmIdx] = Math.max(0, ...Object.values(wireColumn));

    let parameterValues: Record<string, number> | undefined;
    if (hyqsimParams.length > 0 && paramVals.length > 0) {
      parameterValues = {};
      if (polarToCartesian && paramVals.length >= 2) {
        const a = paramVals[0].re;
        const phi = paramVals[1].re;
        parameterValues.alpha_re = round6(a * Math.cos(phi));
        parameterValues.alpha_im = round6(a * Math.sin(phi));
      } else {
        for (let i = 0; i < hyqsimParams.length && i < paramVals.length; i++) {
          parameterValues[hyqsimParams[i]] = round6(paramVals[i].re);
        }
      }
    }

    // Use global max so the CD gate clears all intermediate single-qubit gates visually
    const col = Math.max(...Object.values(wireColumn));
    for (const k in wireColumn) wireColumn[Number(k)] = col + 1;
    // HyQSim convention: qubit is primary wire, qumode is target
    elements.push({
      id: hlUid('el'),
      gateId,
      position: { x: col * GATE_X_SPACING + 30, y: 0 },
      wireIndex: qbIdx,
      targetWireIndices: [qmIdx],
      parameterValues,
    });
  }
}

// ---------------------------------------------------------------------------
// Generator: HyQSim circuit -> hybridlane code
// ---------------------------------------------------------------------------

export function generateHybridLane(
  wires: Wire[],
  elements: CircuitElement[],
  fockTruncation: number = 10,
): ExportCircuitResponse {
  try {
    const qumodeWires: [number, Wire][] = [];
    const qubitWires: [number, Wire][] = [];
    for (let i = 0; i < wires.length; i++) {
      if (wires[i].type === 'qumode') qumodeWires.push([i, wires[i]]);
      else qubitWires.push([i, wires[i]]);
    }

    if (qumodeWires.length === 0 && qubitWires.length === 0) {
      return { success: false, code: '', error: 'Circuit has no wires.' };
    }

    // Map wire array index → hybridlane wire identifier
    // Qubits: 0, 1, 2, ... (integers)
    // Qumodes: "m0", "m1", ... (strings)
    const wireId: Record<number, string> = {};
    qubitWires.forEach(([wireArrI], regI) => { wireId[wireArrI] = String(regI); });
    qumodeWires.forEach(([wireArrI], regI) => { wireId[wireArrI] = `"m${regI}"`; });

    const out: string[] = [];
    out.push('import numpy as np');
    out.push('import pennylane as qml');
    out.push('import hybridlane as hqml');
    out.push('');
    out.push(`dev = qml.device("bosonicqiskit.hybrid", max_fock_level=${fockTruncation})`);
    out.push('');
    out.push('@qml.qnode(dev)');
    out.push('def circuit():');

    const sorted = [...elements].sort((a, b) => a.position.x - b.position.x);
    let hasGates = false;

    for (const elem of sorted) {
      const mapping = HL_EXPORT_MAP[elem.gateId];
      if (!mapping) {
        if (['custom', 'custom_cv', 'custom_cvdv'].includes(elem.gateId)) {
          out.push('    # Skipped custom generator gate (not representable in hybridlane)');
        } else {
          out.push(`    # Skipped unsupported gate: ${elem.gateId}`);
        }
        continue;
      }

      hasGates = true;
      const { prefix, method, wire, paramFormat } = mapping;
      const params = elem.parameterValues || {};

      const paramStr = formatParams(paramFormat, params);

      if (wire === 'qubit') {
        const wId = wireId[elem.wireIndex];
        if (wId === undefined) { out.push(`    # Skipped ${elem.gateId}: wire not found`); continue; }
        if (method === 'adjoint(qml.S)') {
          out.push(`    qml.adjoint(qml.S)(wires=${wId})`);
        } else if (paramStr) {
          out.push(`    ${prefix}.${method}(${paramStr}, wires=${wId})`);
        } else {
          out.push(`    ${prefix}.${method}(wires=${wId})`);
        }

      } else if (wire === 'qubit2') {
        const wCtrl = wireId[elem.wireIndex];
        const wTgt = wireId[elem.targetWireIndices?.[0] ?? -1];
        if (wCtrl === undefined || wTgt === undefined) { out.push(`    # Skipped ${elem.gateId}: wires not found`); continue; }
        out.push(`    ${prefix}.${method}(wires=[${wCtrl}, ${wTgt}])`);

      } else if (wire === 'qumode') {
        const wId = wireId[elem.wireIndex];
        if (wId === undefined) { out.push(`    # Skipped ${elem.gateId}: wire not found`); continue; }
        if (paramStr) {
          out.push(`    ${prefix}.${method}(${paramStr}, wires=${wId})`);
        } else {
          out.push(`    ${prefix}.${method}(wires=${wId})`);
        }

      } else if (wire === 'qumode2') {
        const w0 = wireId[elem.wireIndex];
        const w1 = wireId[elem.targetWireIndices?.[0] ?? -1];
        if (w0 === undefined || w1 === undefined) { out.push(`    # Skipped ${elem.gateId}: wires not found`); continue; }
        if (paramStr) {
          out.push(`    ${prefix}.${method}(${paramStr}, wires=[${w0}, ${w1}])`);
        } else {
          out.push(`    ${prefix}.${method}(wires=[${w0}, ${w1}])`);
        }

      } else if (wire === 'hybrid') {
        const wQb = wireId[elem.wireIndex];
        const wQm = wireId[elem.targetWireIndices?.[0] ?? -1];
        if (wQb === undefined || wQm === undefined) { out.push(`    # Skipped ${elem.gateId}: wires not found`); continue; }
        if (paramStr) {
          out.push(`    ${prefix}.${method}(${paramStr}, wires=[${wQb}, ${wQm}])`);
        } else {
          out.push(`    ${prefix}.${method}(wires=[${wQb}, ${wQm}])`);
        }
      }
    }

    if (!hasGates) {
      out.push('    pass');
    }

    // Generate return statement with measurements
    const returnParts: string[] = [];
    for (const [, regI] of qubitWires.map(([wireArrI], regI) => [wireArrI, regI] as [number, number])) {
      returnParts.push(`qml.expval(qml.PauliZ(wires=${regI}))`);
    }
    for (const [, regI] of qumodeWires.map(([wireArrI], regI) => [wireArrI, regI] as [number, number])) {
      returnParts.push(`hqml.expval(hqml.N(wires="m${regI}"))`);
    }
    if (returnParts.length > 0) {
      out.push(`    return ${returnParts.join(', ')}`);
    }

    out.push('');
    return { success: true, code: out.join('\n') };
  } catch (e) {
    return { success: false, code: '', error: e instanceof Error ? e.message : String(e) };
  }
}

function formatParams(format: string, params: Record<string, number>): string {
  switch (format) {
    case 'none':
      return '';
    case 'theta':
      return formatNumber(params.theta ?? 0);
    case 'displacement': {
      // Convert cartesian (re, im) → polar (a, phi) for hybridlane
      const re = params.alpha_re ?? 1.0;
      const im = params.alpha_im ?? 0.0;
      const a = Math.sqrt(re * re + im * im);
      const phi = Math.atan2(im, re);
      return `${formatNumber(a)}, ${formatNumber(phi)}`;
    }
    case 'squeeze':
      return `${formatNumber(params.r ?? 0.5)}, ${formatNumber(params.phi ?? 0)}`;
    case 'two_angle':
      return `${formatNumber(params.theta ?? 0)}, ${formatNumber(params.phi ?? 0)}`;
    case 'kappa':
      return formatNumber(params.kappa ?? 0);
    default:
      return '';
  }
}
