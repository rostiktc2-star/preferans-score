import { ContractKind, DefenderDecision } from '../game/model'
import { HandEvaluator } from './handEvaluator'
import { PlayStyle, type BotDecisionContext, type DecisionExplanation } from './types'

export class DefenseEvaluator {
  constructor(private readonly hands = new HandEvaluator()) {}

  choose(context: BotDecisionContext): { decision: DefenderDecision } & DecisionExplanation {
    const contract = context.view.contract
    const legal = context.view.legalDefenderDecisions
    if (!contract || contract.kind !== ContractKind.NORMAL || contract.level === undefined || !legal.length) throw new Error('Decisione difensiva non disponibile')
    const evaluation = this.hands.evaluateContract(context.view.ownHand, 6, contract.trump)
    const expected = Math.min(5, evaluation.expectedTricks * .7 + context.view.ownHand.filter(card => card.numericStrength >= 13).length * .25)
    const value = contract.value
    const style = context.config.playStyle === PlayStyle.AGGRESSIVE ? .7 : context.config.playStyle === PlayStyle.CONSERVATIVE ? -.6 : 0
    const firstDecisionMade = Object.keys(context.view.defenderDecisions).length > 0
    const quota = legal.includes(DefenderDecision.POLVIST) ? (contract.level === 6 ? 2 : 1) : contract.level === 6 ? (firstDecisionMade ? 2 : 2) : contract.level === 7 ? 1 : firstDecisionMade ? 1 : 0
    const vistUtility = expected * value - Math.max(0, quota - expected) * value * 1.35 + style
    const polvistQuota = contract.level === 6 ? 2 : 1
    const polvistUtility = Math.min(expected, polvistQuota) * value - Math.max(0, polvistQuota - expected) * value + style * .25
    let decision = DefenderDecision.PASS, utility = 0
    if (legal.includes(DefenderDecision.VIST) && vistUtility > utility) { decision = DefenderDecision.VIST; utility = vistUtility }
    if (legal.includes(DefenderDecision.POLVIST) && polvistUtility > utility) { decision = DefenderDecision.POLVIST; utility = polvistUtility }
    return { decision, confidence: Math.min(.93, .56 + Math.abs(utility) * .06), reasons: decision === DefenderDecision.PASS ? ['defensive_quota_unlikely', 'avoid_penalty_risk'] : decision === DefenderDecision.POLVIST ? ['limited_risk_best_value', 'polvist_quota_reachable'] : ['defensive_tricks_expected', 'credit_value_exceeds_penalty_risk'], metrics: { expectedDefensiveTricks: expected, expectedValue: utility, quota } }
  }
}
