import { ContractKind, type AuctionAction } from '../game/model'
import { HandEvaluator } from './handEvaluator'
import { PlayStyle, SkillLevel, type BotDecisionContext, type DecisionExplanation } from './types'

const VALUE = { 6: 2, 7: 4, 8: 6, 9: 8, 10: 10 } as const

export class BidEvaluator {
  constructor(private readonly hands = new HandEvaluator()) {}

  choose(context: BotDecisionContext): { action: AuctionAction } & DecisionExplanation {
    const legal = context.view.legalAuctionActions
    if (!legal.length) throw new Error('Nessuna dichiarazione legale')
    const styleBias = context.config.playStyle === PlayStyle.AGGRESSIVE ? .7 : context.config.playStyle === PlayStyle.CONSERVATIVE ? -.65 : 0
    const skillMargin = context.config.skillLevel === SkillLevel.EASY ? .45 : context.config.skillLevel === SkillLevel.HARD ? -.1 : .12
    let best: { action: AuctionAction; utility: number; confidence: number; expected: number } = { action: 'PASS', utility: 0, confidence: .75, expected: 0 }
    for (const action of legal) {
      if (action === 'PASS') continue
      if (action.kind === ContractKind.MIZER) {
        const evaluation = this.hands.evaluateMizer(context.view.ownHand)
        const threshold = context.config.mizerThreshold ?? (context.config.playStyle === PlayStyle.AGGRESSIVE ? .7 : context.config.playStyle === PlayStyle.CONSERVATIVE ? .86 : .78)
        const utility = (evaluation.successProbability - threshold) * 13 + styleBias
        if (utility > best.utility) best = { action, utility, confidence: evaluation.successProbability, expected: 10 - evaluation.expectedTricks }
      } else {
        const evaluation = this.hands.evaluateContract(context.view.ownHand, action.level, action.trump)
        const failureCost = Math.max(1, action.level - evaluation.expectedTricks) * VALUE[action.level]
        let utility = evaluation.successProbability * VALUE[action.level] - (1 - evaluation.successProbability) * failureCost - evaluation.riskScore * 1.4 + styleBias - skillMargin
        if (context.config.skillLevel === SkillLevel.EASY && action.level > 7) utility -= .8
        if (utility > best.utility) best = { action, utility, confidence: evaluation.confidence, expected: evaluation.expectedTricks }
      }
    }
    return { action: best.action, confidence: best.confidence, reasons: best.action === 'PASS' ? ['hand_below_bid_threshold', 'risk_exceeds_expected_value'] : best.action.kind === ContractKind.MIZER ? ['mizer_shape_favorable', 'success_probability_above_threshold'] : ['positive_contract_utility', 'expected_tricks_support_bid'], metrics: { utility: best.utility, expectedTricks: best.expected } }
  }
}
