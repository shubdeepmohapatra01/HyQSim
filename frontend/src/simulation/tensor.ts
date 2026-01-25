// Tensor product quantum state simulation
// Properly handles entanglement between qubits and qumodes

import type { Complex, StateVector, Matrix } from './complex';
import {
  complex, ONE, ZERO,
  add, mul, conj, abs2,
  normalize, identity,
} from './complex';
import { GATES, Rx, Ry, Rz, CNOT } from './qubit';
import { displacementMatrix, squeezingMatrix, rotationMatrix } from './qumode';
import type { Wire, QubitInitialState, QumodeInitialState } from '../types/circuit';

// Get initial state vector for a qubit
function getQubitInitialStateVector(state: QubitInitialState): StateVector {
  const SQRT2_INV = 1 / Math.sqrt(2);
  switch (state) {
    case '0': return [ONE, ZERO];
    case '1': return [ZERO, ONE];
    case '+': return [complex(SQRT2_INV), complex(SQRT2_INV)];
    case '-': return [complex(SQRT2_INV), complex(-SQRT2_INV)];
    case 'i': return [complex(SQRT2_INV), complex(0, SQRT2_INV)];
    case '-i': return [complex(SQRT2_INV), complex(0, -SQRT2_INV)];
    default: return [ONE, ZERO];
  }
}

// Get initial state vector for a qumode (Fock state)
function getQumodeInitialStateVector(n: QumodeInitialState, fockDim: number): StateVector {
  const state: StateVector = new Array(fockDim).fill(ZERO);
  if (n < fockDim) {
    state[n] = ONE;
  } else {
    state[0] = ONE; // Fallback to vacuum if n >= fockDim
  }
  return state;
}

export interface TensorState {
  // Full state vector in tensor product space
  amplitudes: StateVector;
  // Subsystem info: ordered list of subsystems
  subsystems: SubsystemInfo[];
  // Total dimension
  dim: number;
}

export interface SubsystemInfo {
  type: 'qubit' | 'qumode';
  wireIndex: number;  // Original wire index
  dim: number;        // 2 for qubit, fockDim for qumode
  offset: number;     // Position in subsystem list (0-indexed)
}

// Initialize a tensor product state with specified initial states
export function initTensorState(
  wires: Wire[],
  fockDim: number
): TensorState {
  const subsystems: SubsystemInfo[] = [];
  const qubitWires: Wire[] = [];
  const qumodeWires: Wire[] = [];

  // Separate qubits and qumodes, preserving their wire indices
  for (let i = 0; i < wires.length; i++) {
    if (wires[i].type === 'qubit') {
      qubitWires.push({ ...wires[i], index: i }); // Store original wire index
    } else {
      qumodeWires.push({ ...wires[i], index: i });
    }
  }

  // Add qubits first, then qumodes
  let offset = 0;
  const wireIndexMap: { wireIndex: number; initialState: StateVector }[] = [];

  for (const wire of qubitWires) {
    const wireIndex = wires.indexOf(wire) >= 0 ? wires.indexOf(wire) : wire.index;
    subsystems.push({
      type: 'qubit',
      wireIndex,
      dim: 2,
      offset: offset++,
    });
    const initialState = (wire.initialState as QubitInitialState) || '0';
    wireIndexMap.push({ wireIndex, initialState: getQubitInitialStateVector(initialState) });
  }

  for (const wire of qumodeWires) {
    const wireIndex = wires.indexOf(wire) >= 0 ? wires.indexOf(wire) : wire.index;
    subsystems.push({
      type: 'qumode',
      wireIndex,
      dim: fockDim,
      offset: offset++,
    });
    const initialState = (wire.initialState as QumodeInitialState) ?? 0;
    wireIndexMap.push({ wireIndex, initialState: getQumodeInitialStateVector(initialState, fockDim) });
  }

  // Total dimension
  const dim = subsystems.reduce((acc, s) => acc * s.dim, 1);

  // Build initial state as tensor product of individual states
  // Start with first subsystem's state
  let amplitudes: StateVector = wireIndexMap.length > 0 ? [...wireIndexMap[0].initialState] : [ONE];

  // Tensor product with remaining subsystems
  for (let i = 1; i < wireIndexMap.length; i++) {
    const nextState = wireIndexMap[i].initialState;
    const newAmplitudes: StateVector = [];
    for (const a of amplitudes) {
      for (const b of nextState) {
        newAmplitudes.push(mul(a, b));
      }
    }
    amplitudes = newAmplitudes;
  }

  // Ensure correct dimension
  if (amplitudes.length !== dim) {
    console.warn(`Amplitude length ${amplitudes.length} doesn't match expected dim ${dim}`);
    amplitudes = new Array(dim).fill(ZERO);
    amplitudes[0] = ONE;
  }

  return { amplitudes, subsystems, dim };
}

// Get the subsystem info by wire index
export function getSubsystem(state: TensorState, wireIndex: number): SubsystemInfo | undefined {
  return state.subsystems.find(s => s.wireIndex === wireIndex);
}

// Compute stride for a subsystem (product of dimensions to its right)
function getStride(state: TensorState, subsystemOffset: number): number {
  let stride = 1;
  for (let i = subsystemOffset + 1; i < state.subsystems.length; i++) {
    stride *= state.subsystems[i].dim;
  }
  return stride;
}

// Apply a single-subsystem gate
export function applySingleGate(
  state: TensorState,
  wireIndex: number,
  gateMatrix: Matrix
): TensorState {
  const subsystem = getSubsystem(state, wireIndex);
  if (!subsystem) return state;

  const gateDim = gateMatrix.length;
  if (gateDim !== subsystem.dim) {
    console.warn(`Gate dimension ${gateDim} doesn't match subsystem dimension ${subsystem.dim}`);
    return state;
  }

  const stride = getStride(state, subsystem.offset);
  const newAmplitudes: StateVector = new Array(state.dim).fill(ZERO);

  // For each basis state, apply the gate to the target subsystem
  for (let i = 0; i < state.dim; i++) {
    // Extract the index of the target subsystem
    const targetIdx = Math.floor(i / stride) % subsystem.dim;
    // Base index with target subsystem set to 0
    const baseIdx = i - targetIdx * stride;

    // Apply gate: sum over input states of target subsystem
    for (let j = 0; j < subsystem.dim; j++) {
      const inputIdx = baseIdx + j * stride;
      const matrixElement = gateMatrix[targetIdx][j];
      newAmplitudes[i] = add(newAmplitudes[i], mul(matrixElement, state.amplitudes[inputIdx]));
    }
  }

  return { ...state, amplitudes: normalize(newAmplitudes) };
}

// Apply a two-subsystem gate (e.g., CNOT, controlled displacement)
export function applyTwoSubsystemGate(
  state: TensorState,
  wireIndex1: number,
  wireIndex2: number,
  gateMatrix: Matrix  // Matrix in tensor product space of the two subsystems
): TensorState {
  const sub1 = getSubsystem(state, wireIndex1);
  const sub2 = getSubsystem(state, wireIndex2);
  if (!sub1 || !sub2) return state;

  const stride1 = getStride(state, sub1.offset);
  const stride2 = getStride(state, sub2.offset);
  const dim1 = sub1.dim;
  const dim2 = sub2.dim;

  const newAmplitudes: StateVector = new Array(state.dim).fill(ZERO);

  for (let i = 0; i < state.dim; i++) {
    // Extract indices of both subsystems
    const idx1 = Math.floor(i / stride1) % dim1;
    const idx2 = Math.floor(i / stride2) % dim2;

    // Combined output index in the gate's tensor space
    const outIdx = idx1 * dim2 + idx2;

    // Base index with both subsystems set to 0
    const baseIdx = i - idx1 * stride1 - idx2 * stride2;

    // Apply gate
    for (let j1 = 0; j1 < dim1; j1++) {
      for (let j2 = 0; j2 < dim2; j2++) {
        const inIdx = j1 * dim2 + j2;
        const inputStateIdx = baseIdx + j1 * stride1 + j2 * stride2;
        const matrixElement = gateMatrix[outIdx][inIdx];
        newAmplitudes[i] = add(newAmplitudes[i], mul(matrixElement, state.amplitudes[inputStateIdx]));
      }
    }
  }

  return { ...state, amplitudes: normalize(newAmplitudes) };
}

// Build controlled displacement gate matrix
// |0⟩⟨0| ⊗ D(α) + |1⟩⟨1| ⊗ D(-α)
export function controlledDisplacementMatrix(alpha: Complex, fockDim: number): Matrix {
  const Dalpha = displacementMatrix(alpha, fockDim);
  const DminusAlpha = displacementMatrix({ re: -alpha.re, im: -alpha.im }, fockDim);

  const dim = 2 * fockDim;  // qubit (2) x qumode (fockDim)
  const result: Matrix = [];

  for (let i = 0; i < dim; i++) {
    result[i] = [];
    for (let j = 0; j < dim; j++) {
      const outQubit = Math.floor(i / fockDim);
      const outQumode = i % fockDim;
      const inQubit = Math.floor(j / fockDim);
      const inQumode = j % fockDim;

      if (outQubit !== inQubit) {
        // Qubit must stay the same (no qubit flipping)
        result[i][j] = ZERO;
      } else if (outQubit === 0) {
        // |0⟩ branch: apply D(α)
        result[i][j] = Dalpha[outQumode][inQumode];
      } else {
        // |1⟩ branch: apply D(-α)
        result[i][j] = DminusAlpha[outQumode][inQumode];
      }
    }
  }

  return result;
}

// Build controlled rotation gate matrix
// |0⟩⟨0| ⊗ I + |1⟩⟨1| ⊗ R(θ)
export function controlledRotationMatrix(theta: number, fockDim: number): Matrix {
  const I = identity(fockDim);
  const R = rotationMatrix(theta, fockDim);

  const dim = 2 * fockDim;
  const result: Matrix = [];

  for (let i = 0; i < dim; i++) {
    result[i] = [];
    for (let j = 0; j < dim; j++) {
      const outQubit = Math.floor(i / fockDim);
      const outQumode = i % fockDim;
      const inQubit = Math.floor(j / fockDim);
      const inQumode = j % fockDim;

      if (outQubit !== inQubit) {
        result[i][j] = ZERO;
      } else if (outQubit === 0) {
        result[i][j] = I[outQumode][inQumode];
      } else {
        result[i][j] = R[outQumode][inQumode];
      }
    }
  }

  return result;
}

// Partial trace to get reduced density matrix for a single subsystem
export function partialTraceToSubsystem(
  state: TensorState,
  wireIndex: number
): Matrix {
  const subsystem = getSubsystem(state, wireIndex);
  if (!subsystem) {
    return [[ONE]];  // Return trivial 1x1 if not found
  }

  const dim = subsystem.dim;

  // Initialize density matrix
  const rho: Matrix = [];
  for (let i = 0; i < dim; i++) {
    rho[i] = new Array(dim).fill(ZERO);
  }

  // Compute ρ = Tr_other(|ψ⟩⟨ψ|)
  // ρ_{ij} = Σ_{other} ψ_{i,other} ψ*_{j,other}
  const otherDim = state.dim / dim;

  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) {
      let sum = ZERO;

      for (let other = 0; other < otherDim; other++) {
        // Reconstruct full index from subsystem index and "other" index
        const idx_i = reconstructIndex(state, subsystem.offset, i, other);
        const idx_j = reconstructIndex(state, subsystem.offset, j, other);

        const amp_i = state.amplitudes[idx_i];
        const amp_j = state.amplitudes[idx_j];
        sum = add(sum, mul(amp_i, conj(amp_j)));
      }

      rho[i][j] = sum;
    }
  }

  return rho;
}

// Helper: reconstruct full state index from subsystem value and "other" index
function reconstructIndex(
  state: TensorState,
  targetOffset: number,
  targetValue: number,
  otherIdx: number
): number {
  const subsystems = state.subsystems;
  let fullIdx = 0;
  let otherMultiplier = 1;
  let stride = 1;

  // Work from right to left
  for (let i = subsystems.length - 1; i >= 0; i--) {
    const dim = subsystems[i].dim;

    if (i === targetOffset) {
      fullIdx += targetValue * stride;
    } else {
      const val = Math.floor(otherIdx / otherMultiplier) % dim;
      fullIdx += val * stride;
      otherMultiplier *= dim;
    }
    stride *= dim;
  }

  return fullIdx;
}

// Extract qubit state from density matrix (for Bloch sphere)
export function densityMatrixToQubitState(rho: Matrix): {
  amplitude: [Complex, Complex];
  blochVector: { x: number; y: number; z: number };
  purity: number;
} {
  // For a 2x2 density matrix:
  // ρ = (1/2)(I + x*σx + y*σy + z*σz)
  // x = Tr(ρ*σx) = ρ01 + ρ10
  // y = Tr(ρ*σy) = i(ρ01 - ρ10)
  // z = Tr(ρ*σz) = ρ00 - ρ11

  const x = rho[0][1].re + rho[1][0].re;
  const y = rho[0][1].im - rho[1][0].im;
  const z = rho[0][0].re - rho[1][1].re;

  // Purity = Tr(ρ²)
  const purity = abs2(rho[0][0]) + abs2(rho[0][1]) + abs2(rho[1][0]) + abs2(rho[1][1]);

  // For display, show sqrt of probabilities as amplitudes
  // This gives the correct measurement probabilities even for mixed states
  const p0 = Math.max(0, rho[0][0].re);
  const p1 = Math.max(0, rho[1][1].re);

  // For pure states with coherence, include the phase from off-diagonal
  const hasCoherence = abs2(rho[0][1]) > 0.001;

  let amp0: Complex, amp1: Complex;
  if (hasCoherence && purity > 0.99) {
    // Pure state: extract proper amplitudes
    amp0 = complex(Math.sqrt(p0));
    // Phase from ρ[1][0] = α₁ α₀* gives the relative phase
    const phase = Math.atan2(rho[1][0].im, rho[1][0].re);
    amp1 = complex(Math.sqrt(p1) * Math.cos(phase), Math.sqrt(p1) * Math.sin(phase));
  } else {
    // Mixed state: just show sqrt of probabilities
    amp0 = complex(Math.sqrt(p0));
    amp1 = complex(Math.sqrt(p1));
  }

  return {
    amplitude: [amp0, amp1],
    blochVector: { x, y, z },
    purity,
  };
}

// Extract qumode state from density matrix (for Wigner/Fock display)
export function densityMatrixToQumodeState(rho: Matrix): {
  fockAmplitudes: Complex[];
  fockProbabilities: number[];
  meanPhotonNumber: number;
  purity: number;
  densityMatrix: Matrix;  // Include full density matrix for Wigner computation
} {
  const dim = rho.length;
  const fockProbabilities: number[] = [];
  const fockAmplitudes: Complex[] = [];

  let meanPhotonNumber = 0;
  let purity = 0;

  for (let n = 0; n < dim; n++) {
    const prob = Math.max(0, rho[n][n].re);
    fockProbabilities.push(prob);
    meanPhotonNumber += n * prob;

    // Approximate amplitude (diagonal of density matrix sqrt)
    fockAmplitudes.push(complex(Math.sqrt(prob)));
  }

  // Compute purity = Tr(ρ²)
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) {
      purity += abs2(rho[i][j]);
    }
  }

  return {
    fockAmplitudes,
    fockProbabilities,
    meanPhotonNumber,
    purity,
    densityMatrix: rho,
  };
}

// Apply qubit gate by name
export function applyQubitGate(
  state: TensorState,
  wireIndex: number,
  gateName: string,
  params?: Record<string, number>
): TensorState {
  let gate: Matrix;

  switch (gateName) {
    case 'h': gate = GATES.H; break;
    case 'x': gate = GATES.X; break;
    case 'y': gate = GATES.Y; break;
    case 'z': gate = GATES.Z; break;
    case 's': gate = GATES.S; break;
    case 'sdg': gate = GATES.Sdg; break;
    case 't': gate = GATES.T; break;
    case 'rx': gate = Rx(params?.theta ?? Math.PI / 2); break;
    case 'ry': gate = Ry(params?.theta ?? Math.PI / 2); break;
    case 'rz': gate = Rz(params?.theta ?? Math.PI / 2); break;
    default: return state;
  }

  return applySingleGate(state, wireIndex, gate);
}

// Apply qumode gate by name
export function applyQumodeGate(
  state: TensorState,
  wireIndex: number,
  gateName: string,
  params: Record<string, number>,
  fockDim: number
): TensorState {
  let gate: Matrix;

  switch (gateName) {
    case 'displace': {
      const alpha: Complex = { re: params.alpha_re ?? 0, im: params.alpha_im ?? 0 };
      gate = displacementMatrix(alpha, fockDim);
      break;
    }
    case 'squeeze': {
      gate = squeezingMatrix(params.r ?? 0, params.phi ?? 0, fockDim);
      break;
    }
    case 'rotate': {
      gate = rotationMatrix(params.theta ?? 0, fockDim);
      break;
    }
    default:
      return state;
  }

  return applySingleGate(state, wireIndex, gate);
}

// Apply hybrid gate (qubit controls qumode)
export function applyHybridGate(
  state: TensorState,
  qubitWireIndex: number,
  qumodeWireIndex: number,
  gateName: string,
  params: Record<string, number>,
  fockDim: number
): TensorState {
  let gate: Matrix;

  switch (gateName) {
    case 'cdisp': {
      const alpha: Complex = { re: params.alpha_re ?? 1, im: params.alpha_im ?? 0 };
      gate = controlledDisplacementMatrix(alpha, fockDim);
      break;
    }
    case 'cr': {
      gate = controlledRotationMatrix(params.theta ?? Math.PI / 4, fockDim);
      break;
    }
    default:
      return state;
  }

  return applyTwoSubsystemGate(state, qubitWireIndex, qumodeWireIndex, gate);
}

// Apply CNOT gate between two qubits
export function applyCNOTGate(
  state: TensorState,
  controlWireIndex: number,
  targetWireIndex: number
): TensorState {
  return applyTwoSubsystemGate(state, controlWireIndex, targetWireIndex, CNOT);
}

// Apply post-selection on a qubit
export function applyPostSelection(
  state: TensorState,
  wireIndex: number,
  outcome: 0 | 1
): TensorState {
  const subsystem = getSubsystem(state, wireIndex);
  if (!subsystem || subsystem.type !== 'qubit') return state;

  const stride = getStride(state, subsystem.offset);
  const newAmplitudes: StateVector = [...state.amplitudes];

  // Zero out amplitudes where qubit is not in desired state
  for (let i = 0; i < state.dim; i++) {
    const qubitVal = Math.floor(i / stride) % 2;
    if (qubitVal !== outcome) {
      newAmplitudes[i] = ZERO;
    }
  }

  return { ...state, amplitudes: normalize(newAmplitudes) };
}
