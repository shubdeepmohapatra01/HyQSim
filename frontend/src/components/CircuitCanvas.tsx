import { useState, useRef, useEffect } from 'react';
import type { Gate, Wire, CircuitElement, QubitInitialState, QumodeInitialState } from '../types/circuit';
import { parseGeneratorExpression } from '../simulation/customGenerator';

// Cycle through qubit initial states
const QUBIT_STATES: QubitInitialState[] = ['0', '1', '+', '-', 'i', '-i'];
const QUMODE_STATES: QumodeInitialState[] = [0, 1, 2, 3, 4, 5];

function getQubitStateLabel(state: QubitInitialState): string {
  switch (state) {
    case '0': return '|0⟩';
    case '1': return '|1⟩';
    case '+': return '|+⟩';
    case '-': return '|-⟩';
    case 'i': return '|i⟩';
    case '-i': return '|-i⟩';
    default: return '|0⟩';
  }
}

function getQumodeStateLabel(state: QumodeInitialState): string {
  return `|${state}⟩`;
}

interface CircuitCanvasProps {
  wires: Wire[];
  elements: CircuitElement[];
  onAddWire: (type: 'qubit' | 'qumode') => void;
  onDropGate: (gate: Gate, wireIndex: number, position: { x: number; y: number }, targetWireIndices?: number[]) => void;
  onRemoveWire: (wireId: string) => void;
  onRemoveElement: (elementId: string) => void;
  onElementClick: (element: CircuitElement) => void;
  onWireInitialStateChange: (wireId: string, newState: QubitInitialState | QumodeInitialState) => void;
  gates: Map<string, Gate>;
}

export default function CircuitCanvas({
  wires,
  elements,
  onAddWire,
  onDropGate,
  onRemoveWire,
  onRemoveElement,
  onElementClick,
  onWireInitialStateChange,
  gates,
}: CircuitCanvasProps) {
  const [dragOverWire, setDragOverWire] = useState<number | null>(null);
  const [hoveredWire, setHoveredWire] = useState<string | null>(null);
  const [hoveredElement, setHoveredElement] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Ctrl+scroll zoom
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setScale((s) => Math.min(2, Math.max(0.2, s - e.deltaY * 0.002)));
      }
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  // For hybrid gate placement
  const [pendingHybridGate, setPendingHybridGate] = useState<{
    gate: Gate;
    firstWireIndex: number;
    position: { x: number };
  } | null>(null);

  const handleDragOver = (e: React.DragEvent, wireIndex: number) => {
    e.preventDefault();
    setDragOverWire(wireIndex);
  };

  const handleDragLeave = () => {
    setDragOverWire(null);
  };

  const handleDrop = (e: React.DragEvent, wireIndex: number) => {
    e.preventDefault();
    setDragOverWire(null);

    const gateData = e.dataTransfer.getData('gate');
    if (!gateData) return;

    const gate: Gate = JSON.parse(gateData);
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const wire = wires[wireIndex];

    // Determine if this is a custom CV-DV gate (needs hybrid two-drop flow)
    const isCustomCVDV = gate.id === 'custom_cvdv' || (
      gate.category === 'custom' && (gate as Gate & { generatorExpression?: string }).generatorExpression &&
      parseGeneratorExpression((gate as Gate & { generatorExpression?: string }).generatorExpression!).type === 'hybrid'
    );

    // Handle hybrid gates and custom CV-DV gates - need to select both qubit and qumode
    if (gate.category === 'hybrid' || isCustomCVDV) {
      if (!pendingHybridGate) {
        // First drop - store the gate and wait for second wire selection
        setPendingHybridGate({ gate, firstWireIndex: wireIndex, position: { x } });
        return;
      } else {
        // Second drop - complete the hybrid gate placement
        const firstWire = wires[pendingHybridGate.firstWireIndex];
        const secondWire = wire;

        // Validate: need one qubit and one qumode
        const hasQubit = firstWire.type === 'qubit' || secondWire.type === 'qubit';
        const hasQumode = firstWire.type === 'qumode' || secondWire.type === 'qumode';

        if (!hasQubit || !hasQumode) {
          alert('Hybrid gates require both a qubit and a qumode wire');
          setPendingHybridGate(null);
          return;
        }

        // Place the gate - primary wire is qubit, target is qumode
        const qubitWireIndex = firstWire.type === 'qubit' ? pendingHybridGate.firstWireIndex : wireIndex;
        const qumodeWireIndex = firstWire.type === 'qumode' ? pendingHybridGate.firstWireIndex : wireIndex;

        onDropGate(
          pendingHybridGate.gate,
          qubitWireIndex,
          { x: pendingHybridGate.position.x, y: 0 },
          [qumodeWireIndex]
        );
        setPendingHybridGate(null);
        return;
      }
    }

    // Handle 2-qubit gates (like CNOT)
    if (gate.category === 'qubit' && gate.numQubits === 2) {
      if (!pendingHybridGate) {
        setPendingHybridGate({ gate, firstWireIndex: wireIndex, position: { x } });
        return;
      } else {
        const firstWire = wires[pendingHybridGate.firstWireIndex];
        if (firstWire.type !== 'qubit' || wire.type !== 'qubit') {
          alert('CNOT requires two qubit wires');
          setPendingHybridGate(null);
          return;
        }
        onDropGate(
          pendingHybridGate.gate,
          pendingHybridGate.firstWireIndex,
          { x: pendingHybridGate.position.x, y: 0 },
          [wireIndex]
        );
        setPendingHybridGate(null);
        return;
      }
    }

    // Handle 2-qumode gates (like beam splitter)
    if (gate.category === 'qumode' && gate.numQumodes === 2) {
      if (!pendingHybridGate) {
        setPendingHybridGate({ gate, firstWireIndex: wireIndex, position: { x } });
        return;
      } else {
        const firstWire = wires[pendingHybridGate.firstWireIndex];
        if (firstWire.type !== 'qumode' || wire.type !== 'qumode') {
          alert('Beam splitter requires two qumode wires');
          setPendingHybridGate(null);
          return;
        }
        onDropGate(
          pendingHybridGate.gate,
          pendingHybridGate.firstWireIndex,
          { x: pendingHybridGate.position.x, y: 0 },
          [wireIndex]
        );
        setPendingHybridGate(null);
        return;
      }
    }

    // Single-wire gates
    const isQubitGate = gate.category === 'qubit';
    const isQumodeGate = gate.category === 'qumode';

    if (isQubitGate && wire.type !== 'qubit') {
      alert('Qubit gates can only be placed on qubit wires');
      return;
    }
    if (isQumodeGate && wire.type !== 'qumode') {
      alert('Qumode gates can only be placed on qumode wires');
      return;
    }

    // Custom CV gates can only be placed on qumode wires
    const isCustomCV = gate.id === 'custom_cv' || (
      gate.category === 'custom' && !isCustomCVDV && (gate as Gate & { generatorExpression?: string }).generatorExpression &&
      parseGeneratorExpression((gate as Gate & { generatorExpression?: string }).generatorExpression!).type === 'cv'
    );
    if (isCustomCV && wire.type !== 'qumode') {
      alert('Custom CV gates can only be placed on qumode wires');
      return;
    }
    onDropGate(gate, wireIndex, { x, y: 0 });
  };

  const cancelPendingGate = () => {
    setPendingHybridGate(null);
  };

  const cycleInitialState = (wire: Wire) => {
    if (wire.type === 'qubit') {
      const currentState = (wire.initialState as QubitInitialState) || '0';
      const currentIndex = QUBIT_STATES.indexOf(currentState);
      const nextIndex = (currentIndex + 1) % QUBIT_STATES.length;
      onWireInitialStateChange(wire.id, QUBIT_STATES[nextIndex]);
    } else {
      const currentState = (wire.initialState as QumodeInitialState) ?? 0;
      const currentIndex = QUMODE_STATES.indexOf(currentState);
      const nextIndex = (currentIndex + 1) % QUMODE_STATES.length;
      onWireInitialStateChange(wire.id, QUMODE_STATES[nextIndex]);
    }
  };

  const WIRE_HEIGHT = 60;
  const WIRE_START_X = 120;

  // Compute content width from rightmost gate
  const maxElementX = elements.reduce((max, el) => Math.max(max, WIRE_START_X + el.position.x + 40), WIRE_START_X + 200);
  const contentWidth = maxElementX + 60;
  const contentHeight = wires.length * WIRE_HEIGHT + 40;

  return (
    <div className="bg-slate-900 rounded-xl p-4 h-full flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold text-white">Circuit Canvas</h2>
        <div className="flex gap-2">
          <button
            onClick={() => onAddWire('qubit')}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors"
          >
            + Qubit
          </button>
          <button
            onClick={() => onAddWire('qumode')}
            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 rounded text-sm font-medium transition-colors"
          >
            + Qumode
          </button>
        </div>
      </div>

      {/* Pending gate indicator */}
      {pendingHybridGate && (
        <div className="mb-2 p-2 bg-purple-900/50 border border-purple-500 rounded-lg flex justify-between items-center">
          <span className="text-sm text-purple-200">
            Drop <strong>{pendingHybridGate.gate.name}</strong> on the second wire
            ({pendingHybridGate.gate.category === 'hybrid' || pendingHybridGate.gate.id === 'custom_cvdv'
              ? (wires[pendingHybridGate.firstWireIndex]?.type === 'qubit' ? 'qumode' : 'qubit')
              : wires[pendingHybridGate.firstWireIndex]?.type
            })
          </span>
          <button
            onClick={cancelPendingGate}
            className="px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-xs"
          >
            Cancel
          </button>
        </div>
      )}

      <div ref={canvasRef} className="flex-1 overflow-auto bg-slate-950 rounded-lg p-4 min-h-[300px] relative">
        {/* Zoom controls */}
        <div className="absolute bottom-2 right-2 z-10 flex items-center gap-1 bg-slate-800/90 rounded px-2 py-1">
          <button
            onClick={() => setScale((s) => Math.max(0.2, s - 0.1))}
            className="w-6 h-6 text-xs bg-slate-700 hover:bg-slate-600 rounded flex items-center justify-center"
          >
            -
          </button>
          <span className="text-[10px] text-slate-300 w-10 text-center font-mono">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={() => setScale((s) => Math.min(2, s + 0.1))}
            className="w-6 h-6 text-xs bg-slate-700 hover:bg-slate-600 rounded flex items-center justify-center"
          >
            +
          </button>
          {scale !== 1 && (
            <button
              onClick={() => setScale(1)}
              className="ml-1 px-1.5 h-6 text-[10px] bg-slate-700 hover:bg-slate-600 rounded"
            >
              Reset
            </button>
          )}
        </div>

        {wires.length === 0 ? (
          <div className="h-full flex items-center justify-center text-slate-500">
            <p>Add qubits or qumodes to start building your circuit</p>
          </div>
        ) : (
          <svg
            width={contentWidth * scale}
            style={{ minHeight: contentHeight * scale }}
          >
            <g transform={`scale(${scale})`}>
            {/* First render all wires */}
            {wires.map((wire, index) => {
              const y = index * WIRE_HEIGHT + 30;
              const isQubit = wire.type === 'qubit';
              const wireColor = isQubit ? '#3b82f6' : '#10b981';
              const bgColor = isQubit ? '#1e3a5f' : '#134e4a';
              // Compute type-specific label index (count of same-type wires before this one)
              const typeIndex = wires.slice(0, index).filter(w => w.type === wire.type).length;
              const isHovered = hoveredWire === wire.id;
              const isPendingTarget = pendingHybridGate && pendingHybridGate.firstWireIndex !== index;

              return (
                <g
                  key={wire.id}
                  onMouseEnter={() => setHoveredWire(wire.id)}
                  onMouseLeave={() => setHoveredWire(null)}
                >
                  {/* Wire label background - clickable to change initial state */}
                  <rect
                    x={0}
                    y={y - 15}
                    width={100}
                    height={30}
                    fill={bgColor}
                    rx={4}
                    className="cursor-pointer hover:brightness-125 transition-all"
                    onClick={() => cycleInitialState(wire)}
                  />
                  {/* Wire label */}
                  <text
                    x={10}
                    y={y + 5}
                    fill={wireColor}
                    fontSize={14}
                    fontWeight="bold"
                    className="pointer-events-none"
                  >
                    {isQubit ? `q${typeIndex}` : `m${typeIndex}`}
                  </text>
                  {/* Initial state indicator */}
                  <text
                    x={50}
                    y={y + 5}
                    fill={wireColor}
                    fontSize={12}
                    className="pointer-events-none"
                  >
                    {isQubit
                      ? getQubitStateLabel((wire.initialState as QubitInitialState) || '0')
                      : getQumodeStateLabel((wire.initialState as QumodeInitialState) ?? 0)
                    }
                  </text>

                  {/* Delete button - only show on hover */}
                  {isHovered && (
                    <g
                      onClick={() => onRemoveWire(wire.id)}
                      className="cursor-pointer"
                    >
                      <circle cx={85} cy={y} r={10} fill="#dc2626" />
                      <text
                        x={85}
                        y={y + 4}
                        fill="white"
                        fontSize={14}
                        textAnchor="middle"
                        className="pointer-events-none"
                      >
                        ×
                      </text>
                    </g>
                  )}

                  {/* Wire line */}
                  <line
                    x1={WIRE_START_X}
                    y1={y}
                    x2={contentWidth}
                    y2={y}
                    stroke={wireColor}
                    strokeWidth={isQubit ? 2 : 4}
                    strokeDasharray={isQubit ? 'none' : '8,4'}
                  />

                  {/* Drop zone highlight for pending multi-wire gates */}
                  {isPendingTarget && (
                    <rect
                      x={WIRE_START_X}
                      y={y - WIRE_HEIGHT / 2 + 5}
                      width={contentWidth - WIRE_START_X}
                      height={WIRE_HEIGHT - 10}
                      fill="rgba(168, 85, 247, 0.2)"
                      stroke="#a855f7"
                      strokeWidth={2}
                      strokeDasharray="4,4"
                      rx={4}
                    />
                  )}

                  {/* Drop zone (invisible but interactive) */}
                  <rect
                    x={WIRE_START_X}
                    y={y - WIRE_HEIGHT / 2 + 5}
                    width={contentWidth - WIRE_START_X}
                    height={WIRE_HEIGHT - 10}
                    fill={dragOverWire === index ? 'rgba(255,255,255,0.1)' : 'transparent'}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, index)}
                    className="cursor-crosshair"
                  />
                </g>
              );
            })}

            {/* Then render all gates (so they appear on top) */}
            {elements.map((element) => {
              const gate = gates.get(element.gateId);
              if (!gate) return null;

              const primaryY = element.wireIndex * WIRE_HEIGHT + 30;
              const gateX = WIRE_START_X + element.position.x;
              const isHovered = hoveredElement === element.id;

              // Determine gate color
              const gateColor =
                gate.category === 'qubit'
                  ? '#3b82f6'
                  : gate.category === 'qumode'
                  ? '#10b981'
                  : gate.category === 'custom'
                  ? '#d97706'
                  : '#9333ea';

              // Check if this is a multi-wire gate
              const isMultiWire = element.targetWireIndices && element.targetWireIndices.length > 0;

              if (isMultiWire) {
                const targetY = element.targetWireIndices![0] * WIRE_HEIGHT + 30;
                const minY = Math.min(primaryY, targetY);
                const maxY = Math.max(primaryY, targetY);
                const hasParams = gate.parameters && gate.parameters.length > 0;
                const isCustom = gate.category === 'custom';
                const isClickable = hasParams || isCustom;
                const isCNOT = gate.id === 'cnot';
                const isHybrid = gate.category === 'hybrid' || gate.id === 'custom_cvdv';

                return (
                  <g
                    key={element.id}
                    onMouseEnter={() => setHoveredElement(element.id)}
                    onMouseLeave={() => setHoveredElement(null)}
                    className={isClickable ? 'cursor-pointer' : ''}
                  >
                    {/* Vertical connection line between control and target */}
                    <line
                      x1={gateX}
                      y1={primaryY}
                      x2={gateX}
                      y2={targetY}
                      stroke={isCNOT || isHybrid ? 'white' : gateColor}
                      strokeWidth={2}
                      className="pointer-events-none"
                    />

                    {isCNOT && (
                      <>
                        {/* Invisible hit area for hover/delete */}
                        <rect
                          x={gateX - 16}
                          y={minY - 16}
                          width={32}
                          height={maxY - minY + 32}
                          fill="transparent"
                        />
                        {/* Control qubit: filled dot */}
                        <circle
                          cx={gateX}
                          cy={primaryY}
                          r={8}
                          fill="white"
                          className="pointer-events-none"
                        />
                        {/* Target qubit: circle with cross (⊕ symbol) */}
                        <circle
                          cx={gateX}
                          cy={targetY}
                          r={14}
                          fill="none"
                          stroke="white"
                          strokeWidth={2}
                          className="pointer-events-none"
                        />
                        <line
                          x1={gateX - 14}
                          y1={targetY}
                          x2={gateX + 14}
                          y2={targetY}
                          stroke="white"
                          strokeWidth={2}
                          className="pointer-events-none"
                        />
                        <line
                          x1={gateX}
                          y1={targetY - 14}
                          x2={gateX}
                          y2={targetY + 14}
                          stroke="white"
                          strokeWidth={2}
                          className="pointer-events-none"
                        />
                      </>
                    )}

                    {isHybrid && (
                      <>
                        {/* Control dot on qubit wire */}
                        <circle
                          cx={gateX}
                          cy={primaryY}
                          r={8}
                          fill="white"
                          className="pointer-events-none"
                        />
                        {/* Gate box on qumode wire */}
                        <rect
                          x={gateX - 22}
                          y={targetY - 16}
                          width={44}
                          height={32}
                          fill={gateColor}
                          rx={4}
                          stroke={isHovered && isClickable ? '#fbbf24' : 'white'}
                          strokeWidth={2}
                          onClick={() => isClickable && onElementClick(element)}
                        />
                        <text
                          x={gateX}
                          y={targetY + 5}
                          fill="white"
                          fontSize={14}
                          fontWeight="bold"
                          textAnchor="middle"
                          className="pointer-events-none"
                        >
                          {gate.symbol}
                        </text>
                      </>
                    )}

                    {/* Default rendering for other multi-wire gates (e.g. beam splitter) */}
                    {!isCNOT && !isHybrid && (
                      <>
                        <rect
                          x={gateX - 25}
                          y={minY - 20}
                          width={50}
                          height={maxY - minY + 40}
                          fill={gateColor}
                          rx={6}
                          stroke={isHovered && isClickable ? '#fbbf24' : 'white'}
                          strokeWidth={2}
                          onClick={() => isClickable && onElementClick(element)}
                        />
                        <text
                          x={gateX}
                          y={isCustom && element.generatorExpression ? (minY + maxY) / 2 : (minY + maxY) / 2 + 5}
                          fill="white"
                          fontSize={14}
                          fontWeight="bold"
                          textAnchor="middle"
                          className="pointer-events-none"
                        >
                          {gate.symbol}
                        </text>
                        {isCustom && element.generatorExpression && (
                          <text
                            x={gateX}
                            y={(minY + maxY) / 2 + 12}
                            fill="white"
                            fontSize={8}
                            textAnchor="middle"
                            className="pointer-events-none"
                            opacity={0.8}
                          >
                            {element.generatorExpression.length > 8
                              ? element.generatorExpression.slice(0, 7) + '…'
                              : element.generatorExpression}
                          </text>
                        )}
                      </>
                    )}

                    {/* Parameter indicator */}
                    {(hasParams || isCustom) && (
                      <circle
                        cx={gateX + (isCNOT ? 20 : isHybrid ? 28 : 20)}
                        cy={isCNOT ? Math.min(primaryY, targetY) - 5 : isHybrid ? targetY - 12 : minY - 15}
                        r={4}
                        fill="#fbbf24"
                        className="pointer-events-none"
                      />
                    )}

                    {/* Delete button on hover */}
                    {isHovered && (
                      <g
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveElement(element.id);
                        }}
                        className="cursor-pointer"
                      >
                        <circle cx={gateX + 22} cy={minY - 10} r={10} fill="#dc2626" />
                        <text
                          x={gateX + 22}
                          y={minY - 6}
                          fill="white"
                          fontSize={14}
                          textAnchor="middle"
                        >
                          ×
                        </text>
                      </g>
                    )}
                  </g>
                );
              }

              // Single-wire gate rendering
              const hasParams = gate.parameters && gate.parameters.length > 0;
              const isCustom = gate.category === 'custom';
              const isClickable = hasParams || isCustom;
              const needsConfig = isCustom && !element.generatorExpression;
              return (
                <g
                  key={element.id}
                  onMouseEnter={() => setHoveredElement(element.id)}
                  onMouseLeave={() => setHoveredElement(null)}
                  className={isClickable ? 'cursor-pointer' : ''}
                >
                  <rect
                    x={gateX - 20}
                    y={primaryY - 20}
                    width={40}
                    height={40}
                    fill={gateColor}
                    rx={6}
                    stroke={isHovered && isClickable ? '#fbbf24' : needsConfig ? '#ef4444' : 'white'}
                    strokeWidth={isHovered && isClickable ? 2 : needsConfig ? 2 : 1}
                    strokeDasharray={needsConfig ? '4,2' : 'none'}
                    onClick={() => isClickable && onElementClick(element)}
                  />
                  <text
                    x={gateX}
                    y={isCustom && element.generatorExpression ? primaryY : primaryY + 5}
                    fill="white"
                    fontSize={14}
                    fontWeight="bold"
                    textAnchor="middle"
                    className="pointer-events-none"
                  >
                    {gate.symbol}
                  </text>
                  {/* Show generator expression for custom gates */}
                  {isCustom && element.generatorExpression && (
                    <text
                      x={gateX}
                      y={primaryY + 12}
                      fill="white"
                      fontSize={8}
                      textAnchor="middle"
                      className="pointer-events-none"
                      opacity={0.8}
                    >
                      {element.generatorExpression.length > 8
                        ? element.generatorExpression.slice(0, 7) + '…'
                        : element.generatorExpression}
                    </text>
                  )}

                  {/* Parameter/config indicator */}
                  {(hasParams || needsConfig) && (
                    <circle
                      cx={gateX + 15}
                      cy={primaryY - 15}
                      r={4}
                      fill={needsConfig ? '#ef4444' : '#fbbf24'}
                      className="pointer-events-none"
                    />
                  )}

                  {/* Delete button on hover */}
                  {isHovered && (
                    <g
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveElement(element.id);
                      }}
                      className="cursor-pointer"
                    >
                      <circle cx={gateX + 25} cy={primaryY + 15} r={10} fill="#dc2626" />
                      <text
                        x={gateX + 25}
                        y={primaryY + 19}
                        fill="white"
                        fontSize={14}
                        textAnchor="middle"
                      >
                        ×
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
            </g>
          </svg>
        )}
      </div>
    </div>
  );
}
