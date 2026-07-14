import type { Fraction } from './types'

const gcd = (a: number, b: number): number => {
  let x = Math.abs(a); let y = Math.abs(b)
  while (y) [x, y] = [y, x % y]
  return x || 1
}
export const fraction = (n = 0, d = 1): Fraction => {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d) || d === 0) throw new Error('Frazione non valida')
  const sign = d < 0 ? -1 : 1; const g = gcd(n, d)
  return { n: sign * n / g, d: Math.abs(d) / g }
}
export const add = (a: Fraction, b: Fraction): Fraction => fraction(a.n * b.d + b.n * a.d, a.d * b.d)
export const sub = (a: Fraction, b: Fraction): Fraction => add(a, fraction(-b.n, b.d))
export const mul = (a: Fraction, b: Fraction): Fraction => fraction(a.n * b.n, a.d * b.d)
export const neg = (a: Fraction): Fraction => fraction(-a.n, a.d)
export const compare = (a: Fraction, b: Fraction): number => Math.sign(a.n * b.d - b.n * a.d)
export const isZero = (a: Fraction): boolean => a.n === 0
export const toNumber = (a: Fraction): number => a.n / a.d
export const formatFraction = (a: Fraction, digits = 2): string => a.d === 1 ? String(a.n) : toNumber(a).toLocaleString('it-IT', { maximumFractionDigits: digits })
