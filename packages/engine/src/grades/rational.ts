/**
 * Frações exatas com BigInt: toda conta de nota é feita sem ponto flutuante (nada de 5,9999…).
 * Notas entram e saem em centésimos de ponto (7,5 → 750); pesos como "0.4" viram 2/5.
 */
export interface Rational {
  readonly n: bigint;
  readonly d: bigint;
}

const abs = (x: bigint) => (x < 0n ? -x : x);
function gcd(a: bigint, b: bigint): bigint {
  a = abs(a);
  b = abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}

export function rat(n: bigint | number, d: bigint | number = 1n): Rational {
  let nn = BigInt(n);
  let dd = BigInt(d);
  if (dd === 0n) throw new RangeError("divisão por zero");
  if (dd < 0n) {
    nn = -nn;
    dd = -dd;
  }
  const g = gcd(nn, dd);
  return { n: nn / g, d: dd / g };
}

export const ZERO = rat(0);
export const add = (a: Rational, b: Rational) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Rational, b: Rational) => rat(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Rational, b: Rational) => rat(a.n * b.n, a.d * b.d);
export const div = (a: Rational, b: Rational) => {
  if (b.n === 0n) throw new RangeError("divisão por zero");
  return rat(a.n * b.d, a.d * b.n);
};
export const cmp = (a: Rational, b: Rational) => {
  const x = a.n * b.d - b.n * a.d;
  return x < 0n ? -1 : x > 0n ? 1 : 0;
};
export const min = (a: Rational, b: Rational) => (cmp(a, b) <= 0 ? a : b);
export const max = (a: Rational, b: Rational) => (cmp(a, b) >= 0 ? a : b);

/** "0.4" ou "12" → fração exata. */
export function fromDecimal(text: string): Rational {
  const m = /^(\d+)(?:[.,](\d+))?$/.exec(text);
  if (!m) throw new RangeError(`número inválido: ${text}`);
  const frac = m[2] ?? "";
  return rat(BigInt(m[1]! + frac), 10n ** BigInt(frac.length));
}

/** Centésimos de ponto (inteiro) → fração em pontos. */
export const fromCenti = (centi: number) => rat(BigInt(Math.round(centi)), 100n);

/** Fração em pontos → centésimos, arredondando meio para cima (0,005 → 0,01). */
export function toCenti(r: Rational): number {
  const scaled = r.n * 100n;
  const q = scaled / r.d;
  const rem = scaled % r.d;
  // meio para cima, simétrico para negativos (não esperados em notas)
  const up = abs(rem) * 2n >= r.d ? (scaled < 0n ? -1n : 1n) : 0n;
  return Number(q + up);
}

/** Arredonda para múltiplos de `step` centésimos (10 = 0,1; 50 = 0,5), meio para cima. */
export function roundToStep(centi: number, step: number): number {
  if (step <= 1) return centi;
  return Math.floor((centi + step / 2) / step) * step;
}

/**
 * Nota final em centésimos a partir do valor exato. step 1 = sem arredondamento: corta nos
 * centésimos (5,996 → 5,99, nunca "passa" por arredondar). step > 1: meio para cima no múltiplo
 * (step 50: 5,75 → 6,0; 5,7 → 5,5).
 */
export function roundRational(r: Rational, step: number): number {
  const s = BigInt(step);
  if (step <= 1) {
    const scaled = r.n * 100n;
    const q = scaled / r.d;
    return Number(scaled < 0n && scaled % r.d !== 0n ? q - 1n : q);
  }
  // floor((x*100 + step/2) / step) * step, exato
  const num = r.n * 200n + s * r.d;
  const den = 2n * s * r.d;
  const q = num / den;
  return Number((num < 0n && num % den !== 0n ? q - 1n : q) * s);
}
