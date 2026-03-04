/**
 * Import/export between HyQSim circuit format and bosonic qiskit Python code.
 *
 * Runs entirely in the browser — no Python backend required.
 * Uses regex-based line parsing + a small recursive-descent expression evaluator.
 */

import type { Wire, CircuitElement, ImportCircuitResponse, ExportCircuitResponse } from '../types/circuit';

// ---------------------------------------------------------------------------
// Gate mapping tables
// ---------------------------------------------------------------------------

interface ImportMapping {
  gateId: string;
  wire: 'qubit' | 'qubit2' | 'qumode' | 'qumode2' | 'hybrid';
  params: string[];
}

const IMPORT_MAP: Record<string, ImportMapping> = {
  h:   { gateId: 'h',   wire: 'qubit', params: [] },
  x:   { gateId: 'x',   wire: 'qubit', params: [] },
  y:   { gateId: 'y',   wire: 'qubit', params: [] },
  z:   { gateId: 'z',   wire: 'qubit', params: [] },
  s:   { gateId: 's',   wire: 'qubit', params: [] },
  sdg: { gateId: 'sdg', wire: 'qubit', params: [] },
  t:   { gateId: 't',   wire: 'qubit', params: [] },
  rx:  { gateId: 'rx',  wire: 'qubit', params: ['theta'] },
  ry:  { gateId: 'ry',  wire: 'qubit', params: ['theta'] },
  rz:  { gateId: 'rz',  wire: 'qubit', params: ['theta'] },
  cx:  { gateId: 'cnot', wire: 'qubit2', params: [] },
  cv_d:    { gateId: 'displace', wire: 'qumode',  params: ['alpha'] },
  cv_sq:   { gateId: 'squeeze',  wire: 'qumode',  params: ['z'] },
  cv_r:    { gateId: 'rotate',   wire: 'qumode',  params: ['theta'] },
  cv_bs:   { gateId: 'bs',       wire: 'qumode2', params: ['theta'] },
  cv_kerr: { gateId: 'kerr',     wire: 'qumode',  params: ['kappa'] },
  cv_c_d:  { gateId: 'cdisp', wire: 'hybrid', params: ['alpha'] },
  cv_c_r:  { gateId: 'cr',    wire: 'hybrid', params: ['theta'] },
};

interface ExportMapping {
  method: string;
  wire: 'qubit' | 'qubit2' | 'qumode' | 'qumode2' | 'hybrid';
  params: string[];
}

const EXPORT_MAP: Record<string, ExportMapping> = {
  h:   { method: 'h',   wire: 'qubit', params: [] },
  x:   { method: 'x',   wire: 'qubit', params: [] },
  y:   { method: 'y',   wire: 'qubit', params: [] },
  z:   { method: 'z',   wire: 'qubit', params: [] },
  s:   { method: 's',   wire: 'qubit', params: [] },
  sdg: { method: 'sdg', wire: 'qubit', params: [] },
  t:   { method: 't',   wire: 'qubit', params: [] },
  rx:  { method: 'rx',  wire: 'qubit', params: ['theta'] },
  ry:  { method: 'ry',  wire: 'qubit', params: ['theta'] },
  rz:  { method: 'rz',  wire: 'qubit', params: ['theta'] },
  cnot:     { method: 'cx',      wire: 'qubit2',  params: [] },
  displace: { method: 'cv_d',    wire: 'qumode',  params: ['alpha'] },
  squeeze:  { method: 'cv_sq',   wire: 'qumode',  params: ['z'] },
  rotate:   { method: 'cv_r',    wire: 'qumode',  params: ['theta'] },
  bs:       { method: 'cv_bs',   wire: 'qumode2', params: ['theta'] },
  kerr:     { method: 'cv_kerr', wire: 'qumode',  params: ['kappa'] },
  cdisp:    { method: 'cv_c_d',  wire: 'hybrid',  params: ['alpha'] },
  cr:       { method: 'cv_c_r',  wire: 'hybrid',  params: ['theta'] },
};

const SKIP_METHODS = new Set(['cv_initialize', 'measure', 'barrier']);
const GATE_X_SPACING = 60;

// ---------------------------------------------------------------------------
// Numeric expression evaluator
// ---------------------------------------------------------------------------

type ExprTokenType = 'NUM' | 'IDENT' | 'OP' | 'LPAREN' | 'RPAREN' | 'COMMA' | 'END';
interface ExprToken { type: ExprTokenType; value: string; }

function tokenizeExpr(s: string): ExprToken[] {
  const tokens: ExprToken[] = [];
  let i = 0;
  s = s.trim();

  while (i < s.length) {
    // Skip whitespace
    if (/\s/.test(s[i])) { i++; continue; }

    // Number (including imaginary suffix j)
    if (/[0-9.]/.test(s[i])) {
      let num = '';
      while (i < s.length && /[0-9.eE+-]/.test(s[i]) && !(s[i] === '-' && num.length > 0 && !/[eE]/.test(num[num.length - 1])) && !(s[i] === '+' && num.length > 0 && !/[eE]/.test(num[num.length - 1]))) {
        num += s[i++];
      }
      if (i < s.length && s[i] === 'j') {
        i++;
        tokens.push({ type: 'NUM', value: num + 'j' });
      } else {
        tokens.push({ type: 'NUM', value: num });
      }
      continue;
    }

    // Identifiers (dotted names like np.pi)
    if (/[a-zA-Z_]/.test(s[i])) {
      let ident = '';
      while (i < s.length && /[a-zA-Z_0-9.]/.test(s[i])) {
        ident += s[i++];
      }
      // Check for standalone j (imaginary unit)
      if (ident === 'j') {
        tokens.push({ type: 'NUM', value: '1j' });
      } else {
        tokens.push({ type: 'IDENT', value: ident });
      }
      continue;
    }

    if (s[i] === '(') { tokens.push({ type: 'LPAREN', value: '(' }); i++; continue; }
    if (s[i] === ')') { tokens.push({ type: 'RPAREN', value: ')' }); i++; continue; }
    if (s[i] === ',') { tokens.push({ type: 'COMMA', value: ',' }); i++; continue; }

    // ** (power) must be checked before single *
    if (s[i] === '*' && i + 1 < s.length && s[i + 1] === '*') {
      tokens.push({ type: 'OP', value: '**' }); i += 2; continue;
    }
    if ('+-*/'.includes(s[i])) {
      tokens.push({ type: 'OP', value: s[i] }); i++; continue;
    }

    throw new Error(`Unexpected character in expression: ${s[i]}`);
  }

  tokens.push({ type: 'END', value: '' });
  return tokens;
}

export interface ComplexVal { re: number; im: number; }

const KNOWN_CONSTANTS: Record<string, number> = {
  'np.pi': Math.PI, 'numpy.pi': Math.PI, 'math.pi': Math.PI, 'pi': Math.PI,
  'np.e': Math.E, 'numpy.e': Math.E, 'math.e': Math.E,
};

const KNOWN_FUNCTIONS = new Set([
  'complex', 'np.exp', 'numpy.exp', 'math.exp', 'cmath.exp',
  'np.sqrt', 'numpy.sqrt', 'math.sqrt',
]);

export function evalNumericExpr(exprStr: string): ComplexVal {
  const tokens = tokenizeExpr(exprStr);
  let pos = 0;

  function current(): ExprToken { return tokens[pos]; }
  function consume(): ExprToken { return tokens[pos++]; }

  function cv(re: number, im = 0): ComplexVal { return { re, im }; }

  function cAdd(a: ComplexVal, b: ComplexVal): ComplexVal { return { re: a.re + b.re, im: a.im + b.im }; }
  function cSub(a: ComplexVal, b: ComplexVal): ComplexVal { return { re: a.re - b.re, im: a.im - b.im }; }
  function cMul(a: ComplexVal, b: ComplexVal): ComplexVal {
    return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
  }
  function cDiv(a: ComplexVal, b: ComplexVal): ComplexVal {
    const d = b.re * b.re + b.im * b.im;
    if (d === 0) throw new Error('Division by zero');
    return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
  }
  function cExp(a: ComplexVal): ComplexVal {
    const r = Math.exp(a.re);
    return { re: r * Math.cos(a.im), im: r * Math.sin(a.im) };
  }
  function cSqrt(a: ComplexVal): ComplexVal {
    const r = Math.sqrt(a.re * a.re + a.im * a.im);
    const angle = Math.atan2(a.im, a.re);
    const sr = Math.sqrt(r);
    return { re: sr * Math.cos(angle / 2), im: sr * Math.sin(angle / 2) };
  }
  function cPow(a: ComplexVal, b: ComplexVal): ComplexVal {
    if (a.re === 0 && a.im === 0) return cv(0);
    const r = Math.sqrt(a.re * a.re + a.im * a.im);
    const theta = Math.atan2(a.im, a.re);
    const logR = Math.log(r);
    // a^b = exp(b * ln(a)) where ln(a) = logR + i*theta
    const lnA: ComplexVal = { re: logR, im: theta };
    return cExp(cMul(b, lnA));
  }

  // Grammar: expr = term (('+' | '-') term)*
  function parseExpr(): ComplexVal {
    let result = parseTerm();
    while (current().type === 'OP' && (current().value === '+' || current().value === '-')) {
      const op = consume().value;
      const right = parseTerm();
      result = op === '+' ? cAdd(result, right) : cSub(result, right);
    }
    return result;
  }

  // term = unary (('*' | '/') unary)*
  function parseTerm(): ComplexVal {
    let result = parseUnary();
    while (current().type === 'OP' && (current().value === '*' || current().value === '/')) {
      const op = consume().value;
      const right = parseUnary();
      result = op === '*' ? cMul(result, right) : cDiv(result, right);
    }
    return result;
  }

  // unary = '-' unary | '+' unary | power
  function parseUnary(): ComplexVal {
    if (current().type === 'OP' && current().value === '-') {
      consume();
      const val = parseUnary();
      return { re: -val.re, im: -val.im };
    }
    if (current().type === 'OP' && current().value === '+') {
      consume();
      return parseUnary();
    }
    return parsePower();
  }

  // power = atom ('**' unary)?
  function parsePower(): ComplexVal {
    const base = parseAtom();
    if (current().type === 'OP' && current().value === '**') {
      consume();
      const exp = parseUnary();
      return cPow(base, exp);
    }
    return base;
  }

  // atom = NUM | IDENT | funcall | '(' expr ')'
  function parseAtom(): ComplexVal {
    const tok = current();

    if (tok.type === 'NUM') {
      consume();
      const v = tok.value;
      if (v.endsWith('j')) {
        const num = v.slice(0, -1);
        return cv(0, num === '' || num === '+' ? 1 : num === '-' ? -1 : parseFloat(num));
      }
      return cv(parseFloat(v));
    }

    if (tok.type === 'IDENT') {
      // Check if it's a function call
      if (tokens[pos + 1]?.type === 'LPAREN' && KNOWN_FUNCTIONS.has(tok.value)) {
        const funcName = consume().value; // consume ident
        consume(); // consume '('
        const args: ComplexVal[] = [];
        if (current().type !== 'RPAREN') {
          args.push(parseExpr());
          while (current().type === 'COMMA') {
            consume(); // consume ','
            args.push(parseExpr());
          }
        }
        if (current().type !== 'RPAREN') throw new Error('Expected )');
        consume(); // consume ')'

        if (funcName === 'complex') {
          if (args.length === 2) return { re: args[0].re, im: args[1].re };
          if (args.length === 1) return args[0];
          throw new Error('complex() expects 1 or 2 arguments');
        }
        if (['np.exp', 'numpy.exp', 'math.exp', 'cmath.exp'].includes(funcName)) {
          if (args.length !== 1) throw new Error(`${funcName}() expects 1 argument`);
          return cExp(args[0]);
        }
        if (['np.sqrt', 'numpy.sqrt', 'math.sqrt'].includes(funcName)) {
          if (args.length !== 1) throw new Error(`${funcName}() expects 1 argument`);
          return cSqrt(args[0]);
        }
        throw new Error(`Unknown function: ${funcName}`);
      }

      // Known constant
      const constVal = KNOWN_CONSTANTS[tok.value];
      if (constVal !== undefined) {
        consume();
        return cv(constVal);
      }

      throw new Error(`Unknown identifier: ${tok.value}`);
    }

    if (tok.type === 'LPAREN') {
      consume();
      const result = parseExpr();
      if (current().type !== 'RPAREN') throw new Error('Expected )');
      consume();
      return result;
    }

    throw new Error(`Unexpected token: ${tok.type} "${tok.value}"`);
  }

  const result = parseExpr();
  if (current().type !== 'END') {
    throw new Error(`Unexpected token after expression: ${current().value}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

let _ioUid = 0;
function ioUid(prefix: string): string {
  return `${prefix}-io-${++_ioUid}`;
}

/** Split arguments on commas, respecting parentheses nesting. */
export function splitArgs(argsStr: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of argsStr) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

/** Check if a string looks like a register reference: varName[index] */
const REG_REF_RE = /^(\w+)\[(\d+)\]$/;

function parseRegRef(s: string): { name: string; index: number } | null {
  const m = s.match(REG_REF_RE);
  return m ? { name: m[1], index: parseInt(m[2], 10) } : null;
}

// ---------------------------------------------------------------------------
// Parser: bosonic qiskit code -> HyQSim circuit
// ---------------------------------------------------------------------------

export function parseBosonicQiskit(code: string): ImportCircuitResponse {
  const warnings: string[] = [];
  const lines = code.split('\n');

  // Register info: { type: 'qumode' | 'qubit', count: N }
  const registerVars: Record<string, { type: 'qumode' | 'qubit'; count: number }> = {};
  let circuitVar: string | null = null;

  // Pass 1: Find register declarations and circuit variable
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed === '') continue;

    // QumodeRegister: qmr = c2qa.QumodeRegister(num_qumodes=2, ...)
    let m = trimmed.match(/^(\w+)\s*=\s*(?:\w+\.)?QumodeRegister\s*\((.+)\)/);
    if (m) {
      const varName = m[1];
      const argsStr = m[2];
      let numQumodes = 1;
      // Try keyword: num_qumodes=N
      const kwMatch = argsStr.match(/num_qumodes\s*=\s*(\d+)/);
      if (kwMatch) {
        numQumodes = parseInt(kwMatch[1], 10);
      } else {
        // Try positional first arg
        const firstArg = splitArgs(argsStr)[0];
        if (firstArg && /^\d+$/.test(firstArg.trim())) {
          numQumodes = parseInt(firstArg.trim(), 10);
        }
      }
      registerVars[varName] = { type: 'qumode', count: numQumodes };
      continue;
    }

    // QuantumRegister: qbr = qiskit.QuantumRegister(2)
    m = trimmed.match(/^(\w+)\s*=\s*(?:\w+\.)?QuantumRegister\s*\((.+)\)/);
    if (m) {
      const varName = m[1];
      const argsStr = m[2];
      let numQubits = 1;
      const firstArg = splitArgs(argsStr)[0];
      if (firstArg && /^\d+$/.test(firstArg.trim())) {
        numQubits = parseInt(firstArg.trim(), 10);
      }
      registerVars[varName] = { type: 'qubit', count: numQubits };
      continue;
    }

    // CVCircuit: circuit = c2qa.CVCircuit(qmr, qbr)
    m = trimmed.match(/^(\w+)\s*=\s*(?:\w+\.)?CVCircuit\s*\(/);
    if (m) {
      circuitVar = m[1];
      continue;
    }
  }

  if (!circuitVar) {
    return { success: false, wires: [], elements: [], error: 'Could not find CVCircuit instantiation in the code.', warnings: [] };
  }
  if (Object.keys(registerVars).length === 0) {
    return { success: false, wires: [], elements: [], error: 'Could not find QumodeRegister or QuantumRegister declarations.', warnings: [] };
  }

  // Build wire list: iterate registers in declaration order
  const wires: Wire[] = [];
  const wireIndexMap: Record<string, number> = {}; // "regName,index" -> wire array index

  for (const [regName, regInfo] of Object.entries(registerVars)) {
    for (let i = 0; i < regInfo.count; i++) {
      const wireIdx = wires.length;
      wires.push({
        id: ioUid('wire'),
        type: regInfo.type,
        index: wireIdx,
        initialState: regInfo.type === 'qumode' ? 0 : '0',
      });
      wireIndexMap[`${regName},${i}`] = wireIdx;
    }
  }

  // Pass 2: Extract gate operations
  const elements: CircuitElement[] = [];
  const wireColumn: Record<number, number> = {};
  for (let i = 0; i < wires.length; i++) wireColumn[i] = 0;

  // Match: circuitVar.methodName(args)
  const gateCallRe = new RegExp(`^${circuitVar}\\.(\\w+)\\((.*)\\)\\s*$`);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed === '') continue;

    const gm = trimmed.match(gateCallRe);
    if (!gm) continue;

    const methodName = gm[1];
    const argsStr = gm[2];

    if (SKIP_METHODS.has(methodName)) continue;

    const mapping = IMPORT_MAP[methodName];
    if (!mapping) {
      warnings.push(`Skipped unrecognized method: ${circuitVar}.${methodName}()`);
      continue;
    }

    const { gateId, wire: wireType, params: paramNames } = mapping;
    const args = splitArgs(argsStr);

    try {
      if (wireType === 'qubit') {
        const regRef = parseRegRef(args[args.length - 1]);
        if (!regRef) { warnings.push(`Could not resolve wire for ${methodName}()`); continue; }
        const wireIdx = wireIndexMap[`${regRef.name},${regRef.index}`];
        if (wireIdx === undefined) { warnings.push(`Register index out of bounds: ${regRef.name}[${regRef.index}]`); continue; }

        let paramValues: Record<string, number> | undefined;
        if (paramNames.length > 0) {
          paramValues = {};
          for (let i = 0; i < paramNames.length && i < args.length - 1; i++) {
            try {
              const val = evalNumericExpr(args[i]);
              paramValues[paramNames[i]] = val.re;
            } catch { /* use default */ }
          }
          if (Object.keys(paramValues).length === 0) paramValues = undefined;
        }

        const col = wireColumn[wireIdx];
        wireColumn[wireIdx] = col + 1;
        elements.push({
          id: ioUid('el'),
          gateId,
          position: { x: col * GATE_X_SPACING + 30, y: 0 },
          wireIndex: wireIdx,
          parameterValues: paramValues,
        });

      } else if (wireType === 'qubit2') {
        if (args.length < 2) { warnings.push(`${methodName} requires 2 qubit arguments`); continue; }
        const ctrlRef = parseRegRef(args[0]);
        const tgtRef = parseRegRef(args[1]);
        if (!ctrlRef || !tgtRef) { warnings.push(`Could not resolve wires for ${methodName}()`); continue; }
        const ctrlIdx = wireIndexMap[`${ctrlRef.name},${ctrlRef.index}`];
        const tgtIdx = wireIndexMap[`${tgtRef.name},${tgtRef.index}`];
        if (ctrlIdx === undefined || tgtIdx === undefined) { warnings.push(`Register index out of bounds for ${methodName}()`); continue; }

        const col = Math.max(wireColumn[ctrlIdx], wireColumn[tgtIdx]);
        wireColumn[ctrlIdx] = col + 1;
        wireColumn[tgtIdx] = col + 1;
        elements.push({
          id: ioUid('el'),
          gateId,
          position: { x: col * GATE_X_SPACING + 30, y: 0 },
          wireIndex: ctrlIdx,
          targetWireIndices: [tgtIdx],
        });

      } else if (wireType === 'qumode') {
        const regRef = parseRegRef(args[args.length - 1]);
        if (!regRef) { warnings.push(`Could not resolve wire for ${methodName}()`); continue; }
        const wireIdx = wireIndexMap[`${regRef.name},${regRef.index}`];
        if (wireIdx === undefined) { warnings.push(`Register index out of bounds: ${regRef.name}[${regRef.index}]`); continue; }

        const paramValues = extractQumodeParams(args, gateId, warnings);

        const col = wireColumn[wireIdx];
        wireColumn[wireIdx] = col + 1;
        elements.push({
          id: ioUid('el'),
          gateId,
          position: { x: col * GATE_X_SPACING + 30, y: 0 },
          wireIndex: wireIdx,
          parameterValues: paramValues,
        });

      } else if (wireType === 'qumode2') {
        if (args.length < 3) { warnings.push(`${methodName} requires theta and 2 qumode arguments`); continue; }
        const qm1Ref = parseRegRef(args[args.length - 2]);
        const qm2Ref = parseRegRef(args[args.length - 1]);
        if (!qm1Ref || !qm2Ref) { warnings.push(`Could not resolve wires for ${methodName}()`); continue; }
        const qm1Idx = wireIndexMap[`${qm1Ref.name},${qm1Ref.index}`];
        const qm2Idx = wireIndexMap[`${qm2Ref.name},${qm2Ref.index}`];
        if (qm1Idx === undefined || qm2Idx === undefined) { warnings.push(`Register index out of bounds for ${methodName}()`); continue; }

        const paramValues = extractQumodeParams(args, gateId, warnings);

        const col = Math.max(wireColumn[qm1Idx], wireColumn[qm2Idx]);
        wireColumn[qm1Idx] = col + 1;
        wireColumn[qm2Idx] = col + 1;
        elements.push({
          id: ioUid('el'),
          gateId,
          position: { x: col * GATE_X_SPACING + 30, y: 0 },
          wireIndex: qm1Idx,
          targetWireIndices: [qm2Idx],
          parameterValues: paramValues,
        });

      } else if (wireType === 'hybrid') {
        if (args.length < 3) { warnings.push(`${methodName} requires param, qumode, and qubit arguments`); continue; }
        const qmRef = parseRegRef(args[args.length - 2]);
        const qbRef = parseRegRef(args[args.length - 1]);
        if (!qmRef || !qbRef) { warnings.push(`Could not resolve wires for ${methodName}()`); continue; }
        const qmIdx = wireIndexMap[`${qmRef.name},${qmRef.index}`];
        const qbIdx = wireIndexMap[`${qbRef.name},${qbRef.index}`];
        if (qmIdx === undefined || qbIdx === undefined) { warnings.push(`Register index out of bounds for ${methodName}()`); continue; }

        const paramValues = extractHybridParams(args, gateId, warnings);

        const col = Math.max(wireColumn[qmIdx], wireColumn[qbIdx]);
        wireColumn[qmIdx] = col + 1;
        wireColumn[qbIdx] = col + 1;
        // HyQSim convention: qubit is primary wire, qumode is target
        elements.push({
          id: ioUid('el'),
          gateId,
          position: { x: col * GATE_X_SPACING + 30, y: 0 },
          wireIndex: qbIdx,
          targetWireIndices: [qmIdx],
          parameterValues: paramValues,
        });
      }
    } catch (e) {
      warnings.push(`Error processing ${methodName}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (elements.length === 0) {
    warnings.push('No gate operations found in the code.');
  }

  return { success: true, wires, elements, warnings };
}

// ---------------------------------------------------------------------------
// Parameter extraction helpers
// ---------------------------------------------------------------------------

function extractQumodeParams(
  args: string[], gateId: string, warnings: string[]
): Record<string, number> | undefined {
  const params: Record<string, number> = {};

  if (gateId === 'displace') {
    try {
      const val = evalNumericExpr(args[0]);
      params.alpha_re = round6(val.re);
      params.alpha_im = round6(val.im);
    } catch { warnings.push('Could not evaluate alpha for displacement, using defaults'); }

  } else if (gateId === 'squeeze') {
    try {
      const val = evalNumericExpr(args[0]);
      const r = Math.sqrt(val.re * val.re + val.im * val.im);
      const phi = Math.atan2(val.im, val.re);
      params.r = round6(r);
      params.phi = round6(phi);
    } catch { warnings.push('Could not evaluate squeeze parameter, using defaults'); }

  } else if (gateId === 'rotate') {
    try {
      const val = evalNumericExpr(args[0]);
      params.theta = round6(val.re);
    } catch { warnings.push('Could not evaluate theta, using default'); }

  } else if (gateId === 'kerr') {
    try {
      const val = evalNumericExpr(args[0]);
      params.kappa = round6(val.re);
    } catch { warnings.push('Could not evaluate kappa, using default'); }

  } else if (gateId === 'bs') {
    try {
      const val = evalNumericExpr(args[0]);
      params.theta = round6(val.re);
    } catch { warnings.push('Could not evaluate beam splitter theta, using default'); }
  }

  return Object.keys(params).length > 0 ? params : undefined;
}

function extractHybridParams(
  args: string[], gateId: string, warnings: string[]
): Record<string, number> | undefined {
  const params: Record<string, number> = {};

  if (gateId === 'cdisp') {
    try {
      const val = evalNumericExpr(args[0]);
      params.alpha_re = round6(val.re);
      params.alpha_im = round6(val.im);
    } catch { warnings.push('Could not evaluate alpha for controlled displacement, using defaults'); }

  } else if (gateId === 'cr') {
    try {
      const val = evalNumericExpr(args[0]);
      params.theta = round6(val.re);
    } catch { warnings.push('Could not evaluate theta for controlled rotation, using default'); }
  }

  return Object.keys(params).length > 0 ? params : undefined;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

// ---------------------------------------------------------------------------
// Generator: HyQSim circuit -> bosonic qiskit code
// ---------------------------------------------------------------------------

export function formatNumber(value: number): string {
  if (value === 0) return '0';

  const ratio = value / Math.PI;
  const piMap: [number, string][] = [
    [1.0, 'np.pi'],
    [-1.0, '-np.pi'],
    [0.5, 'np.pi / 2'],
    [-0.5, '-np.pi / 2'],
    [0.25, 'np.pi / 4'],
    [-0.25, '-np.pi / 4'],
    [2.0, '2 * np.pi'],
    [-2.0, '-2 * np.pi'],
  ];
  for (const [frac, expr] of piMap) {
    if (Math.abs(ratio - frac) < 1e-9) return expr;
  }

  const rounded = Math.round(value * 1e6) / 1e6;
  if (rounded === Math.floor(rounded)) return String(Math.floor(rounded));
  return String(rounded);
}

function formatComplex(re: number, im: number): string {
  if (im === 0) return formatNumber(re);
  if (re === 0) return `${formatNumber(im)}j`;
  return `complex(${formatNumber(re)}, ${formatNumber(im)})`;
}

function getQumodeParamStr(gateId: string, params: Record<string, number>): string {
  if (gateId === 'displace') {
    return formatComplex(params.alpha_re ?? 1.0, params.alpha_im ?? 0.0);
  }
  if (gateId === 'squeeze') {
    const r = params.r ?? 0.5;
    const phi = params.phi ?? 0.0;
    if (phi === 0) return formatNumber(r);
    const zRe = r * Math.cos(phi);
    const zIm = r * Math.sin(phi);
    return formatComplex(zRe, zIm);
  }
  if (gateId === 'rotate') return formatNumber(params.theta ?? 0);
  if (gateId === 'kerr') return formatNumber(params.kappa ?? 0);
  if (gateId === 'bs') return `complex(${formatNumber(params.theta ?? 0)})`;
  return '';
}

function getHybridParamStr(gateId: string, params: Record<string, number>): string {
  if (gateId === 'cdisp') {
    return formatComplex(params.alpha_re ?? 1.0, params.alpha_im ?? 0.0);
  }
  if (gateId === 'cr') return formatNumber(params.theta ?? 0);
  return '0';
}

export function generateBosonicQiskit(
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

    const numQumodes = qumodeWires.length;
    const numQubits = qubitWires.length;

    if (numQumodes === 0 && numQubits === 0) {
      return { success: false, code: '', error: 'Circuit has no wires.' };
    }

    // Map wire array index -> register index
    const qumodeRegIdx: Record<number, number> = {};
    const qubitRegIdx: Record<number, number> = {};
    qumodeWires.forEach(([wireArrI], regI) => { qumodeRegIdx[wireArrI] = regI; });
    qubitWires.forEach(([wireArrI], regI) => { qubitRegIdx[wireArrI] = regI; });

    const numQubitsPerQumode = fockTruncation > 0 ? Math.max(1, Math.floor(Math.log2(fockTruncation))) : 4;

    const out: string[] = [];
    out.push('import numpy as np');
    out.push('import qiskit');
    out.push('import c2qa');
    out.push('');

    if (numQumodes > 0) {
      out.push(`qmr = c2qa.QumodeRegister(num_qumodes=${numQumodes}, num_qubits_per_qumode=${numQubitsPerQumode})`);
    }
    if (numQubits > 0) {
      out.push(`qbr = qiskit.QuantumRegister(${numQubits})`);
    }

    const circuitArgs: string[] = [];
    if (numQumodes > 0) circuitArgs.push('qmr');
    if (numQubits > 0) circuitArgs.push('qbr');
    out.push(`circuit = c2qa.CVCircuit(${circuitArgs.join(', ')})`);
    out.push('');

    const sorted = [...elements].sort((a, b) => a.position.x - b.position.x);

    for (const elem of sorted) {
      const mapping = EXPORT_MAP[elem.gateId];
      if (!mapping) {
        if (['custom', 'custom_cv', 'custom_cvdv'].includes(elem.gateId)) {
          out.push('# Skipped custom generator gate (not representable in bosonic qiskit)');
        } else if (['annihilate', 'create'].includes(elem.gateId)) {
          out.push(`# Skipped non-unitary operator: ${elem.gateId}`);
        } else {
          out.push(`# Skipped unsupported gate: ${elem.gateId}`);
        }
        continue;
      }

      const { method, wire, params: mappingParams } = mapping;
      const params = elem.parameterValues || {};

      if (wire === 'qubit') {
        const qi = qubitRegIdx[elem.wireIndex];
        if (qi === undefined) { out.push(`# Skipped ${elem.gateId}: wire ${elem.wireIndex} is not a qubit`); continue; }
        if (mappingParams.length > 0) {
          const theta = params.theta ?? 0;
          out.push(`circuit.${method}(${formatNumber(theta)}, qbr[${qi}])`);
        } else {
          out.push(`circuit.${method}(qbr[${qi}])`);
        }

      } else if (wire === 'qubit2') {
        const qiCtrl = qubitRegIdx[elem.wireIndex];
        const qiTgt = qubitRegIdx[elem.targetWireIndices?.[0] ?? -1];
        if (qiCtrl === undefined || qiTgt === undefined) { out.push(`# Skipped ${elem.gateId}: could not resolve qubit wires`); continue; }
        out.push(`circuit.${method}(qbr[${qiCtrl}], qbr[${qiTgt}])`);

      } else if (wire === 'qumode') {
        const mi = qumodeRegIdx[elem.wireIndex];
        if (mi === undefined) { out.push(`# Skipped ${elem.gateId}: wire ${elem.wireIndex} is not a qumode`); continue; }
        const paramStr = getQumodeParamStr(elem.gateId, params);
        out.push(paramStr ? `circuit.${method}(${paramStr}, qmr[${mi}])` : `circuit.${method}(qmr[${mi}])`);

      } else if (wire === 'qumode2') {
        const mi1 = qumodeRegIdx[elem.wireIndex];
        const mi2 = qumodeRegIdx[elem.targetWireIndices?.[0] ?? -1];
        if (mi1 === undefined || mi2 === undefined) { out.push(`# Skipped ${elem.gateId}: could not resolve qumode wires`); continue; }
        const paramStr = getQumodeParamStr(elem.gateId, params);
        out.push(paramStr ? `circuit.${method}(${paramStr}, qmr[${mi1}], qmr[${mi2}])` : `circuit.${method}(qmr[${mi1}], qmr[${mi2}])`);

      } else if (wire === 'hybrid') {
        const qi = qubitRegIdx[elem.wireIndex];
        const mi = qumodeRegIdx[elem.targetWireIndices?.[0] ?? -1];
        if (qi === undefined || mi === undefined) { out.push(`# Skipped ${elem.gateId}: could not resolve hybrid wires`); continue; }
        const paramStr = getHybridParamStr(elem.gateId, params);
        out.push(`circuit.${method}(${paramStr}, qmr[${mi}], qbr[${qi}])`);
      }
    }

    out.push('');
    return { success: true, code: out.join('\n') };
  } catch (e) {
    return { success: false, code: '', error: e instanceof Error ? e.message : String(e) };
  }
}
