import { useState, useEffect, useRef } from 'react';
import type { QumodeState } from '../types/circuit';

type DisplayMode = 'wigner' | 'fock';

interface QumodeDisplayProps {
  qumodeIndex: number;
  wireIndex: number;
  fockTruncation: number;
  state?: QumodeState;
}

export default function QumodeDisplay({
  qumodeIndex,
  wireIndex,
  fockTruncation,
  state,
}: QumodeDisplayProps) {
  const [mode, setMode] = useState<DisplayMode>('fock');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Use provided state or default to vacuum
  const fockProbabilities = state?.fockProbabilities ?? createVacuumProbabilities(fockTruncation);
  const fockAmplitudes = state?.fockAmplitudes ?? createVacuumAmplitudes(fockTruncation);
  const meanPhotonNumber = state?.meanPhotonNumber ?? 0;
  const precomputedWigner = state?.wignerData;
  const wignerRange = state?.wignerRange ?? 5;
  const densityMatrix = state?.densityMatrix;

  // Generate Wigner function from state
  useEffect(() => {
    if (mode !== 'wigner' || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Use pre-computed Wigner from Python backend if available, otherwise compute locally
    let wigner: number[][];
    let range: number;

    if (precomputedWigner && precomputedWigner.length > 0) {
      // Use pre-computed Wigner from backend (computed from full density matrix)
      wigner = precomputedWigner;
      range = wignerRange;
    } else if (densityMatrix && densityMatrix.length > 0) {
      // Compute from density matrix (handles mixed states correctly)
      const size = 80;
      range = 5;
      wigner = computeWignerFromDensityMatrix(densityMatrix, size, range);
    } else {
      // Fall back to local computation (only accurate for pure states)
      const size = 80;
      range = 4;
      wigner = computeWignerFunction(fockAmplitudes, size, range);
    }

    const size = wigner.length;

    // Find min/max for color scaling
    let minVal = Infinity, maxVal = -Infinity;
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        if (isFinite(wigner[i][j])) {
          minVal = Math.min(minVal, wigner[i][j]);
          maxVal = Math.max(maxVal, wigner[i][j]);
        }
      }
    }
    const absMax = Math.max(Math.abs(minVal), Math.abs(maxVal), 0.01);

    // Draw Wigner function
    const scaleX = canvas.width / size;
    const scaleY = canvas.height / size;

    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        const value = wigner[i][j] / absMax; // Normalize to [-1, 1]

        let r, g, b;
        if (value >= 0) {
          // Positive: blue
          const intensity = Math.min(1, value);
          r = Math.floor(255 * (1 - intensity * 0.8));
          g = Math.floor(255 * (1 - intensity * 0.8));
          b = 255;
        } else {
          // Negative: red
          const intensity = Math.min(1, -value);
          r = 255;
          g = Math.floor(255 * (1 - intensity * 0.8));
          b = Math.floor(255 * (1 - intensity * 0.8));
        }

        ctx.fillStyle = `rgb(${r},${g},${b})`;
        // Note: j is the row (y/p axis), i is the column (x axis)
        ctx.fillRect(i * scaleX, (size - 1 - j) * scaleY, scaleX + 1, scaleY + 1);
      }
    }

    // Draw axes
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Vertical axis (p axis)
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    // Horizontal axis (x axis)
    ctx.moveTo(0, canvas.height / 2);
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
  }, [mode, fockAmplitudes, fockTruncation, precomputedWigner, wignerRange, densityMatrix]);

  // Find max probability for scaling
  const maxProb = Math.max(...fockProbabilities.slice(0, fockTruncation), 0.001);

  return (
    <div className="bg-slate-800 rounded-lg p-3">
      <div className="flex justify-between items-center mb-2">
        <h4 className="text-sm font-semibold text-emerald-400">
          |m{qumodeIndex}⟩ <span className="text-xs text-slate-500">(wire {wireIndex})</span>
        </h4>
        <div className="flex gap-1">
          <button
            onClick={() => setMode('fock')}
            className={`px-2 py-0.5 text-xs rounded transition-colors ${
              mode === 'fock'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            Fock
          </button>
          <button
            onClick={() => setMode('wigner')}
            className={`px-2 py-0.5 text-xs rounded transition-colors ${
              mode === 'wigner'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            Wigner
          </button>
        </div>
      </div>

      <div className="text-xs text-slate-400 mb-2 flex justify-between">
        <span>Fock truncation: {fockTruncation}</span>
        <span className="font-mono">⟨n⟩ = {meanPhotonNumber.toFixed(2)}</span>
      </div>

      {mode === 'fock' ? (
        <div className="bg-slate-900 rounded p-2">
          {/* Top 3 Fock states */}
          <div className="text-[9px] text-slate-400 mb-2 font-mono">
            {(() => {
              const indexed = fockProbabilities.slice(0, fockTruncation).map((p, i) => ({ n: i, p }));
              const top3 = [...indexed].sort((a, b) => b.p - a.p).slice(0, 3);
              return top3.map(({ n, p }) => (
                <span key={n} className="mr-2">
                  |{n}⟩: {(p * 100).toFixed(1)}%
                </span>
              ));
            })()}
          </div>

          {/* Bar chart container */}
          <div className="h-24 flex border-b border-l border-slate-600 relative ml-6">
            {/* Y-axis ticks */}
            <div className="absolute -left-6 top-0 h-full flex flex-col justify-between text-[8px] text-slate-500 w-5 text-right pr-1">
              <span>{(maxProb * 100).toFixed(0)}%</span>
              <span>0</span>
            </div>

            {/* Bars */}
            {fockProbabilities.slice(0, Math.min(fockTruncation, 12)).map((prob, n) => {
              const heightPercent = maxProb > 0 ? (prob / maxProb) * 100 : 0;
              return (
                <div
                  key={n}
                  className="flex-1 flex flex-col justify-end h-full"
                  title={`|${n}⟩: ${(prob * 100).toFixed(2)}%`}
                >
                  <div
                    className="w-full rounded-t-sm mx-px"
                    style={{
                      height: `${Math.max(heightPercent, prob > 0.001 ? 1 : 0)}%`,
                      backgroundColor: prob > 0.01 ? '#10b981' : prob > 0.001 ? '#10b98180' : '#10b98130',
                    }}
                  />
                </div>
              );
            })}
          </div>

          {/* X-axis labels */}
          <div className="flex ml-6 mt-1">
            {fockProbabilities.slice(0, Math.min(fockTruncation, 12)).map((_, n) => (
              <div key={n} className="flex-1 text-center text-[8px] text-slate-500">
                {n}
              </div>
            ))}
          </div>
          <div className="text-[9px] text-slate-500 text-center mt-1">n (photon number)</div>
        </div>
      ) : (
        <div className="relative bg-slate-900 rounded p-2">
          <canvas
            ref={canvasRef}
            width={140}
            height={140}
            className="mx-auto rounded block"
          />
          {/* Axis labels */}
          <div className="flex justify-between text-[9px] text-slate-400 mt-1 px-1">
            <span>-{wignerRange}</span>
            <span>x (position)</span>
            <span>+{wignerRange}</span>
          </div>
          <div className="absolute left-1 top-2 h-[140px] flex flex-col justify-between text-[9px] text-slate-400">
            <span>+{wignerRange}</span>
            <span className="writing-mode-vertical text-[8px]">p</span>
            <span>-{wignerRange}</span>
          </div>
          {/* Color legend */}
          <div className="flex justify-center gap-3 mt-2 text-[9px]">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 bg-blue-500 rounded-sm"></span>
              <span className="text-slate-400">W &gt; 0</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 bg-red-500 rounded-sm"></span>
              <span className="text-slate-400">W &lt; 0</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function createVacuumProbabilities(fockDim: number): number[] {
  const probs = new Array(fockDim).fill(0);
  probs[0] = 1;
  return probs;
}

function createVacuumAmplitudes(fockDim: number): { re: number; im: number }[] {
  const amps: { re: number; im: number }[] = [];
  for (let n = 0; n < fockDim; n++) {
    amps.push({ re: n === 0 ? 1 : 0, im: 0 });
  }
  return amps;
}

// Compute Wigner function W(x, p) from Fock state amplitudes
// Using the characteristic function approach for better numerical stability
function computeWignerFunction(
  amplitudes: { re: number; im: number }[],
  gridSize: number,
  range: number
): number[][] {
  const wigner: number[][] = [];
  const fockDim = amplitudes.length;

  // Precompute factorials (with safeguard for numerical stability)
  const factorials: number[] = [1];
  for (let i = 1; i < fockDim; i++) {
    factorials[i] = factorials[i - 1] * i;
  }

  for (let ix = 0; ix < gridSize; ix++) {
    wigner[ix] = [];
    // x goes from -range to +range
    const x = ((ix + 0.5) / gridSize - 0.5) * 2 * range;

    for (let ip = 0; ip < gridSize; ip++) {
      // p goes from -range to +range
      const p = ((ip + 0.5) / gridSize - 0.5) * 2 * range;

      const r2 = x * x + p * p;
      const expFactor = Math.exp(-2 * r2);
      const prefactor = (2 / Math.PI) * expFactor;

      let W = 0;

      // Diagonal terms: W_{nn} = (2/π) * (-1)^n * exp(-2r²) * L_n(4r²) * |c_n|²
      for (let n = 0; n < fockDim; n++) {
        const prob = amplitudes[n].re * amplitudes[n].re + amplitudes[n].im * amplitudes[n].im;
        const Ln = laguerre(n, 4 * r2);
        const sign = (n % 2 === 0) ? 1 : -1;
        W += prefactor * sign * Ln * prob;
      }

      // Off-diagonal terms: only sum m < n and double (since ρ_{mn} W_{mn} + ρ_{nm} W_{nm} = 2 Re(ρ_{mn} W_{mn}))
      for (let n = 0; n < fockDim; n++) {
        for (let m = 0; m < n; m++) {
          // ρ_{mn} = c_m * c_n*
          const rhoRe = amplitudes[m].re * amplitudes[n].re + amplitudes[m].im * amplitudes[n].im;
          const rhoIm = amplitudes[m].im * amplitudes[n].re - amplitudes[m].re * amplitudes[n].im;

          // Skip if density matrix element is negligible
          if (Math.abs(rhoRe) < 1e-15 && Math.abs(rhoIm) < 1e-15) continue;

          const k = n - m;
          const sqrtFactor = Math.sqrt(factorials[m] / factorials[n]);
          const Lmk = associatedLaguerre(m, k, 4 * r2);
          const sign = (m % 2 === 0) ? 1 : -1;

          // Compute (2(x - ip))^k for W_{mn} where m < n
          // Using the formula: W_{mn} = (2/π) * (-1)^m * exp(-2r²) * sqrt(m!/n!) * (2(x-ip))^(n-m) * L_m^(n-m)(4r²)
          let powRe = 1, powIm = 0;
          for (let i = 0; i < k; i++) {
            const newRe = powRe * 2 * x + powIm * 2 * p;  // (x - ip) means -ip contributes +p to real when multiplied by i
            const newIm = powIm * 2 * x - powRe * 2 * p;  // -ip contribution
            powRe = newRe;
            powIm = newIm;
          }

          const Wmn_re = prefactor * sign * sqrtFactor * Lmk * powRe;
          const Wmn_im = prefactor * sign * sqrtFactor * Lmk * powIm;

          // Contribution: 2 * Re(ρ_{mn} * W_{mn})
          W += 2 * (rhoRe * Wmn_re - rhoIm * Wmn_im);
        }
      }

      wigner[ix][ip] = W;
    }
  }

  return wigner;
}

// Laguerre polynomial L_n(x)
function laguerre(n: number, x: number): number {
  if (n === 0) return 1;
  if (n === 1) return 1 - x;

  let L0 = 1;
  let L1 = 1 - x;

  for (let k = 2; k <= n; k++) {
    const L2 = ((2 * k - 1 - x) * L1 - (k - 1) * L0) / k;
    L0 = L1;
    L1 = L2;
  }

  return L1;
}

// Associated Laguerre polynomial L_n^{(k)}(x)
function associatedLaguerre(n: number, k: number, x: number): number {
  if (n === 0) return 1;
  if (n === 1) return 1 + k - x;

  let L0 = 1;
  let L1 = 1 + k - x;

  for (let m = 2; m <= n; m++) {
    const L2 = ((2 * m - 1 + k - x) * L1 - (m - 1 + k) * L0) / m;
    L0 = L1;
    L1 = L2;
  }

  return L1;
}

// Compute Wigner function from full density matrix (handles mixed states)
function computeWignerFromDensityMatrix(
  rho: { re: number; im: number }[][],
  gridSize: number,
  range: number
): number[][] {
  const wigner: number[][] = [];
  const fockDim = rho.length;

  // Precompute factorials
  const factorials: number[] = [1];
  for (let i = 1; i < fockDim; i++) {
    factorials[i] = factorials[i - 1] * i;
  }

  for (let ix = 0; ix < gridSize; ix++) {
    wigner[ix] = [];
    const x = ((ix + 0.5) / gridSize - 0.5) * 2 * range;

    for (let ip = 0; ip < gridSize; ip++) {
      const p = ((ip + 0.5) / gridSize - 0.5) * 2 * range;

      const r2 = x * x + p * p;
      const expFactor = Math.exp(-2 * r2);
      const prefactor = (2 / Math.PI) * expFactor;

      let W = 0;

      // Sum over all density matrix elements
      for (let m = 0; m < fockDim; m++) {
        for (let n = 0; n < fockDim; n++) {
          const rhoMN_re = rho[m][n].re;
          const rhoMN_im = rho[m][n].im;

          // Skip negligible elements
          if (Math.abs(rhoMN_re) < 1e-15 && Math.abs(rhoMN_im) < 1e-15) continue;

          // W_{mn}(x,p) formula using associated Laguerre polynomials
          let WmnContrib: number;

          if (m === n) {
            // Diagonal: W_{nn} = (2/π) * (-1)^n * exp(-2r²) * L_n(4r²)
            const Ln = laguerre(n, 4 * r2);
            const sign = (n % 2 === 0) ? 1 : -1;
            WmnContrib = prefactor * sign * Ln * rhoMN_re;
          } else if (m < n) {
            // Off-diagonal m < n
            const k = n - m;
            const sqrtFactor = Math.sqrt(factorials[m] / factorials[n]);
            const Lmk = associatedLaguerre(m, k, 4 * r2);
            const sign = (m % 2 === 0) ? 1 : -1;

            // Compute (2(x - ip))^k
            let powRe = 1, powIm = 0;
            for (let i = 0; i < k; i++) {
              const newRe = powRe * 2 * x + powIm * 2 * p;
              const newIm = powIm * 2 * x - powRe * 2 * p;
              powRe = newRe;
              powIm = newIm;
            }

            const Wmn_re = prefactor * sign * sqrtFactor * Lmk * powRe;
            const Wmn_im = prefactor * sign * sqrtFactor * Lmk * powIm;

            // ρ_{mn} * W_{mn} contribution (real part)
            WmnContrib = rhoMN_re * Wmn_re - rhoMN_im * Wmn_im;
          } else {
            // Off-diagonal m > n: use conjugate symmetry
            // W_{mn} = W_{nm}* and ρ_{mn} = ρ_{nm}*
            // So ρ_{mn} * W_{mn} = (ρ_{nm} * W_{nm})*, contributing same real part
            const k = m - n;
            const sqrtFactor = Math.sqrt(factorials[n] / factorials[m]);
            const Lnk = associatedLaguerre(n, k, 4 * r2);
            const sign = (n % 2 === 0) ? 1 : -1;

            // Compute (2(x + ip))^k for m > n (conjugate of the m < n case)
            let powRe = 1, powIm = 0;
            for (let i = 0; i < k; i++) {
              const newRe = powRe * 2 * x - powIm * 2 * p;
              const newIm = powIm * 2 * x + powRe * 2 * p;
              powRe = newRe;
              powIm = newIm;
            }

            const Wmn_re = prefactor * sign * sqrtFactor * Lnk * powRe;
            const Wmn_im = prefactor * sign * sqrtFactor * Lnk * powIm;

            WmnContrib = rhoMN_re * Wmn_re - rhoMN_im * Wmn_im;
          }

          W += WmnContrib;
        }
      }

      wigner[ix][ip] = W;
    }
  }

  return wigner;
}
