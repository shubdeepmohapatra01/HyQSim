import { useState, useCallback, useMemo, useEffect } from 'react';
import GatePalette from './components/GatePalette';
import CircuitCanvas from './components/CircuitCanvas';
import DisplayPanel from './components/DisplayPanel';
import GateParameterEditor from './components/GateParameterEditor';
import type { Gate, Wire, CircuitElement, SimulationResult, QubitPostSelection, QubitInitialState, QumodeInitialState } from './types/circuit';
import { ALL_GATES, getDefaultParameters } from './types/circuit';
import { runSimulation } from './simulation/simulator';
import { checkBackendHealth, runBackendSimulation } from './api/backend';

type SimulationBackend = 'browser' | 'python';

function App() {
  const [wires, setWires] = useState<Wire[]>([]);
  const [elements, setElements] = useState<CircuitElement[]>([]);
  const [fockTruncation, setFockTruncation] = useState(8); // Must be power of 2 for Python backend
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);

  // Backend state
  const [backend, setBackend] = useState<SimulationBackend>('browser');
  const [backendAvailable, setBackendAvailable] = useState(false);
  const [backendChecking, setBackendChecking] = useState(true);

  // For gate parameter editing
  const [selectedElement, setSelectedElement] = useState<CircuitElement | null>(null);

  // Post-selection for qubits (for cat state visualization)
  const [postSelections, setPostSelections] = useState<QubitPostSelection[]>([]);

  // Check backend health on mount
  useEffect(() => {
    const checkHealth = async () => {
      setBackendChecking(true);
      const health = await checkBackendHealth();
      setBackendAvailable(health.available && health.bosonicAvailable);
      setBackendChecking(false);
    };
    checkHealth();
    // Re-check every 30 seconds
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  // Create a map of gate IDs to gates for quick lookup
  const gatesMap = useMemo(() => new Map(ALL_GATES.map((g) => [g.id, g])), []);

  // Track qubit and qumode counts separately
  const [qubitCount, setQubitCount] = useState(0);
  const [qumodeCount, setQumodeCount] = useState(0);

  const handleAddWire = useCallback((type: 'qubit' | 'qumode') => {
    const newWire: Wire = {
      id: `${type}-${Date.now()}`,
      type,
      index: type === 'qubit' ? qubitCount : qumodeCount,
    };

    if (type === 'qubit') {
      setQubitCount((c) => c + 1);
    } else {
      setQumodeCount((c) => c + 1);
    }

    setWires((prev) => [...prev, newWire]);
    setSimulationResult(null); // Clear simulation when circuit changes
  }, [qubitCount, qumodeCount]);

  const handleRemoveWire = useCallback((wireId: string) => {
    const wireIndex = wires.findIndex((w) => w.id === wireId);
    setWires((prev) => prev.filter((w) => w.id !== wireId));
    setElements((prev) => prev.filter((e) =>
      e.wireIndex !== wireIndex &&
      !(e.targetWireIndices?.includes(wireIndex))
    ));
    setSimulationResult(null);
  }, [wires]);

  const handleWireInitialStateChange = useCallback((wireId: string, newState: QubitInitialState | QumodeInitialState) => {
    setWires((prev) =>
      prev.map((w) =>
        w.id === wireId ? { ...w, initialState: newState } : w
      )
    );
    setSimulationResult(null);
  }, []);

  const handleRemoveElement = useCallback((elementId: string) => {
    setElements((prev) => prev.filter((e) => e.id !== elementId));
    setSimulationResult(null);
  }, []);

  const handleDropGate = useCallback(
    (gate: Gate, wireIndex: number, position: { x: number; y: number }, targetWireIndices?: number[]) => {
      const newElement: CircuitElement = {
        id: `element-${Date.now()}`,
        gateId: gate.id,
        position,
        wireIndex,
        targetWireIndices,
        parameterValues: getDefaultParameters(gate),
      };

      setElements((prev) => [...prev, newElement]);
      setSimulationResult(null);
    },
    []
  );

  const handleDragStart = useCallback(() => {
    // Could track dragged gate if needed
  }, []);

  const handleElementClick = useCallback((element: CircuitElement) => {
    const gate = gatesMap.get(element.gateId);
    if (gate?.parameters && gate.parameters.length > 0) {
      setSelectedElement(element);
    }
  }, [gatesMap]);

  const handleUpdateParameters = useCallback((elementId: string, params: Record<string, number>) => {
    setElements((prev) =>
      prev.map((e) =>
        e.id === elementId ? { ...e, parameterValues: params } : e
      )
    );
    setSimulationResult(null);
  }, []);

  const handleRunSimulation = useCallback(async () => {
    setIsSimulating(true);

    try {
      if (backend === 'python' && backendAvailable) {
        // Use Python backend
        const result = await runBackendSimulation(wires, elements, fockTruncation, postSelections);
        setSimulationResult(result);
      } else {
        // Use browser-based simulation
        // Use setTimeout to allow UI to update before heavy computation
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            try {
              const result = runSimulation(wires, elements, gatesMap, fockTruncation, postSelections);
              setSimulationResult(result);
            } catch (error) {
              console.error('Simulation error:', error);
              alert('Simulation error. Check console for details.');
            }
            resolve();
          }, 10);
        });
      }
    } catch (error) {
      console.error('Simulation error:', error);
      alert(`Simulation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSimulating(false);
    }
  }, [wires, elements, gatesMap, fockTruncation, backend, backendAvailable, postSelections]);

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 px-6 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-emerald-400 bg-clip-text text-transparent">
              HyQSim
            </h1>
            <p className="text-sm text-slate-400">Hybrid Quantum Simulator</p>
          </div>
          <div className="flex items-center gap-6">
            {/* Backend toggle */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Backend:</span>
              <div className="flex bg-slate-700 rounded-md p-0.5">
                <button
                  onClick={() => setBackend('browser')}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    backend === 'browser'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Browser
                </button>
                <button
                  onClick={() => setBackend('python')}
                  disabled={!backendAvailable}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    backend === 'python'
                      ? 'bg-purple-600 text-white'
                      : backendAvailable
                        ? 'text-slate-300 hover:text-white'
                        : 'text-slate-500 cursor-not-allowed'
                  }`}
                  title={backendAvailable ? 'Use Python backend' : 'Python backend not available'}
                >
                  Python
                </button>
              </div>
              {/* Backend status indicator */}
              <div className="flex items-center gap-1">
                <div
                  className={`w-2 h-2 rounded-full ${
                    backendChecking
                      ? 'bg-yellow-500 animate-pulse'
                      : backendAvailable
                        ? 'bg-green-500'
                        : 'bg-red-500'
                  }`}
                />
                <span className="text-[10px] text-slate-500">
                  {backendChecking ? 'checking...' : backendAvailable ? 'connected' : 'offline'}
                </span>
              </div>
            </div>

            <div className="flex flex-col items-end gap-0.5">
              <span className="text-xs text-slate-500">
                CV-DV Hybrid | Fock: {fockTruncation}
              </span>
              <span className="text-xs text-slate-600">
                {elements.length} gate{elements.length !== 1 ? 's' : ''} | {wires.length} wire{wires.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex h-[calc(100vh-80px)]">
        {/* Left sidebar - Gate Palette */}
        <aside className="w-64 p-4 border-r border-slate-700 overflow-hidden">
          <GatePalette onDragStart={handleDragStart} />
        </aside>

        {/* Center - Circuit Canvas */}
        <main className="flex-1 p-4 overflow-hidden">
          <CircuitCanvas
            wires={wires}
            elements={elements}
            onAddWire={handleAddWire}
            onDropGate={handleDropGate}
            onRemoveWire={handleRemoveWire}
            onRemoveElement={handleRemoveElement}
            onElementClick={handleElementClick}
            onWireInitialStateChange={handleWireInitialStateChange}
            gates={gatesMap}
          />
        </main>

        {/* Right sidebar - Display Panel */}
        <aside className="w-80 p-4 border-l border-slate-700 overflow-hidden">
          <DisplayPanel
            wires={wires}
            fockTruncation={fockTruncation}
            onFockTruncationChange={setFockTruncation}
            simulationResult={simulationResult}
            onRunSimulation={handleRunSimulation}
            isSimulating={isSimulating}
            backend={backend}
            postSelections={postSelections}
            onPostSelectionsChange={setPostSelections}
          />
        </aside>
      </div>

      {/* Gate Parameter Editor Modal */}
      {selectedElement && (() => {
        // Get the current element from the array (not the stale selectedElement)
        const currentElement = elements.find(e => e.id === selectedElement.id);
        if (!currentElement) return null;
        const gate = gatesMap.get(currentElement.gateId);
        if (!gate) return null;
        return (
          <GateParameterEditor
            element={currentElement}
            gate={gate}
            onUpdateParameters={handleUpdateParameters}
            onClose={() => setSelectedElement(null)}
          />
        );
      })()}
    </div>
  );
}

export default App;
