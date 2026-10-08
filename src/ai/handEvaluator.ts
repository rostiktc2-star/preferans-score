import { ContractKind, Rank, Suit, type Bid, type Card, type ContractLevel, type Trump } from '../game/model'
import type { ContractEvaluation, MizerEvaluation } from './types'

const SUITS = Object.values(Suit)
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value))

export class HandEvaluator {
  readonly #contractCache = new Map<string, ContractEvaluation>()
  readonly #mizerCache = new Map<string, MizerEvaluation>()

  evaluateContract(hand: readonly Card[], level: ContractLevel, trump: Trump): ContractEvaluation {
    const cacheKey = `${hand.map(card => card.id).sort().join(',')}|${level}|${trump}`
    const cached = this.#contractCache.get(cacheKey)
    if (cached) return cached
    const bySuit = Object.fromEntries(SUITS.map(suit => [suit, hand.filter(card => card.suit === suit).sort((a, b) => b.numericStrength - a.numericStrength)])) as Record<Suit, Card[]>
    let certain = 0, likely = 0
    for (const suit of SUITS) {
      const ranks = new Set(bySuit[suit].map(card => card.rank))
      if (ranks.has(Rank.ACE)) { certain += 1; likely += 1 }
      if (ranks.has(Rank.KING)) likely += ranks.has(Rank.ACE) ? .85 : .38
      if (ranks.has(Rank.QUEEN)) likely += ranks.has(Rank.ACE) && ranks.has(Rank.KING) ? .72 : .2
      if (bySuit[suit].length >= 5) likely += (bySuit[suit].length - 4) * .42
    }
    if (trump !== 'NT') {
      const trumps = bySuit[trump]
      const topControl = trumps.some(card => card.rank === Rank.ACE) ? .8 : trumps.some(card => card.rank === Rank.KING) ? .35 : 0
      likely += Math.max(0, trumps.length - 2) * .48 + topControl
      for (const suit of SUITS.filter(suit => suit !== trump)) if (bySuit[suit].length <= 1 && trumps.length >= 4) likely += .38
    } else {
      likely += SUITS.filter(suit => bySuit[suit][0]?.rank === Rank.ACE).length * .22
      likely -= SUITS.filter(suit => bySuit[suit].length === 1 && bySuit[suit][0]!.rank >= Rank.QUEEN).length * .18
    }
    const expectedTricks = Math.min(10, certain * .35 + likely)
    const margin = expectedTricks - level
    const successProbability = clamp(.5 + margin * .18)
    const riskScore = clamp(.55 - margin * .16)
    const confidence = clamp(.48 + Math.abs(margin) * .09, .45, .92)
    const result = { expectedTricks, certainTricks: Math.floor(certain), confidence, riskScore, successProbability }
    this.#contractCache.set(cacheKey, result)
    return result
  }

  evaluateMizer(hand: readonly Card[]): MizerEvaluation {
    const cacheKey = hand.map(card => card.id).sort().join(',')
    const cached = this.#mizerCache.get(cacheKey)
    if (cached) return cached
    const bySuit = Object.fromEntries(SUITS.map(suit => [suit, hand.filter(card => card.suit === suit).sort((a, b) => a.numericStrength - b.numericStrength)])) as Record<Suit, Card[]>
    let danger = 0
    for (const suit of SUITS) {
      const cards = bySuit[suit]
      for (const card of cards) {
        const height = Math.max(0, card.numericStrength - Rank.NINE)
        const cover = cards.filter(other => other.numericStrength < card.numericStrength).length
        danger += Math.max(0, height * .38 - cover * .32)
      }
      if (cards.length === 1 && cards[0]!.numericStrength >= Rank.QUEEN) danger += 1.35
      if (cards.length >= 4 && cards.at(-1)!.numericStrength <= Rank.JACK) danger -= .4
    }
    const expectedTricks = Math.max(0, danger * .36)
    const successProbability = clamp(.88 - expectedTricks * .24)
    const result = { expectedTricks, successProbability, riskScore: clamp(expectedTricks / 3), dangerousCards: hand.filter(card => card.numericStrength >= Rank.QUEEN).length }
    this.#mizerCache.set(cacheKey, result)
    return result
  }

  bestNormalContract(hand: readonly Card[]): { bid: Bid; evaluation: ContractEvaluation } {
    let best: { bid: Bid; evaluation: ContractEvaluation; utility: number } | undefined
    for (const level of [6, 7, 8, 9, 10] as const) for (const trump of [...SUITS, 'NT'] as const) {
      const evaluation = this.evaluateContract(hand, level, trump)
      const utility = evaluation.successProbability * ({ 6: 2, 7: 4, 8: 6, 9: 8, 10: 10 }[level]) - evaluation.riskScore * level
      if (!best || utility > best.utility) best = { bid: { kind: ContractKind.NORMAL, level, trump }, evaluation, utility }
    }
    return best!
  }
}
