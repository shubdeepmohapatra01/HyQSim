// Gate types for the hybrid CV-DV quantum simulator

export type GateCategory = 'qubit' | 'qumode' | 'hybrid';

// Parameter definition for gates
export interface GateParameter {
  name: string;
  symbol: string;
  defaultValue: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string; // e.g., 'rad', 'π'
}

export interface Gate {
  id: string;
  name: string;
  symbol: string;
  category: GateCategory;
  description: string;
  numQubits?: number;
  numQumodes?: number;
  parameters?: GateParameter[];
}

export interface CircuitElement {
  id: string;
  gateId: string;
  position: { x: number; y: number };
  wireIndex: number;
  targetWireIndices?: number[];
  // Store actual parameter values for this gate instance
  parameterValues?: Record<string, number>;
}

// Initial state options for qubits: |0⟩, |1⟩, |+⟩, |-⟩, |i⟩, |-i⟩
export type QubitInitialState = '0' | '1' | '+' | '-' | 'i' | '-i';

// Initial state options for qumodes: vacuum |0⟩ or Fock states |1⟩ to |5⟩
export type QumodeInitialState = 0 | 1 | 2 | 3 | 4 | 5;

export interface Wire {
  id: string;
  type: 'qubit' | 'qumode';
  index: number;
  initialState?: QubitInitialState | QumodeInitialState;
}

export interface CircuitState {
  wires: Wire[];
  elements: CircuitElement[];
}

// Simulation result types
export interface QubitState {
  // State vector [α, β] for |ψ⟩ = α|0⟩ + β|1⟩
  amplitude: [{ re: number; im: number }, { re: number; im: number }];
  // Bloch sphere coordinates
  blochVector: { x: number; y: number; z: number };
  // Expectation values
  expectations: { sigmaX: number; sigmaY: number; sigmaZ: number };
}

export interface QumodeState {
  // Fock basis amplitudes |ψ⟩ = Σ cₙ|n⟩
  fockAmplitudes: { re: number; im: number }[];
  // Probability distribution |cₙ|²
  fockProbabilities: number[];
  // Mean photon number
  meanPhotonNumber: number;
  // Pre-computed Wigner function (from Python backend)
  wignerData?: number[][];
  wignerRange?: number;
  // Density matrix for mixed states (browser tensor simulation)
  densityMatrix?: { re: number; im: number }[][];
}

export interface SimulationResult {
  qubitStates: Map<number, QubitState>;  // keyed by wire index
  qumodeStates: Map<number, QumodeState>; // keyed by wire index
  backend: 'browser' | 'bosonic-qiskit';
  executionTime: number; // in milliseconds
}

export interface QubitPostSelection {
  wireIndex: number;
  outcome: 0 | 1;
}

// Predefined gates with parameters
export const QUBIT_GATES: Gate[] = [
  { id: 'h', name: 'Hadamard', symbol: 'H', category: 'qubit', description: 'Hadamard gate', numQubits: 1 },
  { id: 'x', name: 'Pauli-X', symbol: 'X', category: 'qubit', description: 'Pauli-X (NOT) gate', numQubits: 1 },
  { id: 'y', name: 'Pauli-Y', symbol: 'Y', category: 'qubit', description: 'Pauli-Y gate', numQubits: 1 },
  { id: 'z', name: 'Pauli-Z', symbol: 'Z', category: 'qubit', description: 'Pauli-Z gate', numQubits: 1 },
  { id: 's', name: 'S Gate', symbol: 'S', category: 'qubit', description: 'S (phase) gate', numQubits: 1 },
  { id: 'sdg', name: 'S† Gate', symbol: 'S†', category: 'qubit', description: 'S-dagger (inverse S) gate', numQubits: 1 },
  { id: 't', name: 'T Gate', symbol: 'T', category: 'qubit', description: 'T gate', numQubits: 1 },
  {
    id: 'rx',
    name: 'Rx',
    symbol: 'Rx',
    category: 'qubit',
    description: 'Rotation around X-axis',
    numQubits: 1,
    parameters: [{ name: 'theta', symbol: 'θ', defaultValue: Math.PI / 2, min: 0, max: 2 * Math.PI, step: 0.1, unit: 'rad' }],
  },
  {
    id: 'ry',
    name: 'Ry',
    symbol: 'Ry',
    category: 'qubit',
    description: 'Rotation around Y-axis',
    numQubits: 1,
    parameters: [{ name: 'theta', symbol: 'θ', defaultValue: Math.PI / 2, min: 0, max: 2 * Math.PI, step: 0.1, unit: 'rad' }],
  },
  {
    id: 'rz',
    name: 'Rz',
    symbol: 'Rz',
    category: 'qubit',
    description: 'Rotation around Z-axis',
    numQubits: 1,
    parameters: [{ name: 'theta', symbol: 'θ', defaultValue: Math.PI / 2, min: 0, max: 2 * Math.PI, step: 0.1, unit: 'rad' }],
  },
  { id: 'cnot', name: 'CNOT', symbol: 'CX', category: 'qubit', description: 'Controlled-NOT gate', numQubits: 2 },
];

export const QUMODE_GATES: Gate[] = [
  {
    id: 'displace',
    name: 'Displacement',
    symbol: 'D',
    category: 'qumode',
    description: 'Displacement operator D(α)',
    numQumodes: 1,
    parameters: [
      { name: 'alpha_re', symbol: 'Re(α)', defaultValue: 1, min: -5, max: 5, step: 0.1 },
      { name: 'alpha_im', symbol: 'Im(α)', defaultValue: 0, min: -5, max: 5, step: 0.1 },
    ],
  },
  {
    id: 'squeeze',
    name: 'Squeezing',
    symbol: 'S',
    category: 'qumode',
    description: 'Squeezing operator S(r,φ)',
    numQumodes: 1,
    parameters: [
      { name: 'r', symbol: 'r', defaultValue: 0.5, min: 0, max: 2, step: 0.1 },
      { name: 'phi', symbol: 'φ', defaultValue: 0, min: 0, max: 2 * Math.PI, step: 0.1, unit: 'rad' },
    ],
  },
  {
    id: 'rotate',
    name: 'Rotation',
    symbol: 'R',
    category: 'qumode',
    description: 'Phase rotation R(θ)',
    numQumodes: 1,
    parameters: [{ name: 'theta', symbol: 'θ', defaultValue: Math.PI / 4, min: 0, max: 2 * Math.PI, step: 0.1, unit: 'rad' }],
  },
  {
    id: 'bs',
    name: 'Beam Splitter',
    symbol: 'BS',
    category: 'qumode',
    description: 'Beam splitter BS(θ,φ)',
    numQumodes: 2,
    parameters: [
      { name: 'theta', symbol: 'θ', defaultValue: Math.PI / 4, min: 0, max: Math.PI / 2, step: 0.1, unit: 'rad' },
      { name: 'phi', symbol: 'φ', defaultValue: 0, min: 0, max: 2 * Math.PI, step: 0.1, unit: 'rad' },
    ],
  },
  {
    id: 'kerr',
    name: 'Kerr',
    symbol: 'K',
    category: 'qumode',
    description: 'Kerr nonlinearity K(κ)',
    numQumodes: 1,
    parameters: [{ name: 'kappa', symbol: 'κ', defaultValue: 0.1, min: -1, max: 1, step: 0.01 }],
  },
];

export const HYBRID_GATES: Gate[] = [
  {
    id: 'cdisp',
    name: 'Controlled Disp.',
    symbol: 'CD',
    category: 'hybrid',
    description: 'Qubit-controlled displacement: |0⟩⟨0|⊗D(α) + |1⟩⟨1|⊗D(-α)',
    numQubits: 1,
    numQumodes: 1,
    parameters: [
      { name: 'alpha_re', symbol: 'Re(α)', defaultValue: 1, min: -5, max: 5, step: 0.1 },
      { name: 'alpha_im', symbol: 'Im(α)', defaultValue: 0, min: -5, max: 5, step: 0.1 },
    ],
  },
  {
    id: 'cr',
    name: 'Controlled Rot.',
    symbol: 'CR',
    category: 'hybrid',
    description: 'Qubit-controlled phase rotation on qumode',
    numQubits: 1,
    numQumodes: 1,
    parameters: [
      { name: 'theta', symbol: 'θ', defaultValue: Math.PI / 4, min: 0, max: 2 * Math.PI, step: 0.1, unit: 'rad' },
    ],
  },
  // Commented out for now:
  // {
  //   id: 'snap',
  //   name: 'SNAP',
  //   symbol: 'SNAP',
  //   category: 'hybrid',
  //   description: 'Selective number-dependent arbitrary phase',
  //   numQubits: 1,
  //   numQumodes: 1,
  //   parameters: [
  //     { name: 'n', symbol: 'n', defaultValue: 1, min: 0, max: 10, step: 1 },
  //     { name: 'theta', symbol: 'θ', defaultValue: Math.PI, min: 0, max: 2 * Math.PI, step: 0.1, unit: 'rad' },
  //   ],
  // },
  // {
  //   id: 'ecd',
  //   name: 'ECD',
  //   symbol: 'ECD',
  //   category: 'hybrid',
  //   description: 'Echoed conditional displacement',
  //   numQubits: 1,
  //   numQumodes: 1,
  //   parameters: [
  //     { name: 'beta_re', symbol: 'Re(β)', defaultValue: 1, min: -5, max: 5, step: 0.1 },
  //     { name: 'beta_im', symbol: 'Im(β)', defaultValue: 0, min: -5, max: 5, step: 0.1 },
  //   ],
  // },
];

export const ALL_GATES = [...QUBIT_GATES, ...QUMODE_GATES, ...HYBRID_GATES];

// Helper to get default parameter values for a gate
export function getDefaultParameters(gate: Gate): Record<string, number> {
  const params: Record<string, number> = {};
  if (gate.parameters) {
    for (const p of gate.parameters) {
      params[p.name] = p.defaultValue;
    }
  }
  return params;
}
