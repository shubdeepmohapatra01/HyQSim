import type { JCSweepPoint } from '../benchmarks/sweep';

interface RabiPlotProps {
  data: JCSweepPoint[];
  params: { nSteps: number; g: number; omega: number; tau: number };
  onClose: () => void;
}

// SVG layout constants
const W = 580, H = 300;
const ML = 52, MR = 16, MT = 28, MB = 46;
const PW = W - ML - MR;   // plot width
const PH = H - MT - MB;   // plot height
const Y_MIN = -1.25, Y_MAX = 1.25;

function toX(step: number, nSteps: number) {
  return ML + (step / nSteps) * PW;
}
function toY(val: number) {
  return MT + PH - ((val - Y_MIN) / (Y_MAX - Y_MIN)) * PH;
}

function polyline(pts: [number, number][]): string {
  return pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}

export default function RabiPlot({ data, params, onClose }: RabiPlotProps) {
  const { nSteps, g, tau } = params;
  const T_max = nSteps * g * tau;

  // Build SVG polyline point arrays
  const simN  = data.map(p => [toX(p.step, nSteps), toY(p.nSim)]   as [number, number]);
  const exN   = data.map(p => [toX(p.step, nSteps), toY(p.nExact)] as [number, number]);
  const simSz = data.map(p => [toX(p.step, nSteps), toY(p.szSim)]  as [number, number]);
  const exSz  = data.map(p => [toX(p.step, nSteps), toY(p.szExact)]as [number, number]);

  // Compute max residuals for the annotation
  const maxErrN  = Math.max(...data.map(p => Math.abs(p.nSim  - p.nExact)));
  const maxErrSz = Math.max(...data.map(p => Math.abs(p.szSim - p.szExact)));

  // Y-axis grid lines
  const yTicks = [-1, -0.5, 0, 0.5, 1];
  // X-axis ticks: every 4 steps (or every 2 if nSteps ≤ 8)
  const xTickStep = nSteps <= 8 ? 1 : nSteps <= 16 ? 2 : nSteps <= 32 ? 4 : 8;
  const xTicks: number[] = [];
  for (let s = 0; s <= nSteps; s += xTickStep) xTicks.push(s);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-600 rounded-lg shadow-2xl p-4 w-[640px]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-start mb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">Vacuum Rabi Oscillation</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              |e,0⟩ initial state · g={g}, τ={tau.toFixed(4)}, T<sub>max</sub>={T_max.toFixed(3)} rad
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-lg leading-none ml-4"
          >
            ×
          </button>
        </div>

        {/* SVG plot */}
        <svg width={W} height={H} className="font-mono text-[10px]">
          {/* Grid lines */}
          {yTicks.map(y => (
            <g key={y}>
              <line
                x1={ML} y1={toY(y)} x2={ML + PW} y2={toY(y)}
                stroke={y === 0 ? '#475569' : '#334155'} strokeWidth={y === 0 ? 1 : 0.5}
              />
              <text x={ML - 4} y={toY(y) + 4} textAnchor="end" fill="#94a3b8" fontSize={10}>
                {y}
              </text>
            </g>
          ))}

          {/* Axis box */}
          <rect x={ML} y={MT} width={PW} height={PH} fill="none" stroke="#475569" strokeWidth={1} />

          {/* X ticks + labels */}
          {xTicks.map(s => (
            <g key={s}>
              <line x1={toX(s, nSteps)} y1={MT + PH} x2={toX(s, nSteps)} y2={MT + PH + 4} stroke="#475569" strokeWidth={1} />
              <text x={toX(s, nSteps)} y={MT + PH + 14} textAnchor="middle" fill="#94a3b8" fontSize={10}>{s}</text>
            </g>
          ))}

          {/* Axis labels */}
          <text x={ML + PW / 2} y={H - 4} textAnchor="middle" fill="#64748b" fontSize={10}>
            Trotter step k
          </text>
          <text
            x={12} y={MT + PH / 2} textAnchor="middle" fill="#64748b" fontSize={10}
            transform={`rotate(-90, 12, ${MT + PH / 2})`}
          >
            Expectation value
          </text>

          {/* ⟨n⟩ exact (dashed cyan) */}
          <polyline
            points={polyline(exN)}
            fill="none" stroke="#22d3ee" strokeWidth={1.2} strokeDasharray="5,3" opacity={0.7}
          />
          {/* ⟨σ_z⟩ exact (dashed amber) */}
          <polyline
            points={polyline(exSz)}
            fill="none" stroke="#fbbf24" strokeWidth={1.2} strokeDasharray="5,3" opacity={0.7}
          />

          {/* ⟨n⟩ sim (solid cyan) */}
          <polyline points={polyline(simN)} fill="none" stroke="#06b6d4" strokeWidth={2} />
          {/* ⟨σ_z⟩ sim (solid amber) */}
          <polyline points={polyline(simSz)} fill="none" stroke="#f59e0b" strokeWidth={2} />

          {/* Simulation data dots */}
          {data.map(p => (
            <g key={p.step}>
              <circle cx={toX(p.step, nSteps)} cy={toY(p.nSim)}  r={2} fill="#06b6d4" />
              <circle cx={toX(p.step, nSteps)} cy={toY(p.szSim)} r={2} fill="#f59e0b" />
            </g>
          ))}

          {/* Legend */}
          <g transform={`translate(${ML + PW - 160}, ${MT + 6})`}>
            <rect x={0} y={0} width={155} height={54} rx={3} fill="#0f172a" stroke="#334155" strokeWidth={1} />
            <line x1={8}  y1={13} x2={30} y2={13} stroke="#06b6d4" strokeWidth={2} />
            <circle cx={19} cy={13} r={2} fill="#06b6d4" />
            <text x={34} y={17} fill="#94a3b8" fontSize={10}>⟨n̂⟩ sim</text>
            <line x1={8}  y1={13} x2={30} y2={13} stroke="#22d3ee" strokeWidth={1.2} strokeDasharray="5,3" opacity={0.7} />

            <line x1={8}  y1={29} x2={30} y2={29} stroke="#f59e0b" strokeWidth={2} />
            <circle cx={19} cy={29} r={2} fill="#f59e0b" />
            <text x={34} y={33} fill="#94a3b8" fontSize={10}>⟨σ_z⟩ sim</text>
            <line x1={8}  y1={29} x2={30} y2={29} stroke="#fbbf24" strokeWidth={1.2} strokeDasharray="5,3" opacity={0.7} />

            <line x1={8}  y1={45} x2={30} y2={45} stroke="#64748b" strokeWidth={1.2} strokeDasharray="5,3" />
            <text x={34} y={49} fill="#64748b" fontSize={10}>analytical</text>
          </g>
        </svg>

        {/* Exact formulas + residuals */}
        <div className="mt-2 px-1 flex gap-6 text-[11px]">
          <div>
            <span className="text-cyan-400 font-mono">⟨n̂⟩</span>
            <span className="text-slate-400"> = sin²(k·g·τ)</span>
            <span className="text-slate-500 ml-2">max err: </span>
            <span className={maxErrN < 1e-6 ? 'text-green-400' : maxErrN < 1e-3 ? 'text-yellow-400' : 'text-red-400'}>
              {maxErrN.toExponential(2)}
            </span>
          </div>
          <div>
            <span className="text-amber-400 font-mono">⟨σ_z⟩</span>
            <span className="text-slate-400"> = −cos(2k·g·τ)</span>
            <span className="text-slate-500 ml-2">max err: </span>
            <span className={maxErrSz < 1e-6 ? 'text-green-400' : maxErrSz < 1e-3 ? 'text-yellow-400' : 'text-red-400'}>
              {maxErrSz.toExponential(2)}
            </span>
          </div>
        </div>
        <p className="text-[10px] text-slate-500 mt-1 px-1">
          Full swap at k·g·τ = π/2 ≈ {(Math.PI / 2).toFixed(4)} → step ≈ {(Math.PI / (2 * g * tau)).toFixed(1)}
        </p>
      </div>
    </div>
  );
}
