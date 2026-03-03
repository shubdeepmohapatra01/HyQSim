import { useState, useRef, useEffect } from 'react';
import { BENCHMARKS } from '../benchmarks/circuits';
import type { BenchmarkDefinition } from '../benchmarks/circuits';

// Math expression parser: supports numbers, pi, e, sqrt(), abs(), +, -, *, /, ()
function parseBenchmarkExpr(raw: string): number | null {
  const s = raw.trim().replace(/\s+/g, '');
  if (!s) return null;
  let pos = 0;

  function peek() { return s[pos] ?? ''; }
  function eat() { return s[pos++]; }

  function parseAtom(): number {
    if (peek() === '(') {
      pos++;
      const val = parseAddSub();
      if (peek() !== ')') throw new Error('Expected )');
      pos++;
      return val;
    }
    if (s.startsWith('sqrt(', pos)) {
      pos += 5;
      const arg = parseAddSub();
      if (peek() !== ')') throw new Error('Expected )');
      pos++;
      return Math.sqrt(arg);
    }
    if (s.startsWith('abs(', pos)) {
      pos += 4;
      const arg = parseAddSub();
      if (peek() !== ')') throw new Error('Expected )');
      pos++;
      return Math.abs(arg);
    }
    if (s.startsWith('pi', pos)) { pos += 2; return Math.PI; }
    if (s.startsWith('e', pos) && (pos + 1 >= s.length || !/[0-9a-zA-Z]/.test(s[pos + 1]))) { pos++; return Math.E; }
    const neg = peek() === '-';
    if (neg) pos++;
    let num = '';
    while (pos < s.length && /[0-9.]/.test(s[pos])) num += s[pos++];
    if (!num) throw new Error(`Unexpected char: ${s[pos] ?? 'EOF'}`);
    const n = parseFloat(num);
    return neg ? -n : n;
  }

  function parseMulDiv(): number {
    let left = parseAtom();
    while (pos < s.length && (peek() === '*' || peek() === '/')) {
      const op = eat();
      const right = parseAtom();
      left = op === '*' ? left * right : left / right;
    }
    return left;
  }

  function parseAddSub(): number {
    let left = parseMulDiv();
    while (pos < s.length && (peek() === '+' || peek() === '-')) {
      const op = eat();
      const right = parseMulDiv();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  try {
    const val = parseAddSub();
    if (pos !== s.length) return null;
    return isFinite(val) ? val : null;
  } catch {
    return null;
  }
}

interface BenchmarkMenuProps {
  onLoadBenchmark: (benchmarkId: string, mode: 'new' | 'append' | 'append-new-qubits', params?: Record<string, number>) => void;
  hasExistingCircuit: boolean;
  hasExistingQubits: boolean;
}

export default function BenchmarkMenu({ onLoadBenchmark, hasExistingCircuit, hasExistingQubits }: BenchmarkMenuProps) {
  const [open, setOpen] = useState(false);
  const [selectedBenchmark, setSelectedBenchmark] = useState<BenchmarkDefinition | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, number>>({});
  const [rawInputs, setRawInputs] = useState<Record<string, string>>({});
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
    setRawInputs({});
    setPendingMode(null);
  };

  const handleSelect = (benchmark: BenchmarkDefinition) => {
    if (benchmark.params) {
      // Has parameters — show param form first
      const defaults: Record<string, number> = {};
      const raws: Record<string, string> = {};
      for (const p of benchmark.params) {
        defaults[p.name] = p.defaultValue;
        raws[p.name] = String(p.defaultValue);
      }
      setParamValues(defaults);
      setRawInputs(raws);
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
    // Reject if any text field has an invalid expression
    const allValid = (selectedBenchmark.params ?? []).every(
      (p) => parseBenchmarkExpr(rawInputs[p.name] ?? String(p.defaultValue)) !== null
    );
    if (!allValid) return;
    if (hasExistingCircuit) {
      // Show new/append choice
      setPendingMode('choose');
    } else {
      onLoadBenchmark(selectedBenchmark.id, 'new', paramValues);
      resetState();
    }
  };

  const handleModeChoice = (mode: 'new' | 'append' | 'append-new-qubits') => {
    if (!selectedBenchmark) return;
    onLoadBenchmark(selectedBenchmark.id, mode, selectedBenchmark.params ? paramValues : undefined);
    resetState();
  };

  // Check if selected benchmark needs qubits
  const benchmarkNeedsQubits = selectedBenchmark ? (() => {
    const built = selectedBenchmark.build(selectedBenchmark.params ? paramValues : undefined);
    return built.wires.some(w => w.type === 'qubit');
  })() : false;

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
                  <div className="text-sm text-slate-200">Append (reuse qubits)</div>
                  <div className="text-xs text-slate-400">Reuse existing wires where possible</div>
                </button>
                {hasExistingQubits && benchmarkNeedsQubits && (
                  <button
                    onClick={() => handleModeChoice('append-new-qubits')}
                    className="w-full text-left px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                  >
                    <div className="text-sm text-slate-200">Append (fresh qubits)</div>
                    <div className="text-xs text-slate-400">Reuse qumode but add new qubits</div>
                  </button>
                )}
              </div>
            </div>
          ) : showParamForm ? (
            <div className="p-3">
              <p className="text-sm font-semibold text-slate-200 mb-2">{selectedBenchmark!.name}</p>
              <div className="space-y-3">
                {selectedBenchmark!.params!.map((p) => {
                  const raw = rawInputs[p.name] ?? String(p.defaultValue);
                  const parsed = parseBenchmarkExpr(raw);
                  const isValid = parsed !== null;
                  return (
                    <div key={p.name}>
                      <div className="flex justify-between items-baseline mb-1">
                        <label className="text-xs text-slate-400">{p.label}</label>
                        {isValid && (
                          <span className="text-[10px] text-slate-500 font-mono">= {parsed.toPrecision(6).replace(/\.?0+$/, '')}</span>
                        )}
                      </div>
                      <input
                        type="text"
                        value={raw}
                        onChange={(e) => {
                          const newRaw = e.target.value;
                          setRawInputs((prev) => ({ ...prev, [p.name]: newRaw }));
                          const val = parseBenchmarkExpr(newRaw);
                          if (val !== null) {
                            setParamValues((prev) => ({ ...prev, [p.name]: val }));
                          }
                        }}
                        className={`w-full px-2 py-1.5 bg-slate-900 border rounded text-sm text-white font-mono focus:outline-none focus:ring-1 focus:ring-amber-500 ${
                          isValid ? 'border-slate-600' : 'border-red-500'
                        }`}
                        placeholder={String(p.defaultValue)}
                      />
                    </div>
                  );
                })}
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
