import { ContractKind, type Card } from '../game/model'
import { HandEvaluator } from './handEvaluator'
import type { BotDecisionContext, DecisionExplanation } from './types'

export class DiscardEvaluator {
  constructor(private readonly hands = new HandEvaluator()) {}

  choose(context: BotDecisionContext): { cardIds: readonly [string, string] } & DecisionExplanation {
    const contract = context.view.contract
    if (!contract || context.view.ownHand.length < 2) throw new Error('Scarto non disponibile')
    let best: { pair: [Card, Card]; utility: number; metric: number } | undefined
    const hand = context.view.ownHand
    for (let first = 0; first < hand.length - 1; first += 1) for (let second = first + 1; second < hand.length; second += 1) {
      const pair: [Card, Card] = [hand[first]!, hand[second]!]
      const ids = new Set(pair.map(card => card.id)); const remaining = hand.filter(card => !ids.has(card.id))
      if (contract.kind === ContractKind.MIZER) {
        const evaluation = this.hands.evaluateMizer(remaining)
        const utility = evaluation.successProbability * 10 - evaluation.riskScore * 4
        if (!best || utility > best.utility) best = { pair, utility, metric: evaluation.expectedTricks }
      } else {
        const evaluation = this.hands.evaluateContract(remaining, contract.level!, contract.trump)
        let utility = evaluation.expectedTricks + evaluation.successProbability * 2 - evaluation.riskScore
        if (contract.trump !== 'NT') utility += remaining.filter(card => card.suit === contract.trump).length * .08
        if (!best || utility > best.utility) best = { pair, utility, metric: evaluation.expectedTricks }
      }
    }
    return { cardIds: [best!.pair[0].id, best!.pair[1].id], confidence: .82, reasons: contract.kind === ContractKind.MIZER ? ['discard_reduces_mizer_risk', 'evaluated_all_discard_pairs'] : ['discard_maximizes_contract_control', 'evaluated_all_discard_pairs'], metrics: { utility: best!.utility, expectedTricksAfterDiscard: best!.metric, combinations: hand.length * (hand.length - 1) / 2 } }
  }
}
