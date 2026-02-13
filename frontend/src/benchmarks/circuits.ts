/**
 * Benchmark circuit definitions for HyQSim.
 *
 * Each benchmark returns wires + elements arrays that can be loaded
 * directly onto the canvas as standard HyQSim gates.
 */

import type { Wire, CircuitElement } from '../types/circuit';

interface BenchmarkCircuit {
  wires: Wire[];
  elements: CircuitElement[];
  fockTruncation: number;
}

export interface BenchmarkParam {
  name: string;
  label: string;
  defaultValue: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface BenchmarkDefinition {
  id: string;
  name: string;
  description: string;
  params?: BenchmarkParam[];
  build: (params?: Record<string, number>) => BenchmarkCircuit;
}

let _uid = 0;
function uid(prefix: string): string {
  return `${prefix}-${++_uid}`;
}

function mkWire(type: 'qubit' | 'qumode', index: number, initialState?: string | number): Wire {
  return {
    id: uid('w'),
    type,
    index,
    initialState: initialState as Wire['initialState'],
  };
}

function mkGate(
  gateId: string,
  wireIndex: number,
  x: number,
  opts?: { targets?: number[]; params?: Record<string, number>; benchmarkGroup?: string },
): CircuitElement {
  return {
    id: uid('el'),
    gateId,
    position: { x, y: 0 },
    wireIndex,
    targetWireIndices: opts?.targets,
    parameterValues: opts?.params,
    benchmarkGroup: opts?.benchmarkGroup,
  };
}

/**
 * Cat State Circuit
 * H → CD(α/√2) → H → S† → H → CD(iπ/(8α√2)) → H → S
 *
 * Creates a Schrödinger cat state |α⟩ + |−α⟩ in the qumode.
 */
export function catStateCircuit(alpha: number = 2.0, fock: number = 32): BenchmarkCircuit {
  _uid = 0;
  const sqrt2 = Math.sqrt(2);
  const cd1Re = alpha / sqrt2;
  const cd1Im = 0;
  const cd2Re = 0;
  const cd2Im = Math.PI / (8 * alpha * sqrt2);

  const wires = [
    mkWire('qumode', 0),
    mkWire('qubit', 1, '0'),
  ];

  let x = 30;
  const step = 60;
  const elements: CircuitElement[] = [
    mkGate('h', 1, x),
    mkGate('cdisp', 1, x += step, { targets: [0], params: { alpha_re: cd1Re, alpha_im: cd1Im }, benchmarkGroup: 'cat-cd1' }),
    mkGate('h', 1, x += step),
    mkGate('sdg', 1, x += step),
    mkGate('h', 1, x += step),
    mkGate('cdisp', 1, x += step, { targets: [0], params: { alpha_re: cd2Re, alpha_im: cd2Im }, benchmarkGroup: 'cat-cd2' }),
    mkGate('h', 1, x += step),
    mkGate('s', 1, x += step),
  ];

  return { wires, elements, fockTruncation: fock };
}

/**
 * State Transfer: CV → DV
 *
 * Transfers quantum information from a qumode to n qubits using
 * Vj and Wj decompositions (H, S, S†, CD sequences).
 *
 * Vj: S† → H → CD(β_j) → H → S  where β_j = iπ / (2^(j+1) · λ)
 * Wj: H → CD(d_j) → H            where d_j = λ · 2^(j-1)
 */
export function stateTransferCVtoDV(n: number = 3, lambda: number = 0.29, fock: number = 8): BenchmarkCircuit {
  _uid = 0;

  const wires: Wire[] = [mkWire('qumode', 0)];
  for (let i = 1; i <= n; i++) {
    wires.push(mkWire('qubit', i, '0'));
  }

  const elements: CircuitElement[] = [];
  let x = 30;
  const step = 60;

  for (let j = 1; j <= n; j++) {
    const qubitIdx = n - j + 1; // qbr[n-j] maps to wire index n-j+1

    // Vj: sdg, h, cd(beta/√2), h, s
    // beta = iπ / (2^(j+1) · λ), CD param = beta/√2
    const betaIm = Math.PI / (Math.pow(2, j + 1) * lambda * Math.sqrt(2));
    elements.push(mkGate('sdg', qubitIdx, x));
    elements.push(mkGate('h', qubitIdx, x += step));
    elements.push(mkGate('cdisp', qubitIdx, x += step, {
      targets: [0],
      params: { alpha_re: 0, alpha_im: betaIm },
    }));
    elements.push(mkGate('h', qubitIdx, x += step));
    elements.push(mkGate('s', qubitIdx, x += step));

    // Wj: h, cd(disp/√2), h
    // disp = +λ·2^(j-1) when j==n, else -λ·2^(j-1)
    const sign = j === n ? 1 : -1;
    const dispRe = sign * lambda * Math.pow(2, j - 1) / Math.sqrt(2);
    elements.push(mkGate('h', qubitIdx, x += step));
    elements.push(mkGate('cdisp', qubitIdx, x += step, {
      targets: [0],
      params: { alpha_re: dispRe, alpha_im: 0 },
    }));
    elements.push(mkGate('h', qubitIdx, x += step));

    x += step; // gap between iterations
  }

  // Basis transformation: for each qubit qbr[i] (wire i+1)
  // i=0 (LSB): H, Z
  // i=1..n-2 (middle): H, X
  // i=n-1 (MSB): H, X, Z
  for (let i = 0; i < n; i++) {
    const wireIdx = i + 1;
    elements.push(mkGate('h', wireIdx, x));
    if (i === n - 1) {
      // MSB
      elements.push(mkGate('x', wireIdx, x += step));
      elements.push(mkGate('z', wireIdx, x += step));
    } else if (i === 0) {
      // LSB
      elements.push(mkGate('z', wireIdx, x += step));
    } else {
      // Middle
      elements.push(mkGate('x', wireIdx, x += step));
    }
    x += step;
  }

  return { wires, elements, fockTruncation: fock };
}

/**
 * State Transfer: DV → CV
 *
 * Reverse of CV→DV: for j = n..1, apply Wj† then Vj†.
 * Wj†: H → CD(-d_j) → H
 * Vj†: S† → H → CD(-β_j) → H → S
 */
export function stateTransferDVtoCV(n: number = 3, lambda: number = 0.29, fock: number = 8): BenchmarkCircuit {
  _uid = 0;

  const wires: Wire[] = [mkWire('qumode', 0)];
  for (let i = 1; i <= n; i++) {
    wires.push(mkWire('qubit', i, '0'));
  }

  const elements: CircuitElement[] = [];
  let x = 30;
  const step = 60;

  // Reverse basis transformation: for each qubit qbr[i] (wire i+1)
  // i=0 (LSB): Z, H
  // i=1..n-2 (middle): X, H
  // i=n-1 (MSB): Z, X, H
  for (let i = 0; i < n; i++) {
    const wireIdx = i + 1;
    if (i === n - 1) {
      // MSB
      elements.push(mkGate('z', wireIdx, x));
      elements.push(mkGate('x', wireIdx, x += step));
      elements.push(mkGate('h', wireIdx, x += step));
    } else if (i === 0) {
      // LSB
      elements.push(mkGate('z', wireIdx, x));
      elements.push(mkGate('h', wireIdx, x += step));
    } else {
      // Middle
      elements.push(mkGate('x', wireIdx, x));
      elements.push(mkGate('h', wireIdx, x += step));
    }
    x += step;
  }

  for (let j = n; j >= 1; j--) {
    const qubitIdx = n - j + 1;

    // Wj†: h, cd(-disp/√2), h  (negate the Wj displacement)
    const sign = j === n ? -1 : 1; // inverse of Wj sign
    const dispRe = sign * lambda * Math.pow(2, j - 1) / Math.sqrt(2);
    elements.push(mkGate('h', qubitIdx, x));
    elements.push(mkGate('cdisp', qubitIdx, x += step, {
      targets: [0],
      params: { alpha_re: dispRe, alpha_im: 0 },
    }));
    elements.push(mkGate('h', qubitIdx, x += step));

    // Vj†: sdg, h, cd(-beta/√2), h, s
    const betaIm = -(Math.PI / (Math.pow(2, j + 1) * lambda * Math.sqrt(2)));
    elements.push(mkGate('sdg', qubitIdx, x += step));
    elements.push(mkGate('h', qubitIdx, x += step));
    elements.push(mkGate('cdisp', qubitIdx, x += step, {
      targets: [0],
      params: { alpha_re: 0, alpha_im: betaIm },
    }));
    elements.push(mkGate('h', qubitIdx, x += step));
    elements.push(mkGate('s', qubitIdx, x += step));

    x += step;
  }

  return { wires, elements, fockTruncation: fock };
}

/**
 * When the user edits one of the cat state CD gates, recompute the partner.
 * CD1 has alpha_re = α/√2.  CD2 has alpha_im = π/(8α√2).
 * Both share the same underlying α.
 */
export function recomputeCatCDParams(
  changedGate: 'cat-cd1' | 'cat-cd2',
  params: Record<string, number>,
): { partnerGroup: string; partnerParams: Record<string, number> } {
  const sqrt2 = Math.sqrt(2);
  if (changedGate === 'cat-cd1') {
    // User edited CD1 — derive α from alpha_re, compute CD2
    const alpha = (params.alpha_re ?? 0) * sqrt2;
    const safeAlpha = Math.abs(alpha) < 1e-10 ? 1e-10 : alpha;
    return {
      partnerGroup: 'cat-cd2',
      partnerParams: { alpha_re: 0, alpha_im: Math.PI / (8 * safeAlpha * sqrt2) },
    };
  } else {
    // User edited CD2 — derive α from alpha_im, compute CD1
    const alphaIm = params.alpha_im ?? 0;
    const safeIm = Math.abs(alphaIm) < 1e-10 ? 1e-10 : alphaIm;
    const alpha = Math.PI / (8 * safeIm * sqrt2);
    return {
      partnerGroup: 'cat-cd1',
      partnerParams: { alpha_re: alpha / sqrt2, alpha_im: 0 },
    };
  }
}

const STATE_TRANSFER_PARAMS: BenchmarkParam[] = [
  { name: 'n', label: 'Number of qubits', defaultValue: 3, min: 1, max: 6, step: 1 },
  { name: 'lambda', label: 'Lambda (λ)', defaultValue: 0.29, min: 0.01, max: 2, step: 0.01 },
];

export const BENCHMARKS: BenchmarkDefinition[] = [
  {
    id: 'cat-state',
    name: 'Cat State',
    description: 'Superposition of coherent states |α⟩ + |−α⟩',
    build: () => catStateCircuit(),
  },
  {
    id: 'cv-to-dv',
    name: 'CV→DV Transfer',
    description: 'State transfer from qumode to qubits',
    params: STATE_TRANSFER_PARAMS,
    build: (p) => stateTransferCVtoDV(p?.n ?? 3, p?.lambda ?? 0.29),
  },
  {
    id: 'dv-to-cv',
    name: 'DV→CV Transfer',
    description: 'State transfer from qubits to qumode',
    params: STATE_TRANSFER_PARAMS,
    build: (p) => stateTransferDVtoCV(p?.n ?? 3, p?.lambda ?? 0.29),
  },
];
