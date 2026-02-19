import { useState, useMemo } from 'react';
import type { Gate } from '../types/circuit';
import { QUBIT_GATES, QUMODE_GATES, HYBRID_GATES, CUSTOM_CV_GATES, CUSTOM_CVDV_GATES } from '../types/circuit';
import { parseGeneratorExpression } from '../simulation/customGenerator';

interface SavedCustomGate {
  name: string;
  expression: string;
}

interface GatePaletteProps {
  onDragStart: (gate: Gate) => void;
  savedCustomGates?: SavedCustomGate[];
  onRemoveCustomGate?: (name: string) => void;
}

interface GateButtonProps {
  gate: Gate;
  onDragStart: (gate: Gate) => void;
  colorClass: string;
  generatorExpression?: string;
  onRemove?: () => void;
}

function GateButton({ gate, onDragStart, colorClass, generatorExpression, onRemove }: GateButtonProps) {
  const [showRemove, setShowRemove] = useState(false);

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowRemove(true)}
      onMouseLeave={() => setShowRemove(false)}
    >
      <div
        draggable
        onDragStart={(e) => {
          const gateData = { ...gate };
          // For saved custom gates, include the expression in the drag data
          if (generatorExpression) {
            (gateData as Gate & { generatorExpression: string }).generatorExpression = generatorExpression;
          }
          e.dataTransfer.setData('gate', JSON.stringify(gateData));
          onDragStart(gate);
        }}
        className={`${colorClass} p-2 rounded-lg cursor-grab active:cursor-grabbing
          flex flex-col items-center justify-center min-w-[60px] h-[60px]
          hover:scale-105 transition-transform border border-white/20`}
        title={generatorExpression ? `${gate.description}\nGenerator: ${generatorExpression}` : gate.description}
      >
        <span className="font-bold text-lg">{gate.symbol}</span>
        <span className="text-[10px] opacity-70 truncate max-w-full">{gate.name}</span>
        {generatorExpression && (
          <span className="text-[8px] opacity-50 truncate max-w-full">
            {generatorExpression.length > 10 ? generatorExpression.slice(0, 9) + '…' : generatorExpression}
          </span>
        )}
      </div>
      {/* Remove button for saved custom gates */}
      {onRemove && showRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 hover:bg-red-700 rounded-full text-[10px] flex items-center justify-center"
          title="Remove from palette"
        >
          ×
        </button>
      )}
    </div>
  );
}

interface GateSectionProps {
  title: string;
  gates: Gate[];
  onDragStart: (gate: Gate) => void;
  colorClass: string;
  borderColor: string;
}

function GateSection({ title, gates, onDragStart, colorClass, borderColor }: GateSectionProps) {
  return (
    <div className="mb-4">
      <h3 className={`text-sm font-semibold mb-2 ${borderColor} border-b pb-1`}>{title}</h3>
      <div className="flex flex-wrap gap-2">
        {gates.map((gate) => (
          <GateButton
            key={gate.id}
            gate={gate}
            onDragStart={onDragStart}
            colorClass={colorClass}
          />
        ))}
      </div>
    </div>
  );
}

export default function GatePalette({ onDragStart, savedCustomGates = [], onRemoveCustomGate }: GatePaletteProps) {
  // Convert saved custom gates to Gate objects and auto-sort by expression type
  const { savedCVGates, savedCVDVGates } = useMemo(() => {
    const cv: Array<{ gate: Gate; expression: string }> = [];
    const cvdv: Array<{ gate: Gate; expression: string }> = [];

    for (const saved of savedCustomGates) {
      const parsed = parseGeneratorExpression(saved.expression);
      const isHybrid = parsed.isValid && parsed.type === 'hybrid';

      const entry = {
        gate: {
          id: `custom-saved-${saved.name}`,
          name: saved.name,
          symbol: saved.name,
          category: 'custom' as const,
          description: `Custom: ${saved.expression}`,
          parameters: [
            { name: 'theta', symbol: 'θ', defaultValue: Math.PI / 4, min: -2 * Math.PI, max: 2 * Math.PI, step: 0.1, unit: 'rad' },
          ],
        },
        expression: saved.expression,
      };

      if (isHybrid) {
        cvdv.push(entry);
      } else {
        cv.push(entry);
      }
    }

    return { savedCVGates: cv, savedCVDVGates: cvdv };
  }, [savedCustomGates]);

  return (
    <div className="bg-slate-800 p-4 rounded-xl h-full overflow-y-auto">
      <h2 className="text-lg font-bold mb-4 text-white">Gate Palette</h2>

      <GateSection
        title="Qubit Gates"
        gates={QUBIT_GATES}
        onDragStart={onDragStart}
        colorClass="bg-blue-600 text-white"
        borderColor="border-blue-500"
      />

      <GateSection
        title="Qumode Gates"
        gates={QUMODE_GATES}
        onDragStart={onDragStart}
        colorClass="bg-emerald-600 text-white"
        borderColor="border-emerald-500"
      />

      <GateSection
        title="Hybrid Gates"
        gates={HYBRID_GATES}
        onDragStart={onDragStart}
        colorClass="bg-purple-600 text-white"
        borderColor="border-purple-500"
      />

      {/* Custom CV Gates section */}
      <div className="mb-4">
        <h3 className="text-sm font-semibold mb-2 border-amber-500 border-b pb-1">Custom CV Gates</h3>
        <div className="flex flex-wrap gap-2">
          {CUSTOM_CV_GATES.map((gate) => (
            <GateButton
              key={gate.id}
              gate={gate}
              onDragStart={onDragStart}
              colorClass="bg-amber-600 text-white"
            />
          ))}
          {savedCVGates.map(({ gate, expression }) => (
            <GateButton
              key={gate.id}
              gate={gate}
              onDragStart={onDragStart}
              colorClass="bg-amber-700 text-white"
              generatorExpression={expression}
              onRemove={onRemoveCustomGate ? () => onRemoveCustomGate(gate.name) : undefined}
            />
          ))}
        </div>
      </div>

      {/* Custom CV-DV Gates section */}
      <div className="mb-4">
        <h3 className="text-sm font-semibold mb-2 border-amber-500 border-b pb-1">Custom CV-DV Gates</h3>
        <div className="flex flex-wrap gap-2">
          {CUSTOM_CVDV_GATES.map((gate) => (
            <GateButton
              key={gate.id}
              gate={gate}
              onDragStart={onDragStart}
              colorClass="bg-amber-700 text-white"
            />
          ))}
          {savedCVDVGates.map(({ gate, expression }) => (
            <GateButton
              key={gate.id}
              gate={gate}
              onDragStart={onDragStart}
              colorClass="bg-amber-800 text-white"
              generatorExpression={expression}
              onRemove={onRemoveCustomGate ? () => onRemoveCustomGate(gate.name) : undefined}
            />
          ))}
        </div>
      </div>

      {(savedCVGates.length > 0 || savedCVDVGates.length > 0) && (
        <div className="text-[10px] text-slate-500">
          Hover over saved gates to remove them
        </div>
      )}
    </div>
  );
}
