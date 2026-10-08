import { ContractKind, type Card, type PlayedCard, type Trump } from '../game/model'
import { MonteCarloSimulator } from './monteCarlo'
import type { BotMemory } from './memory'
import { BotRandom } from './random'
import { SkillLevel, type BotDecisionContext, type DecisionExplanation } from './types'

function currentWinner(cards: readonly PlayedCard[], trump: Trump): PlayedCard | undefined {
  if (!cards.length) return undefined
  const lead = cards[0]!.card.suit
  const eligible = trump !== 'NT' && cards.some(play => play.card.suit === trump) ? trump : lead
  return cards.filter(play => play.card.suit === eligible).reduce((best, play) => play.card.numericStrength > best.card.numericStrength ? play : best)
}
function cardWouldWin(card: Card, cards: readonly PlayedCard[], trump: Trump): boolean {
  if (!cards.length) return true
  const winner = currentWinner(cards, trump)!
  if (trump !== 'NT' && card.suit === trump && winner.card.suit !== trump) return true
  return card.suit === winner.card.suit && card.numericStrength > winner.card.numericStrength
}

export class CardPlayEvaluator {
  constructor(private readonly monteCarlo = new MonteCarloSimulator()) {}

  choose(context: BotDecisionContext, memory: BotMemory, random: BotRandom): { card: Card } & DecisionExplanation {
    const legal = context.view.legalMoves
    if (!legal.length) throw new Error('Nessuna carta legale')
    if (legal.length === 1) return { card: legal[0]!, confidence: 1, reasons: ['only_legal_move'], metrics: { legalMoves: 1 } }
    const trick = context.view.currentTrick
    const contract = context.view.contract
    const declarer = contract?.declarerId === context.botId
    const avoiding = !contract || (contract.kind === ContractKind.MIZER && declarer)
    const partnerId = contract && !declarer ? context.view.playersInOrder.find(player => player.id !== context.botId && player.id !== contract.declarerId)?.id : undefined
    const winner = currentWinner(trick?.cards ?? [], contract?.trump ?? 'NT')
    const partnerWinning = winner?.playerId === partnerId
    const samples = context.config.skillLevel === SkillLevel.HARD ? context.config.monteCarloSamples ?? 90 : context.config.skillLevel === SkillLevel.NORMAL ? Math.min(24, context.config.monteCarloSamples ?? 20) : 0
    const scored = legal.map(card => {
      const wins = cardWouldWin(card, trick?.cards ?? [], contract?.trump ?? 'NT')
      let score = 0; const reasons: string[] = []
      if (avoiding) {
        score += wins ? -5 : 4
        score += card.numericStrength * (wins ? -.05 : .12)
        reasons.push(wins ? 'avoid_winning_trick' : 'safe_loser_selected')
      } else if (declarer) {
        const needed = contract.requiredTricks - (context.view.tricksWon[context.botId] ?? 0)
        if (trick?.cards.length) score += wins ? 5 : -1
        else {
          const suitLength = context.view.ownHand.filter(other => other.suit === card.suit).length
          score += card.numericStrength >= 13 ? 2.4 : .2
          score += suitLength >= 4 ? .8 : 0
          if (contract.trump !== 'NT' && card.suit === contract.trump && needed > 1) score += .65
        }
        score -= card.numericStrength * (wins ? .015 : .08)
        reasons.push(wins ? 'pursue_contract_trick' : 'preserve_control_card')
      } else {
        if (partnerWinning) { score -= wins ? 3 : 0; score -= card.numericStrength * .08; reasons.push('partner_currently_winning') }
        else { score += wins ? 4 : 0; score -= card.numericStrength * (wins ? .025 : .07); reasons.push(wins ? 'secure_defensive_trick' : 'conserve_high_card') }
        if (contract.kind === ContractKind.MIZER && winner?.playerId === contract.declarerId) score += wins ? -4 : 3
      }
      if (samples) score += (this.monteCarlo.estimateCardSafety(context, memory, card, samples, random) - .5) * 1.8
      return { card, score, reasons }
    }).sort((a, b) => b.score - a.score || a.card.numericStrength - b.card.numericStrength)
    if (context.config.skillLevel === SkillLevel.EASY && scored.length > 1 && random.next() < .24) [scored[0], scored[1]] = [scored[1]!, scored[0]!]
    const best = scored[0]!
    return { card: best.card, confidence: Math.min(.94, .6 + Math.max(0, best.score - (scored[1]?.score ?? best.score)) * .06), reasons: [...best.reasons, samples ? 'sampled_compatible_hidden_worlds' : 'heuristic_evaluation'], metrics: { utility: best.score, legalMoves: legal.length, monteCarloSamples: samples } }
  }
}
