import { ContractKind, DefenderDecision, type AuctionAction } from '../../game/model'
import type { BotDecisionContext, DecisionExplanation } from '../types'
import type { LLMProposal, ValidatedLLMDecision } from './types'

const explanation = (proposal: LLMProposal): DecisionExplanation => ({
  confidence: Math.max(0, Math.min(1, proposal.confidence)),
  reasons: proposal.reasonCodes.slice(0, 8), metrics: {},
})
const bidKey = (action: AuctionAction): string => action === 'PASS' ? 'PASS' : action.kind === ContractKind.MIZER ? 'MIZER' : `${action.level}:${action.trump}`

function parseProposal(value: unknown): LLMProposal | undefined {
  if (!value || typeof value !== 'object') return undefined
  const item = value as Record<string, unknown>
  if (!['BID', 'PASS', 'VIST', 'POLVIST', 'DISCARD', 'PLAY_CARD'].includes(String(item.action))) return undefined
  if (typeof item.confidence !== 'number' || !Number.isFinite(item.confidence) || !Array.isArray(item.reasonCodes) || item.reasonCodes.some(code => typeof code !== 'string')) return undefined
  return item as unknown as LLMProposal
}

export function validateLLMProposal(value: unknown, context: BotDecisionContext): ValidatedLLMDecision | undefined {
  const proposal = parseProposal(value)
  if (!proposal) return undefined
  const notes = explanation(proposal)
  if (proposal.action === 'PLAY_CARD' && typeof proposal.cardId === 'string') {
    const card = context.view.legalMoves.find(item => item.id === proposal.cardId)
    return card ? { raw: proposal, decision: { type: 'PLAY_CARD', card, ...notes } } : undefined
  }
  if (proposal.action === 'DISCARD' && Array.isArray(proposal.cardIds) && proposal.cardIds.length === 2 && new Set(proposal.cardIds).size === 2 && proposal.cardIds.every(id => typeof id === 'string' && context.view.ownHand.some(card => card.id === id))) {
    return { raw: proposal, decision: { type: 'DISCARD', cardIds: [proposal.cardIds[0]!, proposal.cardIds[1]!], ...notes } }
  }
  if (proposal.action === 'PASS') {
    if (context.view.legalAuctionActions.includes('PASS')) return { raw: proposal, decision: { type: 'BID', action: 'PASS', ...notes } }
    if (context.view.legalDefenderDecisions.includes(DefenderDecision.PASS)) return { raw: proposal, decision: { type: 'DEFENSE', decision: DefenderDecision.PASS, ...notes } }
  }
  if (proposal.action === 'BID' && proposal.bid) {
    const wanted = proposal.bid.kind === 'MIZER' ? 'MIZER' : `${proposal.bid.level}:${proposal.bid.trump}`
    const action = context.view.legalAuctionActions.find(item => bidKey(item) === wanted)
    return action ? { raw: proposal, decision: { type: 'BID', action, ...notes } } : undefined
  }
  if (proposal.action === 'VIST' || proposal.action === 'POLVIST') {
    const decision = proposal.action === 'VIST' ? DefenderDecision.VIST : DefenderDecision.POLVIST
    return context.view.legalDefenderDecisions.includes(decision) ? { raw: proposal, decision: { type: 'DEFENSE', decision, ...notes } } : undefined
  }
  return undefined
}
