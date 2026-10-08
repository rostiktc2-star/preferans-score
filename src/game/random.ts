export interface RandomProvider {
  next(): number
  integer(maxExclusive: number): number
  shuffle<T>(values: readonly T[]): T[]
}

function hashSeed(seed: number | string): number {
  if (typeof seed === 'number') return seed >>> 0
  let hash = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export class SeededRandomProvider implements RandomProvider {
  #state: number

  constructor(seed: number | string) {
    this.#state = hashSeed(seed)
  }

  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0
    let value = this.#state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }

  integer(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) throw new Error('maxExclusive must be positive')
    return Math.floor(this.next() * maxExclusive)
  }

  shuffle<T>(values: readonly T[]): T[] {
    const result = [...values]
    for (let index = result.length - 1; index > 0; index -= 1) {
      const other = this.integer(index + 1)
      ;[result[index], result[other]] = [result[other]!, result[index]!]
    }
    return result
  }
}

export class CryptoRandomProvider implements RandomProvider {
  next(): number {
    const values = new Uint32Array(1)
    crypto.getRandomValues(values)
    return values[0]! / 4294967296
  }

  integer(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) throw new Error('maxExclusive must be positive')
    const limit = Math.floor(4294967296 / maxExclusive) * maxExclusive
    let value: number
    do {
      const values = new Uint32Array(1)
      crypto.getRandomValues(values)
      value = values[0]!
    } while (value >= limit)
    return value % maxExclusive
  }

  shuffle<T>(values: readonly T[]): T[] {
    const result = [...values]
    for (let index = result.length - 1; index > 0; index -= 1) {
      const other = this.integer(index + 1)
      ;[result[index], result[other]] = [result[other]!, result[index]!]
    }
    return result
  }
}
