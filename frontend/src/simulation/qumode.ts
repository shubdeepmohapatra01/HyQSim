// Qumode (bosonic mode) simulation using Fock basis

import type { Complex, StateVector, Matrix } from './complex';
import {
  complex, ONE, ZERO,
  add, mul, scale, conj, abs2, fromPolar,
  matVecMul, normalize, identity,
} from './complex';
import type { QumodeState } from '../types/circuit';

// Initialize qumode in vacuum state |0⟩
export function initQumode(fockDim: number): StateVector {
  const state: StateVector = [];
  for (let n = 0; n < fockDim; n++) {
    state.push(n === 0 ? ONE : ZERO);
  }
  return state;
}

// Initialize in Fock state |n⟩
export function initFockState(n: number, fockDim: number): StateVector {
  const state: StateVector = [];
  for (let i = 0; i < fockDim; i++) {
    state.push(i === n ? ONE : ZERO);
  }
  return state;
}

// Annihilation operator a (lowers photon number)
export function annihilationMatrix(fockDim: number): Matrix {
  const a: Matrix = [];
  for (let m = 0; m < fockDim; m++) {
    a[m] = [];
    for (let n = 0; n < fockDim; n++) {
      // ⟨m|a|n⟩ = √n δ_{m,n-1}
      if (m === n - 1) {
        a[m][n] = complex(Math.sqrt(n));
      } else {
        a[m][n] = ZERO;
      }
    }
  }
  return a;
}

// Creation operator a† (raises photon number)
export function creationMatrix(fockDim: number): Matrix {
  const adag: Matrix = [];
  for (let m = 0; m < fockDim; m++) {
    adag[m] = [];
    for (let n = 0; n < fockDim; n++) {
      // ⟨m|a†|n⟩ = √(n+1) δ_{m,n+1}
      if (m === n + 1) {
        adag[m][n] = complex(Math.sqrt(n + 1));
      } else {
        adag[m][n] = ZERO;
      }
    }
  }
  return adag;
}

// Number operator n = a†a
export function numberMatrix(fockDim: number): Matrix {
  const N: Matrix = [];
  for (let m = 0; m < fockDim; m++) {
    N[m] = [];
    for (let n = 0; n < fockDim; n++) {
      N[m][n] = m === n ? complex(m) : ZERO;
    }
  }
  return N;
}

// Displacement operator D(α) = exp(α a† - α* a)
// Using truncated Taylor series / matrix exponentiation
export function displacementMatrix(alpha: Complex, fockDim: number): Matrix {
  // For numerical stability, we compute D(α)|n⟩ directly
  // D(α)|n⟩ = e^{-|α|²/2} Σ_m (α^{m-n} / √(m!n!)) √(n!/m!) L_n^{m-n}(|α|²) |m⟩
  // Simpler: use the recursion relation

  const D: Matrix = [];
  const alphaMag2 = abs2(alpha);
  const prefactor = Math.exp(-alphaMag2 / 2);

  for (let m = 0; m < fockDim; m++) {
    D[m] = [];
    for (let n = 0; n < fockDim; n++) {
      // D_{mn} = ⟨m|D(α)|n⟩
      // = e^{-|α|²/2} √(n!/m!) α^{m-n} L_n^{m-n}(|α|²)  for m ≥ n
      // = e^{-|α|²/2} √(m!/n!) (-α*)^{n-m} L_m^{n-m}(|α|²)  for m < n

      let value: Complex;
      if (m >= n) {
        const k = m - n;
        const sqrtFactor = Math.sqrt(factorial(n) / factorial(m));
        const alphaPow = complexPow(alpha, k);
        const laguerre = associatedLaguerre(n, k, alphaMag2);
        value = scale(alphaPow, prefactor * sqrtFactor * laguerre);
      } else {
        const k = n - m;
        const sqrtFactor = Math.sqrt(factorial(m) / factorial(n));
        const minusAlphaConj = { re: -conj(alpha).re, im: -conj(alpha).im };
        const alphaPow = complexPow(minusAlphaConj, k);
        const laguerre = associatedLaguerre(m, k, alphaMag2);
        value = scale(alphaPow, prefactor * sqrtFactor * laguerre);
      }
      D[m][n] = value;
    }
  }
  return D;
}

// Squeezing operator S(z) where z = r * e^{iφ}
export function squeezingMatrix(r: number, phi: number, fockDim: number): Matrix {
  // Use the accurate computation
  return computeSqueezingMatrix(r, phi, fockDim);
}

// More accurate squeezing matrix computation
function computeSqueezingMatrix(r: number, phi: number, fockDim: number): Matrix {
  const S: Matrix = identity(fockDim);

  if (Math.abs(r) < 1e-10) return S;

  const mu = Math.cosh(r);
  const nu = Math.sinh(r);
  const expIPhi = fromPolar(1, phi);

  // Compute matrix elements using the formula
  for (let m = 0; m < fockDim; m++) {
    for (let n = 0; n < fockDim; n++) {
      if ((m + n) % 2 !== 0) {
        S[m][n] = ZERO;
        continue;
      }

      const minMN = Math.min(m, n);
      let sum = ZERO;

      for (let j = 0; j <= minMN; j++) {
        if ((m - j) % 2 !== 0) continue;
        const p = (m - j) / 2;
        const q = (n - j) / 2;

        if (p < 0 || q < 0) continue;

        const coeff =
          Math.sqrt(factorial(m) * factorial(n)) /
          (factorial(j) * factorial(p) * factorial(q) * Math.pow(2, p + q));

        const muPow = Math.pow(1 / mu, j + 1);
        const nuMuPow = Math.pow(-nu / mu, p + q);

        const phase = complexPow(expIPhi, q - p);
        const term = scale(phase, coeff * muPow * nuMuPow);
        sum = add(sum, term);
      }

      S[m][n] = sum;
    }
  }

  return S;
}

// Phase rotation R(θ) = exp(-iθn)
export function rotationMatrix(theta: number, fockDim: number): Matrix {
  const R: Matrix = [];
  for (let m = 0; m < fockDim; m++) {
    R[m] = [];
    for (let n = 0; n < fockDim; n++) {
      if (m === n) {
        R[m][n] = fromPolar(1, -theta * m);
      } else {
        R[m][n] = ZERO;
      }
    }
  }
  return R;
}

// Kerr interaction K(κ) = exp(-iκ n²)
export function kerrMatrix(kappa: number, fockDim: number): Matrix {
  const K: Matrix = [];
  for (let m = 0; m < fockDim; m++) {
    K[m] = [];
    for (let n = 0; n < fockDim; n++) {
      if (m === n) {
        K[m][n] = fromPolar(1, -kappa * m * m);
      } else {
        K[m][n] = ZERO;
      }
    }
  }
  return K;
}
// Apply a matrix operator to a state
export function applyOperator(state: StateVector, operator: Matrix): StateVector {
  return normalize(matVecMul(operator, state));
}

// Apply gate by name
export function applyQumodeGate(
  state: StateVector,
  gateName: string,
  params: Record<string, number>,
  fockDim: number
): StateVector {
  let operator: Matrix;

  switch (gateName) {
    case 'displace': {
      const alpha: Complex = { re: params.alpha_re ?? 0, im: params.alpha_im ?? 0 };
      operator = displacementMatrix(alpha, fockDim);
      break;
    }
    case 'squeeze': {
      const r = params.r ?? 0;
      const phi = params.phi ?? 0;
      operator = squeezingMatrix(r, phi, fockDim);
      break;
    }
    case 'rotate': {
      const theta = params.theta ?? 0;
      operator = rotationMatrix(theta, fockDim);
      break;
    }
    case 'kerr': {
      const kappa = params.kappa ?? 0;
      operator = kerrMatrix(kappa, fockDim);
      break;
    }
    default:
      return state;
  }

  return applyOperator(state, operator);
}

// Convert state vector to QumodeState
export function stateVectorToQumodeState(state: StateVector): QumodeState {
  const fockProbabilities = state.map((c) => abs2(c));
  const fockAmplitudes = state.map((c) => ({ re: c.re, im: c.im }));

  // Mean photon number ⟨n⟩ = Σ n |c_n|²
  let meanPhotonNumber = 0;
  for (let n = 0; n < state.length; n++) {
    meanPhotonNumber += n * fockProbabilities[n];
  }

  return {
    fockAmplitudes,
    fockProbabilities,
    meanPhotonNumber,
  };
}

// Beam splitter unitary for two qumodes
// U = exp(theta * (e^{i*phi} a†b - e^{-i*phi} ab†))
// Returns a (fockDim²) × (fockDim²) matrix in the 2-mode Fock basis |m⟩_a ⊗ |n⟩_b
// indexed as m * fockDim + n.
// Exploits conservation of total photon number N = m + n:
// decomposes into independent N-photon sectors and exponentiates each via scaling+squaring.
export function beamSplitterMatrix(theta: number, phi: number, fockDim: number): Matrix {
  const totalDim = fockDim * fockDim;
  const result: Matrix = [];
  for (let i = 0; i < totalDim; i++) {
    result[i] = new Array(totalDim).fill(ZERO);
  }

  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);

  for (let N = 0; N <= 2 * (fockDim - 1); N++) {
    const kMin = Math.max(0, N - (fockDim - 1));
    const kMax = Math.min(N, fockDim - 1);
    const sectorDim = kMax - kMin + 1;

    // Trivial 1×1 sector: the state is already an eigenstate
    if (sectorDim === 1) {
      const fullIdx = kMin * fockDim + (N - kMin);
      result[fullIdx][fullIdx] = ONE;
      continue;
    }

    // Build anti-Hermitian generator G_N in the N-photon sector basis
    // {|kMin, N-kMin⟩, |kMin+1, N-kMin-1⟩, ...}
    // G|k, N-k⟩ = e^{i*phi}√((k+1)(N-k))|k+1,N-k-1⟩ - e^{-i*phi}√(k(N-k+1))|k-1,N-k+1⟩
    const G: Complex[][] = [];
    for (let s = 0; s < sectorDim; s++) {
      G[s] = new Array(sectorDim).fill(ZERO);
    }

    for (let s = 0; s < sectorDim; s++) {
      const k = kMin + s;
      const nk = N - k;
      // a†b: k → k+1 (raise mode a, lower mode b)
      if (s + 1 < sectorDim && nk > 0) {
        const c = Math.sqrt((k + 1) * nk);
        G[s + 1][s] = { re: cosP * c, im: sinP * c }; // e^{i*phi} * c
      }
      // ab†: k → k-1 (lower mode a, raise mode b)
      if (s - 1 >= 0 && k > 0) {
        const c = Math.sqrt(k * (nk + 1));
        G[s - 1][s] = { re: -cosP * c, im: sinP * c }; // -e^{-i*phi} * c
      }
    }

    // thetaG = theta * G, then exp(thetaG) via scaling+squaring
    const thetaG: Complex[][] = G.map(row => row.map(c => ({ re: c.re * theta, im: c.im * theta })));
    const expG = bsMatExpScaleSquare(thetaG, sectorDim);

    // Write sector result back into the full 2-mode matrix
    for (let sRow = 0; sRow < sectorDim; sRow++) {
      const kRow = kMin + sRow;
      const fullRow = kRow * fockDim + (N - kRow);
      for (let sCol = 0; sCol < sectorDim; sCol++) {
        const kCol = kMin + sCol;
        const fullCol = kCol * fockDim + (N - kCol);
        result[fullRow][fullCol] = expG[sRow][sCol];
      }
    }
  }

  return result;
}

// --- Helpers for beamSplitterMatrix ---

function bsMatMul(A: Complex[][], B: Complex[][], dim: number): Complex[][] {
  const C: Complex[][] = [];
  for (let i = 0; i < dim; i++) {
    C[i] = new Array(dim).fill(ZERO);
    for (let k = 0; k < dim; k++) {
      if (A[i][k].re === 0 && A[i][k].im === 0) continue;
      for (let j = 0; j < dim; j++) {
        C[i][j] = {
          re: C[i][j].re + A[i][k].re * B[k][j].re - A[i][k].im * B[k][j].im,
          im: C[i][j].im + A[i][k].re * B[k][j].im + A[i][k].im * B[k][j].re,
        };
      }
    }
  }
  return C;
}

function bsIdentity(dim: number): Complex[][] {
  const I: Complex[][] = [];
  for (let i = 0; i < dim; i++) {
    I[i] = new Array(dim).fill(ZERO);
    I[i][i] = ONE;
  }
  return I;
}

// Matrix exponential via scaling and squaring + Taylor series
function bsMatExpScaleSquare(A: Complex[][], dim: number): Complex[][] {
  // Estimate 1-norm (max column sum of absolute values)
  let norm1 = 0;
  for (let j = 0; j < dim; j++) {
    let colSum = 0;
    for (let i = 0; i < dim; i++) {
      colSum += Math.sqrt(A[i][j].re * A[i][j].re + A[i][j].im * A[i][j].im);
    }
    norm1 = Math.max(norm1, colSum);
  }

  // Scale down: find m so that norm / 2^m < 0.5
  let m = 0;
  let scaledNorm = norm1;
  while (scaledNorm > 0.5 && m < 24) {
    scaledNorm /= 2;
    m++;
  }

  const sf = Math.pow(2, m);
  const scaledA: Complex[][] = A.map(row => row.map(c => ({ re: c.re / sf, im: c.im / sf })));

  // Taylor series: exp(A) = I + A + A²/2! + ... (25 terms)
  let result = bsIdentity(dim);
  let power = bsIdentity(dim);

  for (let k = 1; k <= 25; k++) {
    const newPower = bsMatMul(power, scaledA, dim);
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        newPower[i][j] = { re: newPower[i][j].re / k, im: newPower[i][j].im / k };
      }
    }
    power = newPower;
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        result[i][j] = { re: result[i][j].re + power[i][j].re, im: result[i][j].im + power[i][j].im };
      }
    }
  }

  // Square m times to recover exp(A) from exp(A/2^m)
  for (let i = 0; i < m; i++) {
    result = bsMatMul(result, result, dim);
  }

  return result;
}

// Helper functions
function factorial(n: number): number {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) {
    result *= i;
  }
  return result;
}

function complexPow(z: Complex, n: number): Complex {
  if (n === 0) return ONE;
  if (n === 1) return z;

  let result = ONE;
  for (let i = 0; i < n; i++) {
    result = mul(result, z);
  }
  return result;
}

// Associated Laguerre polynomial L_n^k(x)
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
