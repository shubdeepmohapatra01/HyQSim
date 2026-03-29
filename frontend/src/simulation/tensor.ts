// Tensor product quantum state simulation
// Properly handles entanglement between qubits and qumodes

import type { Complex, StateVector, Matrix } from './complex';
import {
  complex, ONE, ZERO,
  add, mul, conj, abs2,
  normalize, identity,
} from './complex';
import { GATES, Rx, Ry, Rz, CNOT } from './qubit';
import { displacementMatrix, squeezingMatrix, rotationMatrix, kerrMatrix, annihilationMatrix, creationMatrix, beamSplitterMatrix } from './qumode';
import { buildCustomUnitary } from './customGenerator';
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

// Build z-conditional displacement gate matrix
// |0⟩⟨0| ⊗ D(+α) + |1⟩⟨1| ⊗ D(-α)
// Displacement direction follows the σz eigenvalue of the qubit.
export function zConditionalDisplacementMatrix(alpha: Complex, fockDim: number): Matrix {
  const Dalpha = displacementMatrix(alpha, fockDim);
  const DminusAlpha = displacementMatrix({ re: -alpha.re, im: -alpha.im }, fockDim);

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
        result[i][j] = Dalpha[outQumode][inQumode];
      } else {
        result[i][j] = DminusAlpha[outQumode][inQumode];
      }
    }
  }

  return result;
}

// Build x-conditional displacement gate matrix
// |+⟩⟨+| ⊗ D(+α) + |-⟩⟨-| ⊗ D(-α)
// Displacement direction follows the σx eigenvalue of the qubit.
// In the computational basis this gives:
//   diagonal blocks:     (D(α) + D(-α)) / 2
//   off-diagonal blocks: (D(α) - D(-α)) / 2
export function xConditionalDisplacementMatrix(alpha: Complex, fockDim: number): Matrix {
  const Dalpha = displacementMatrix(alpha, fockDim);
  const DminusAlpha = displacementMatrix({ re: -alpha.re, im: -alpha.im }, fockDim);

  const dim = 2 * fockDim;
  const result: Matrix = [];
  const half = complex(0.5);

  for (let i = 0; i < dim; i++) {
    result[i] = [];
    for (let j = 0; j < dim; j++) {
      const outQubit = Math.floor(i / fockDim);
      const outQumode = i % fockDim;
      const inQubit = Math.floor(j / fockDim);
      const inQumode = j % fockDim;

      const da = Dalpha[outQumode][inQumode];
      const dm = DminusAlpha[outQumode][inQumode];
      const dplus = mul(add(da, dm), half);   // (D(α)+D(-α))/2
      const dneg  = mul(sub(da, dm), half);   // (D(α)-D(-α))/2

      result[i][j] = outQubit === inQubit ? dplus : dneg;
    }
  }

  return result;
}

// Build y-conditional displacement gate matrix
// |y+⟩⟨y+| ⊗ D(+α) + |y-⟩⟨y-| ⊗ D(-α)
// Displacement direction follows the σy eigenvalue of the qubit.
// In the computational basis:
//   diagonal blocks:          (D(α) + D(-α)) / 2
//   off-diagonal block (0,1): -i (D(α) - D(-α)) / 2
//   off-diagonal block (1,0): +i (D(α) - D(-α)) / 2
export function yConditionalDisplacementMatrix(alpha: Complex, fockDim: number): Matrix {
  const Dalpha = displacementMatrix(alpha, fockDim);
  const DminusAlpha = displacementMatrix({ re: -alpha.re, im: -alpha.im }, fockDim);

  const dim = 2 * fockDim;
  const result: Matrix = [];
  const half = complex(0.5);

  for (let i = 0; i < dim; i++) {
    result[i] = [];
    for (let j = 0; j < dim; j++) {
      const outQubit = Math.floor(i / fockDim);
      const outQumode = i % fockDim;
      const inQubit = Math.floor(j / fockDim);
      const inQumode = j % fockDim;

      const da = Dalpha[outQumode][inQumode];
      const dm = DminusAlpha[outQumode][inQumode];
      const dplus = mul(add(da, dm), half);   // (D(α)+D(-α))/2
      const dneg  = mul(sub(da, dm), half);   // (D(α)-D(-α))/2

      if (outQubit === inQubit) {
        result[i][j] = dplus;
      } else if (outQubit === 0) {
        // top-right block: -i · dneg
        result[i][j] = mul(complex(0, -1), dneg);
      } else {
        // bottom-left block: +i · dneg
        result[i][j] = mul(complex(0, 1), dneg);
      }
    }
  }

  return result;
}

// Build Jaynes-Cummings coupling matrix
// U = exp(-i*theta*(sigma_+ a + sigma_- a†))
// Couples |g,n⟩ ↔ |e,n-1⟩ within each excitation subspace.
// Basis: |qubit, fock⟩ = qubit*fockDim + fock  (qubit 0=ground, 1=excited)
export function jaynesCouplingMatrix(theta: number, fockDim: number): Matrix {
  const dim = 2 * fockDim;
  const result: Matrix = [];
  for (let i = 0; i < dim; i++) {
    result[i] = new Array(dim).fill(ZERO);
  }

  // |g,0⟩ (index 0) is decoupled — no photon to exchange
  result[0][0] = ONE;

  // For n = 1..fockDim-1: invariant subspace {|g,n⟩, |e,n-1⟩}
  // Generator restricted to subspace: G_n = sqrt(n) * sigma_x
  // => U_n = [[cos(θ√n), -i·sin(θ√n)], [-i·sin(θ√n), cos(θ√n)]]
  for (let n = 1; n < fockDim; n++) {
    const gn  = n;              // index of |g,n⟩
    const en1 = fockDim + n - 1; // index of |e,n-1⟩
    const c = Math.cos(theta * Math.sqrt(n));
    const s = Math.sin(theta * Math.sqrt(n));

    result[gn][gn]   = { re: c, im: 0 };
    result[en1][gn]  = { re: 0, im: -s };
    result[gn][en1]  = { re: 0, im: -s };
    result[en1][en1] = { re: c, im: 0 };
  }

  // |e,fockDim-1⟩ (index 2*fockDim-1): partner |g,fockDim⟩ is outside truncation
  // Approximate as fixed (truncation artefact is negligible for fockDim >> mean photon number)
  result[dim - 1][dim - 1] = ONE;

  return result;
}

// Build conditional rotation gate matrix
// |0⟩⟨0| ⊗ R(+θ) + |1⟩⟨1| ⊗ R(-θ)
// Rotation direction follows the σz eigenvalue of the qubit.
export function conditionalRotationMatrix(theta: number, fockDim: number): Matrix {
  const Rpos = rotationMatrix(theta, fockDim);
  const Rneg = rotationMatrix(-theta, fockDim);

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
        result[i][j] = Rpos[outQumode][inQumode];
      } else {
        result[i][j] = Rneg[outQumode][inQumode];
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
    case 'kerr': {
      gate = kerrMatrix(params.kappa ?? 0.1, fockDim);
      break;
    }
    case 'annihilate': {
      gate = annihilationMatrix(fockDim);
      break;
    }
    case 'create': {
      gate = creationMatrix(fockDim);
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
      gate = zConditionalDisplacementMatrix(alpha, fockDim);
      break;
    }
    case 'xcdisp': {
      const alpha: Complex = { re: params.alpha_re ?? 1, im: params.alpha_im ?? 0 };
      gate = xConditionalDisplacementMatrix(alpha, fockDim);
      break;
    }
    case 'ycdisp': {
      const alpha: Complex = { re: params.alpha_re ?? 1, im: params.alpha_im ?? 0 };
      gate = yConditionalDisplacementMatrix(alpha, fockDim);
      break;
    }
    case 'cr': {
      gate = conditionalRotationMatrix(params.theta ?? Math.PI / 4, fockDim);
      break;
    }
    case 'jc': {
      gate = jaynesCouplingMatrix(params.theta ?? Math.PI / 4, fockDim);
      break;
    }
    default:
      return state;
  }

  return applyTwoSubsystemGate(state, qubitWireIndex, qumodeWireIndex, gate);
}

// Apply beam splitter gate between two qumode wires
export function applyBeamSplitter(
  state: TensorState,
  wireIndex1: number,
  wireIndex2: number,
  theta: number,
  phi: number,
  fockDim: number
): TensorState {
  const gate = beamSplitterMatrix(theta, phi, fockDim);
  return applyTwoSubsystemGate(state, wireIndex1, wireIndex2, gate);
}

// Apply CNOT gate between two qubits
export function applyCNOTGate(
  state: TensorState,
  controlWireIndex: number,
  targetWireIndex: number
): TensorState {
  return applyTwoSubsystemGate(state, controlWireIndex, targetWireIndex, CNOT);
}

// Apply custom generator gate
export function applyCustomGate(
  state: TensorState,
  wireIndex: number,
  targetWireIndex: number | undefined,
  expression: string,
  theta: number,
  fockDim: number
): TensorState {
  try {
    const { unitary, type } = buildCustomUnitary(expression, theta, fockDim);

    if (type === 'cv') {
      // CV-only gate: apply to qumode
      return applySingleGate(state, wireIndex, unitary);
    } else if (type === 'dv') {
      // DV-only gate: apply to qubit
      return applySingleGate(state, wireIndex, unitary);
    } else if (type === 'hybrid' && targetWireIndex !== undefined) {
      // Hybrid gate: apply to qubit-qumode pair
      return applyTwoSubsystemGate(state, wireIndex, targetWireIndex, unitary);
    }

    return state;
  } catch (error) {
    console.error('Custom gate error:', error);
    return state;
  }
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

// ---------------------------------------------------------------------------
// Qubit bitstring measurement sampling
// ---------------------------------------------------------------------------

/**
 * Compute exact qubit bitstring probabilities by tracing out all qumodes.
 * Returns a map from bitstring (e.g., "010") to probability.
 *
 * Since subsystems are ordered qubits first then qumodes, the state vector index is:
 *   fullIndex = qubitCombo * qumodeTotalDim + qumodeCombo
 */
export function getQubitBitstringProbabilities(
  state: TensorState
): Map<string, number> {
  const qubitSubs = state.subsystems.filter(s => s.type === 'qubit');
  const numQubits = qubitSubs.length;

  if (numQubits === 0) return new Map();

  const numBitstrings = 1 << numQubits; // 2^numQubits
  const probs = new Map<string, number>();

  // Product of all qumode dimensions
  let qumodeTotalDim = 1;
  for (const s of state.subsystems) {
    if (s.type === 'qumode') qumodeTotalDim *= s.dim;
  }

  for (let bitIdx = 0; bitIdx < numBitstrings; bitIdx++) {
    let prob = 0;

    // Sum |amplitude|² over all qumode basis states
    for (let qmIdx = 0; qmIdx < qumodeTotalDim; qmIdx++) {
      const fullIdx = bitIdx * qumodeTotalDim + qmIdx;
      if (fullIdx < state.amplitudes.length) {
        const amp = state.amplitudes[fullIdx];
        prob += amp.re * amp.re + amp.im * amp.im;
      }
    }

    if (prob > 1e-12) {
      const label = bitIdx.toString(2).padStart(numQubits, '0');
      probs.set(label, prob);
    }
  }

  return probs;
}

/**
 * Sample qubit bitstrings from the state vector.
 * Returns a histogram of bitstring counts from `shots` measurements.
 */
export function sampleQubitBitstrings(
  state: TensorState,
  shots: number
): Record<string, number> {
  const probs = getQubitBitstringProbabilities(state);
  if (probs.size === 0) return {};

  // Build cumulative distribution for sampling
  const entries = Array.from(probs.entries());
  const cumulative: { label: string; cumProb: number }[] = [];
  let cumProb = 0;
  for (const [label, prob] of entries) {
    cumProb += prob;
    cumulative.push({ label, cumProb });
  }

  // Sample using binary search
  const counts: Record<string, number> = {};
  for (let i = 0; i < shots; i++) {
    const r = Math.random();
    let lo = 0, hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid].cumProb < r) lo = mid + 1;
      else hi = mid;
    }
    const label = cumulative[lo].label;
    counts[label] = (counts[label] ?? 0) + 1;
  }

  return counts;
}
