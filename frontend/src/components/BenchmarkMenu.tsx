import { useState, useRef, useEffect } from 'react';
import { BENCHMARKS } from '../benchmarks/circuits';
import type { BenchmarkDefinition } from '../benchmarks/circuits';

interface BenchmarkMenuProps {
  onLoadBenchmark: (benchmarkId: string, mode: 'new' | 'append', params?: Record<string, number>) => void;
  hasExistingCircuit: boolean;
}

export default function BenchmarkMenu({ onLoadBenchmark, hasExistingCircuit }: BenchmarkMenuProps) {
  const [open, setOpen] = useState(false);
  const [selectedBenchmark, setSelectedBenchmark] = useState<BenchmarkDefinition | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, number>>({});
  const [pendingMode, setPendingMode] = useState<'new' | 'append' | 'choose' | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        resetState();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const resetState = () => {
    setOpen(false);
    setSelectedBenchmark(null);
    setParamValues({});
    setPendingMode(null);
  };

  const handleSelect = (benchmark: BenchmarkDefinition) => {
    if (benchmark.params) {
      // Has parameters — show param form first
      const defaults: Record<string, number> = {};
      for (const p of benchmark.params) defaults[p.name] = p.defaultValue;
      setParamValues(defaults);
      setSelectedBenchmark(benchmark);
      setPendingMode(null);
    } else if (hasExistingCircuit) {
      // No params, but circuit exists — ask new/append
      setSelectedBenchmark(benchmark);
      setPendingMode(null);
    } else {
      // No params, empty circuit — load directly
      onLoadBenchmark(benchmark.id, 'new');
      resetState();
    }
  };

  const handleParamConfirm = () => {
    if (!selectedBenchmark) return;
    if (hasExistingCircuit) {
      // Show new/append choice
      setPendingMode('choose');
    } else {
      onLoadBenchmark(selectedBenchmark.id, 'new', paramValues);
      resetState();
    }
  };

  const handleModeChoice = (mode: 'new' | 'append') => {
    if (!selectedBenchmark) return;
    onLoadBenchmark(selectedBenchmark.id, mode, selectedBenchmark.params ? paramValues : undefined);
    resetState();
  };

  // Determine which view to show
  const showModeChoice = selectedBenchmark && (
    pendingMode === 'choose' || (!selectedBenchmark.params && hasExistingCircuit)
  );
  const showParamForm = selectedBenchmark?.params && pendingMode !== 'choose';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { if (open) resetState(); else setOpen(true); }}
        className="px-2 py-1 text-xs bg-amber-700 hover:bg-amber-600 rounded transition-colors"
      >
        Benchmarks
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-72 bg-slate-800 border border-slate-600 rounded shadow-lg z-50">
          {showModeChoice ? (
            <div className="p-3">
              <p className="text-xs text-slate-300 mb-2">
                Circuit already has wires. How should <strong>{selectedBenchmark!.name}</strong> be loaded?
              </p>
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => handleModeChoice('new')}
                  className="w-full text-left px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                >
                  <div className="text-sm text-slate-200">New Circuit</div>
                  <div className="text-xs text-slate-400">Replace current circuit</div>
                </button>
                <button
                  onClick={() => handleModeChoice('append')}
                  className="w-full text-left px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                >
                  <div className="text-sm text-slate-200">Append to Circuit</div>
                  <div className="text-xs text-slate-400">Reuse existing qumode, add new qubits</div>
                </button>
              </div>
            </div>
          ) : showParamForm ? (
            <div className="p-3">
              <p className="text-sm font-semibold text-slate-200 mb-2">{selectedBenchmark!.name}</p>
              <div className="space-y-3">
                {selectedBenchmark!.params!.map((p) => (
                  <div key={p.name}>
                    <label className="block text-xs text-slate-400 mb-1">{p.label}</label>
                    <input
                      type="number"
                      value={paramValues[p.name] ?? p.defaultValue}
                      min={p.min}
                      max={p.max}
                      step={p.step}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val)) {
                          setParamValues((prev) => ({ ...prev, [p.name]: val }));
                        }
                      }}
                      className="w-full px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-sm text-white font-mono focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => { setSelectedBenchmark(null); setParamValues({}); }}
                  className="flex-1 px-2 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleParamConfirm}
                  className="flex-1 px-2 py-1.5 text-xs bg-amber-700 hover:bg-amber-600 rounded transition-colors font-medium"
                >
                  Load Circuit
                </button>
              </div>
            </div>
          ) : (
            BENCHMARKS.map((b) => (
              <button
                key={b.id}
                onClick={() => handleSelect(b)}
                className="w-full text-left px-3 py-2 hover:bg-slate-700 transition-colors first:rounded-t last:rounded-b"
              >
                <div className="text-sm text-slate-200">{b.name}</div>
                <div className="text-xs text-slate-400">{b.description}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
