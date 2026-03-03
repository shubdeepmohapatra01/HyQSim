/**
 * Custom Generator Parser and Matrix Builder
 *
 * Parses expressions like:
 * - CV: "a + ad", "ad*a", "i*(ad - a)"
 * - DV: "x", "y", "z", "x + y"
 * - Hybrid: "z * n", "x * (a + ad)"
 *
 * And builds the corresponding Hermitian generator matrix.
 */

import type { Complex, Matrix } from './complex';
import {
  complex, ZERO, ONE,
  add, sub, mul, conj,
} from './complex';
import { annihilationMatrix, creationMatrix, numberMatrix } from './qumode';
import { GATES } from './qubit';
import type { GeneratorType, ParsedGenerator } from '../types/circuit';

// Token types for the parser
type TokenType = 'NUMBER' | 'OPERATOR' | 'PAREN' | 'CV_OP' | 'DV_OP' | 'IMAGINARY' | 'END';

interface Token {
  type: TokenType;
  value: string | number;
}

// CV operators: a (annihilation), ad (creation), n (number),
//              q = (a+a†)/√2 (position quadrature x̂),
//              p = i(a†-a)/√2 (momentum quadrature p̂)
const CV_OPERATORS = ['a', 'ad', 'n', 'q', 'p'];
// DV operators: x, y, z (Pauli), I (identity), sp (σ₊=|1⟩⟨0|), sm (σ₋=|0⟩⟨1|)
const DV_OPERATORS = ['x', 'y', 'z', 'I', 'sp', 'sm'];

/**
 * Tokenize the generator expression
 */
function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const expr = expression.replace(/\s+/g, ''); // Remove whitespace

  while (i < expr.length) {
    const char = expr[i];

    // Numbers (including decimals)
    if (/[0-9.]/.test(char)) {
      let num = '';
      while (i < expr.length && /[0-9.]/.test(expr[i])) {
        num += expr[i++];
      }
      tokens.push({ type: 'NUMBER', value: parseFloat(num) });
      continue;
    }

    // Operators: +, -, *
    if (['+', '-', '*'].includes(char)) {
      tokens.push({ type: 'OPERATOR', value: char });
      i++;
      continue;
    }

    // Parentheses
    if (['(', ')'].includes(char)) {
      tokens.push({ type: 'PAREN', value: char });
      i++;
      continue;
    }

    // Imaginary unit
    if (char === 'i' && (i + 1 >= expr.length || !/[a-zA-Z]/.test(expr[i + 1]))) {
      tokens.push({ type: 'IMAGINARY', value: 'i' });
      i++;
      continue;
    }

    // Identifiers (operators)
    if (/[a-zA-Z]/.test(char)) {
      let ident = '';
      while (i < expr.length && /[a-zA-Z]/.test(expr[i])) {
        ident += expr[i++];
      }

      // Check if it's a CV or DV operator
      if (CV_OPERATORS.includes(ident.toLowerCase())) {
        tokens.push({ type: 'CV_OP', value: ident.toLowerCase() });
      } else if (DV_OPERATORS.includes(ident.toLowerCase()) || DV_OPERATORS.includes(ident.toUpperCase())) {
        tokens.push({ type: 'DV_OP', value: ident.toLowerCase() });
      } else {
        throw new Error(`Unknown operator: ${ident}`);
      }
      continue;
    }

    throw new Error(`Unexpected character: ${char}`);
  }

  tokens.push({ type: 'END', value: '' });
  return tokens;
}

/**
 * Determine the generator type from tokens
 */
function determineType(tokens: Token[]): GeneratorType {
  let hasCV = false;
  let hasDV = false;

  for (const token of tokens) {
    if (token.type === 'CV_OP') hasCV = true;
    if (token.type === 'DV_OP' && token.value !== 'i') hasDV = true;
  }

  if (hasCV && hasDV) return 'hybrid';
  if (hasCV) return 'cv';
  if (hasDV) return 'dv';

  throw new Error('Expression must contain at least one operator (a, ad, n, x, y, z)');
}

/**
 * Parse and validate a generator expression
 */
export function parseGeneratorExpression(expression: string): ParsedGenerator {
  try {
    if (!expression || expression.trim() === '') {
      return { type: 'cv', expression: '', isValid: false, error: 'Expression cannot be empty' };
    }

    const tokens = tokenize(expression);
    const type = determineType(tokens);

    return {
      type,
      expression: expression.trim(),
      isValid: true,
    };
  } catch (error) {
    return {
      type: 'cv',
      expression: expression.trim(),
      isValid: false,
      error: error instanceof Error ? error.message : 'Parse error',
    };
  }
}

/**
 * Get the Pauli / ladder matrix for a DV operator
 * sp = σ₊ = |e⟩⟨g| = [[0,0],[1,0]]  (raises ground→excited, NOT Hermitian alone)
 * sm = σ₋ = |g⟩⟨e| = [[0,1],[0,0]]  (lowers excited→ground, NOT Hermitian alone)
 * Note: sp*a + sm*ad IS Hermitian and represents the JC coupling generator.
 */
function getPauliMatrix(op: string): Matrix {
  switch (op.toLowerCase()) {
    case 'x': return GATES.X;
    case 'y': return GATES.Y;
    case 'z': return GATES.Z;
    case 'i': return [[ONE, ZERO], [ZERO, ONE]];
    case 'sp': return [[ZERO, ZERO], [ONE, ZERO]]; // σ₊ = |e⟩⟨g|, raises ground→excited
    case 'sm': return [[ZERO, ONE], [ZERO, ZERO]]; // σ₋ = |g⟩⟨e|, lowers excited→ground
    default: throw new Error(`Unknown DV operator: ${op}`);
  }
}

/**
 * Get the CV operator matrix.
 * q = (a + a†)/√2  — position quadrature x̂
 * p = i(a† - a)/√2 — momentum quadrature p̂
 */
function getCVMatrix(op: string, fockDim: number): Matrix {
  const inv_sqrt2 = 1 / Math.sqrt(2);
  switch (op.toLowerCase()) {
    case 'a':  return annihilationMatrix(fockDim);
    case 'ad': return creationMatrix(fockDim);
    case 'n':  return numberMatrix(fockDim);
    case 'q':  // x̂ = (a + a†)/√2
      return matrixScale(matrixAdd(annihilationMatrix(fockDim), creationMatrix(fockDim)), complex(inv_sqrt2));
    case 'p':  // p̂ = i(a† - a)/√2
      return matrixScale(matrixSub(creationMatrix(fockDim), annihilationMatrix(fockDim)), complex(0, inv_sqrt2));
    default: throw new Error(`Unknown CV operator: ${op}`);
  }
}

/**
 * Create identity matrix
 */
function identityMatrix(dim: number): Matrix {
  const I: Matrix = [];
  for (let i = 0; i < dim; i++) {
    I[i] = [];
    for (let j = 0; j < dim; j++) {
      I[i][j] = i === j ? ONE : ZERO;
    }
  }
  return I;
}

/**
 * Add two matrices
 */
function matrixAdd(A: Matrix, B: Matrix): Matrix {
  const rows = A.length;
  const cols = A[0].length;
  const result: Matrix = [];
  for (let i = 0; i < rows; i++) {
    result[i] = [];
    for (let j = 0; j < cols; j++) {
      result[i][j] = add(A[i][j], B[i][j]);
    }
  }
  return result;
}

/**
 * Subtract two matrices
 */
function matrixSub(A: Matrix, B: Matrix): Matrix {
  const rows = A.length;
  const cols = A[0].length;
  const result: Matrix = [];
  for (let i = 0; i < rows; i++) {
    result[i] = [];
    for (let j = 0; j < cols; j++) {
      result[i][j] = sub(A[i][j], B[i][j]);
    }
  }
  return result;
}

/**
 * Multiply two matrices
 */
function matrixMul(A: Matrix, B: Matrix): Matrix {
  const rowsA = A.length;
  const colsA = A[0].length;
  const colsB = B[0].length;
  const result: Matrix = [];

  for (let i = 0; i < rowsA; i++) {
    result[i] = [];
    for (let j = 0; j < colsB; j++) {
      let sum = ZERO;
      for (let k = 0; k < colsA; k++) {
        sum = add(sum, mul(A[i][k], B[k][j]));
      }
      result[i][j] = sum;
    }
  }
  return result;
}

/**
 * Scale a matrix by a complex number
 */
function matrixScale(A: Matrix, c: Complex): Matrix {
  return A.map(row => row.map(elem => mul(c, elem)));
}

/**
 * Tensor product of two matrices (Kronecker product)
 */
function tensorProduct(A: Matrix, B: Matrix): Matrix {
  const rowsA = A.length;
  const colsA = A[0].length;
  const rowsB = B.length;
  const colsB = B[0].length;

  const result: Matrix = [];
  for (let i = 0; i < rowsA * rowsB; i++) {
    result[i] = [];
    for (let j = 0; j < colsA * colsB; j++) {
      const ai = Math.floor(i / rowsB);
      const bi = i % rowsB;
      const aj = Math.floor(j / colsB);
      const bj = j % colsB;
      result[i][j] = mul(A[ai][aj], B[bi][bj]);
    }
  }
  return result;
}

/**
 * Check if a matrix is Hermitian (A = A†)
 */
export function isHermitian(A: Matrix, tolerance: number = 1e-10): boolean {
  const rows = A.length;
  const cols = A[0].length;

  if (rows !== cols) return false;

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const diff = sub(A[i][j], conj(A[j][i]));
      if (Math.abs(diff.re) > tolerance || Math.abs(diff.im) > tolerance) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Simple recursive descent parser for generator expressions
 */
class GeneratorParser {
  private tokens: Token[];
  private pos: number;
  private fockDim: number;
  private type: GeneratorType;

  constructor(tokens: Token[], fockDim: number, type: GeneratorType) {
    this.tokens = tokens;
    this.pos = 0;
    this.fockDim = fockDim;
    this.type = type;
  }

  private current(): Token {
    return this.tokens[this.pos];
  }

  private consume(expectedType?: TokenType): Token {
    const token = this.current();
    if (expectedType && token.type !== expectedType) {
      throw new Error(`Expected ${expectedType} but got ${token.type}`);
    }
    this.pos++;
    return token;
  }

  // Parse: expr = term (('+' | '-') term)*
  parseExpression(): Matrix {
    let result = this.parseTerm();

    while (this.current().type === 'OPERATOR' &&
           (this.current().value === '+' || this.current().value === '-')) {
      const op = this.consume().value;
      const right = this.parseTerm();

      if (op === '+') {
        result = matrixAdd(result, right);
      } else {
        result = matrixSub(result, right);
      }
    }

    return result;
  }

  // Parse: term = factor ('*' factor)*
  private parseTerm(): Matrix {
    let result = this.parseFactor();

    while (this.current().type === 'OPERATOR' && this.current().value === '*') {
      this.consume(); // consume '*'
      const right = this.parseFactor();

      // Use dimensions to decide: same-size → matrix multiply, different-size → tensor product
      // This correctly handles e.g. z*(ad*a) where ad*a should be matrix-multiplied (both fockDim)
      // and then z (2x2) ⊗ result (fockDim×fockDim) should be tensor-producted
      if (this.type === 'hybrid' && result.length !== right.length) {
        result = tensorProduct(result, right);
      } else {
        result = matrixMul(result, right);
      }
    }

    return result;
  }

  // Parse: factor = [number | 'i'] (operator | '(' expr ')')
  private parseFactor(): Matrix {
    let coefficient: Complex = ONE;

    // Check for leading coefficient or imaginary unit
    if (this.current().type === 'NUMBER') {
      const num = this.consume().value as number;
      coefficient = complex(num);
    }

    if (this.current().type === 'IMAGINARY') {
      this.consume(); // consume 'i'
      coefficient = mul(coefficient, complex(0, 1));
    }

    // Check for another number after 'i'
    if (this.current().type === 'NUMBER') {
      const num = this.consume().value as number;
      coefficient = mul(coefficient, complex(num));
    }

    // Handle '*' between coefficient and operator
    if (this.current().type === 'OPERATOR' && this.current().value === '*') {
      this.consume();
    }

    let matrix: Matrix;

    if (this.current().type === 'PAREN' && this.current().value === '(') {
      this.consume(); // consume '('
      matrix = this.parseExpression();
      if (this.current().type !== 'PAREN' || this.current().value !== ')') {
        throw new Error('Expected closing parenthesis');
      }
      this.consume(); // consume ')'
    } else if (this.current().type === 'CV_OP') {
      const op = this.consume().value as string;
      matrix = getCVMatrix(op, this.fockDim);
    } else if (this.current().type === 'DV_OP') {
      const op = this.consume().value as string;
      matrix = getPauliMatrix(op);
    } else if (coefficient.re !== 1 || coefficient.im !== 0) {
      // Just a coefficient, return scaled identity
      const dim = this.type === 'cv' ? this.fockDim : (this.type === 'dv' ? 2 : this.fockDim * 2);
      return matrixScale(identityMatrix(dim), coefficient);
    } else {
      throw new Error(`Unexpected token: ${this.current().type}`);
    }

    // Apply coefficient
    if (coefficient.re !== 1 || coefficient.im !== 0) {
      matrix = matrixScale(matrix, coefficient);
    }

    return matrix;
  }
}

/**
 * Build the generator matrix from an expression
 */
export function buildGeneratorMatrix(
  expression: string,
  fockDim: number
): { matrix: Matrix; type: GeneratorType; isHermitian: boolean } {
  const parsed = parseGeneratorExpression(expression);

  if (!parsed.isValid) {
    throw new Error(parsed.error || 'Invalid expression');
  }

  const tokens = tokenize(expression);
  const parser = new GeneratorParser(tokens, fockDim, parsed.type);
  const matrix = parser.parseExpression();

  return {
    matrix,
    type: parsed.type,
    isHermitian: isHermitian(matrix),
  };
}

/**
 * Compute matrix exponential e^{-iθA} using scaling-and-squaring + Taylor series.
 *
 * Plain Taylor series diverges for large |θ| or large ||A||. Instead:
 *   1. Form B = -iθA
 *   2. Find m so that ||B||₁ / 2^m < 1
 *   3. Compute exp(B/2^m) via Taylor series (guaranteed to converge)
 *   4. Square m times: exp(B) = exp(B/2^m)^{2^m}
 *
 * This handles the large angles (θ ≈ 28) used in CV QAOA correctly.
 */
export function matrixExponential(A: Matrix, theta: number, terms: number = 30): Matrix {
  const n = A.length;

  // B = -iθA
  const B = matrixScale(A, complex(0, -theta));

  // 1-norm of B (max column sum of absolute values)
  let norm1 = 0;
  for (let j = 0; j < n; j++) {
    let colSum = 0;
    for (let i = 0; i < n; i++) {
      colSum += Math.sqrt(B[i][j].re ** 2 + B[i][j].im ** 2);
    }
    norm1 = Math.max(norm1, colSum);
  }

  // Find m so that norm1 / 2^m ≤ 1
  let m = 0;
  let scaledNorm = norm1;
  while (scaledNorm > 1 && m < 60) {
    scaledNorm /= 2;
    m++;
  }

  // Scaled matrix: B / 2^m
  const sf = Math.pow(2, m);
  const Bs = matrixScale(B, complex(1 / sf));

  // Taylor series for exp(Bs): guaranteed to converge since ||Bs|| ≤ 1
  let result = identityMatrix(n);
  let power = identityMatrix(n);
  for (let k = 1; k <= terms; k++) {
    power = matrixMul(power, Bs);
    power = matrixScale(power, complex(1 / k));
    result = matrixAdd(result, power);
  }

  // Square m times to recover exp(B)
  for (let i = 0; i < m; i++) {
    result = matrixMul(result, result);
  }

  return result;
}

/**
 * Build the unitary matrix U = e^{-iθG} from a generator expression
 */
export function buildCustomUnitary(
  expression: string,
  theta: number,
  fockDim: number
): { unitary: Matrix; type: GeneratorType } {
  const { matrix, type, isHermitian: isHerm } = buildGeneratorMatrix(expression, fockDim);

  if (!isHerm) {
    throw new Error('Generator is not Hermitian. Only Hermitian generators produce unitary operators.');
  }

  const unitary = matrixExponential(matrix, theta);

  return { unitary, type };
}
