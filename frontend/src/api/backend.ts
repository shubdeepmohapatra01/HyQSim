/**
 * API client for HyQSim Python backend.
 */

import type { Wire, CircuitElement, SimulationResult, QubitState, QumodeState, QubitPostSelection, ImportCircuitResponse, ExportCircuitResponse } from '../types/circuit';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

interface BackendSimulationResponse {
  success: boolean;
  qubitStates: Record<string, QubitState>;
  qumodeStates: Record<string, QumodeState>;
  executionTime: number;
  backend: string;
  error?: string;
  bitstringCounts?: Record<string, number>;
}

interface BackendHealthResponse {
  service: string;
  status: string;
  backends: {
    'bosonic-qiskit': boolean;
  };
}

/**
 * Check if the backend is available and healthy.
 */
export async function checkBackendHealth(): Promise<{
  available: boolean;
  bosonicAvailable: boolean;
}> {
  try {
    const response = await fetch(`${BACKEND_URL}/`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      return { available: false, bosonicAvailable: false };
    }

    const data: BackendHealthResponse = await response.json();
    return {
      available: data.status === 'running',
      bosonicAvailable: data.backends['bosonic-qiskit'] ?? false,
    };
  } catch {
    return { available: false, bosonicAvailable: false };
  }
}

/**
 * Run simulation on the Python backend.
 */
export async function runBackendSimulation(
  wires: Wire[],
  elements: CircuitElement[],
  fockTruncation: number,
  postSelections?: QubitPostSelection[],
  shots: number = 1024,
): Promise<SimulationResult> {
  const response = await fetch(`${BACKEND_URL}/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wires: wires.map((w, i) => ({
        id: w.id,
        type: w.type,
        index: i,
        initialState: w.initialState,
      })),
      elements: elements.map((e) => ({
        id: e.id,
        gateId: e.gateId,
        position: e.position,
        wireIndex: e.wireIndex,
        targetWireIndices: e.targetWireIndices,
        parameterValues: e.parameterValues,
      })),
      fockTruncation,
      postSelections: postSelections ?? null,
      shots,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Simulation failed');
  }

  const data: BackendSimulationResponse = await response.json();

  // Convert response to SimulationResult format
  const qubitStates = new Map<number, QubitState>();
  const qumodeStates = new Map<number, QumodeState>();

  for (const [key, state] of Object.entries(data.qubitStates)) {
    qubitStates.set(parseInt(key), state);
  }

  for (const [key, state] of Object.entries(data.qumodeStates)) {
    qumodeStates.set(parseInt(key), state);
  }

  return {
    qubitStates,
    qumodeStates,
    backend: 'bosonic-qiskit',
    executionTime: data.executionTime * 1000, // Convert seconds to ms
    bitstringCounts: data.bitstringCounts ?? undefined,
  };
}

/**
 * Run a quick preview simulation with reduced precision.
 */
export async function runPreviewSimulation(
  wires: Wire[],
  elements: CircuitElement[],
  fockTruncation: number
): Promise<SimulationResult> {
  const response = await fetch(`${BACKEND_URL}/simulate/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wires: wires.map((w, i) => ({
        id: w.id,
        type: w.type,
        index: i,
        initialState: w.initialState,
      })),
      elements,
      fockTruncation,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Preview simulation failed');
  }

  const data: BackendSimulationResponse = await response.json();

  const qubitStates = new Map<number, QubitState>();
  const qumodeStates = new Map<number, QumodeState>();

  for (const [key, state] of Object.entries(data.qubitStates)) {
    qubitStates.set(parseInt(key), state);
  }

  for (const [key, state] of Object.entries(data.qumodeStates)) {
    qumodeStates.set(parseInt(key), state);
  }

  return {
    qubitStates,
    qumodeStates,
    backend: 'bosonic-qiskit',
    executionTime: data.executionTime * 1000,
  };
}

/**
 * Import bosonic qiskit code -> HyQSim circuit data.
 */
export async function importBosonicQiskit(code: string): Promise<ImportCircuitResponse> {
  const response = await fetch(`${BACKEND_URL}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Import failed');
  }

  return response.json();
}

/**
 * Export HyQSim circuit data -> bosonic qiskit code.
 */
export async function exportBosonicQiskit(
  wires: Wire[],
  elements: CircuitElement[],
  fockTruncation: number,
): Promise<ExportCircuitResponse> {
  const response = await fetch(`${BACKEND_URL}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wires: wires.map((w, i) => ({
        id: w.id,
        type: w.type,
        index: i,
        initialState: w.initialState,
      })),
      elements: elements.map((e) => ({
        id: e.id,
        gateId: e.gateId,
        position: e.position,
        wireIndex: e.wireIndex,
        targetWireIndices: e.targetWireIndices,
        parameterValues: e.parameterValues,
      })),
      fockTruncation,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Export failed');
  }

  return response.json();
}
