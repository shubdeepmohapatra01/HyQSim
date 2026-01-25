// Main quantum circuit simulator
// Uses full tensor product state for proper entanglement handling

import type { Wire, CircuitElement, Gate, SimulationResult, QubitState, QumodeState, QubitPostSelection } from '../types/circuit';
import { getDefaultParameters } from '../types/circuit';
import {
  initTensorState,
  applyQubitGate,
  applyQumodeGate as applyTensorQumodeGate,
  applyHybridGate as applyTensorHybridGate,
  applyCNOTGate,
  applyPostSelection,
  partialTraceToSubsystem,
  densityMatrixToQubitState,
  densityMatrixToQumodeState,
} from './tensor';

// Sort elements by x position (left to right execution)
function sortElementsByPosition(elements: CircuitElement[]): CircuitElement[] {
  return [...elements].sort((a, b) => a.position.x - b.position.x);
}

export function runSimulation(
  wires: Wire[],
  elements: CircuitElement[],
  gates: Map<string, Gate>,
  fockDim: number,
  postSelections: QubitPostSelection[] = []
): SimulationResult {
  const startTime = performance.now();

  // Separate wire indices by type
  const qubitWireIndices: number[] = [];
  const qumodeWireIndices: number[] = [];

  for (let i = 0; i < wires.length; i++) {
    if (wires[i].type === 'qubit') {
      qubitWireIndices.push(i);
    } else {
      qumodeWireIndices.push(i);
    }
  }

  // Initialize tensor product state
  let state = initTensorState(qubitWireIndices, qumodeWireIndices, fockDim);

  // Sort elements by position (execution order)
  const sortedElements = sortElementsByPosition(elements);

  // Apply each gate
  for (const element of sortedElements) {
    const gate = gates.get(element.gateId);
    if (!gate) continue;

    const params = element.parameterValues ?? getDefaultParameters(gate);
    const wireIndex = element.wireIndex;
    const wire = wires[wireIndex];

    if (gate.category === 'qubit' && wire?.type === 'qubit') {
      // Single qubit gate
      if (!gate.numQubits || gate.numQubits === 1) {
        state = applyQubitGate(state, wireIndex, gate.id, params);
      }
      // Two-qubit gate (CNOT)
      else if (gate.numQubits === 2 && element.targetWireIndices?.length) {
        const targetIndex = element.targetWireIndices[0];
        state = applyCNOTGate(state, wireIndex, targetIndex);
      }
    } else if (gate.category === 'qumode' && wire?.type === 'qumode') {
      // Single qumode gate
      if (!gate.numQumodes || gate.numQumodes === 1) {
        state = applyTensorQumodeGate(state, wireIndex, gate.id, params, fockDim);
      }
      // Two-qumode gate (beam splitter) - TODO: implement in tensor.ts
      else if (gate.numQumodes === 2 && element.targetWireIndices?.length) {
        // For now, skip beam splitter in tensor mode
        console.warn('Beam splitter not yet implemented in tensor mode');
      }
    } else if (gate.category === 'hybrid') {
      // Hybrid gate
      const qubitWireIndex = wireIndex;
      const qumodeWireIndex = element.targetWireIndices?.[0];

      if (qumodeWireIndex !== undefined) {
        state = applyTensorHybridGate(
          state,
          qubitWireIndex,
          qumodeWireIndex,
          gate.id,
          params,
          fockDim
        );
      }
    }
  }

  // Apply post-selections
  for (const ps of postSelections) {
    if (wires[ps.wireIndex]?.type === 'qubit') {
      state = applyPostSelection(state, ps.wireIndex, ps.outcome as 0 | 1);
    }
  }

  // Convert to result format by computing reduced density matrices
  const qubitResults = new Map<number, QubitState>();
  const qumodeResults = new Map<number, QumodeState>();

  for (const wireIndex of qubitWireIndices) {
    const rho = partialTraceToSubsystem(state, wireIndex);
    const { amplitude, blochVector } = densityMatrixToQubitState(rho);

    qubitResults.set(wireIndex, {
      amplitude,
      blochVector,
      expectations: {
        sigmaX: blochVector.x,
        sigmaY: blochVector.y,
        sigmaZ: blochVector.z,
      },
    });
  }

  for (const wireIndex of qumodeWireIndices) {
    const rho = partialTraceToSubsystem(state, wireIndex);
    const { fockAmplitudes, fockProbabilities, meanPhotonNumber, densityMatrix } = densityMatrixToQumodeState(rho);

    // Convert density matrix to serializable format
    const dmSerializable = densityMatrix.map(row =>
      row.map(c => ({ re: c.re, im: c.im }))
    );

    qumodeResults.set(wireIndex, {
      fockAmplitudes,
      fockProbabilities,
      meanPhotonNumber,
      densityMatrix: dmSerializable,
    });
  }

  const executionTime = performance.now() - startTime;

  return {
    qubitStates: qubitResults,
    qumodeStates: qumodeResults,
    backend: 'browser',
    executionTime,
  };
}
