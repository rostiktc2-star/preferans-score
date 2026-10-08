import { SkillLevel, type BotDecision } from '../types'
import type { AdvancedDecisionInput } from './types'

export function shouldConsultLLM(input: AdvancedDecisionInput): boolean {
  const { context, algorithmDecision } = input
  if (context.config.skillLevel === SkillLevel.EASY) return false
  if (algorithmDecision.confidence > .93) return false
  if (algorithmDecision.type === 'PLAY_CARD') {
    if (context.view.legalMoves.length <= 1) return false
    const cardsRemaining = context.view.ownHand.length
    return cardsRemaining <= 4 || algorithmDecision.confidence < .82
  }
  return algorithmDecision.type === 'BID' || algorithmDecision.type === 'DEFENSE' || algorithmDecision.type === 'DISCARD'
}

export const decisionKey = (decision: BotDecision): string => decision.type === 'BID'
  ? `BID:${decision.action === 'PASS' ? 'PASS' : JSON.stringify(decision.action)}`
  : decision.type === 'DEFENSE' ? `DEFENSE:${decision.decision}`
    : decision.type === 'DISCARD' ? `DISCARD:${[...decision.cardIds].sort().join(',')}`
      : `PLAY_CARD:${decision.card.id}`
