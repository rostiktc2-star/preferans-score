export class BotRandom {
  #state: number
  constructor(seed: number | string) {
    if (typeof seed === 'number') this.#state = seed >>> 0
    else { let hash = 2166136261; for (const char of seed) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619) } this.#state = hash >>> 0 }
  }
  next(): number { this.#state += 0x6d2b79f5; let t = this.#state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296 }
  integer(max: number): number { return Math.floor(this.next() * max) }
  shuffle<T>(values: readonly T[]): T[] { const result = [...values]; for (let i = result.length - 1; i > 0; i -= 1) { const j = this.integer(i + 1); [result[i], result[j]] = [result[j]!, result[i]!] } return result }
}
