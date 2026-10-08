import { ContractKind, type AuctionAction, type Card, type PlayerView, type Trick } from '../../game/model'
import type { BotMemory } from '../memory'
import type { BotDecisionContext } from '../types'
import { AdvancedAiMode, type LLMCard, type LLMDecisionContext, type LLMTrick } from './types'

const card = (value: Card): LLMCard => ({ id: value.id, suit: value.suit, rank: value.rank })
const trick = (value: Trick): LLMTrick => ({
  number: value.number,
  leaderId: value.leaderId,
  ...(value.forcedLeadSuit ? { forcedLeadSuit: value.forcedLeadSuit } : {}),
  cards: value.cards.map(play => ({ playerId: play.playerId, card: card(play.card) })),
  ...(value.winnerId ? { winnerId: value.winnerId } : {}),
})
const bid = (action: AuctionAction): string => action === 'PASS' ? 'PASS' : action.kind === ContractKind.MIZER ? 'MIZER' : `${action.level}:${action.trump}`

export function buildLLMContext(context: BotDecisionContext, memory: BotMemory, mode = AdvancedAiMode.BALANCED): LLMDecisionContext {
  const view: PlayerView = context.view
  if (view.viewerId !== context.botId) throw new Error('PlayerView non appartenente al bot')
  const role = !view.contract ? 'RASPASY' : view.contract.declarerId === context.botId ? 'DECLARER' : 'DEFENDER'
  return Object.freeze({
    game: 'Preferans Sochi', playerId: context.botId, phase: view.phase, role, mode,
    hand: view.ownHand.map(card),
    ...(view.contract ? { contract: { ...view.contract } } : {}),
    auction: view.auction.map(item => ({ playerId: item.playerId, action: bid(item.action) })),
    defenderDecisions: { ...view.defenderDecisions },
    ...(view.currentTrick ? { currentTrick: trick(view.currentTrick) } : {}),
    completedTricks: view.completedTricks.map(trick),
    revealedTalon: view.revealedTalon.map(card),
    publicHands: Object.fromEntries(Object.entries(view.publicHands).map(([id, cards]) => [id, cards.map(card)])),
    handSizes: { ...view.handSizes }, tricksWon: { ...view.tricksWon },
    voidSuits: Object.fromEntries(view.playersInOrder.map(player => [player.id, [...(memory.inference[player.id]?.voidSuits ?? [])]])),
    possibleTrumpCount: Object.fromEntries(view.playersInOrder.map(player => [player.id, { ...(memory.inference[player.id]?.possibleTrumpCount ?? { min: 0, max: view.handSizes[player.id] ?? 0 }) }])),
    legal: {
      cards: view.legalMoves.map(card => card.id),
      bids: view.legalAuctionActions.map(bid),
      defenderActions: [...view.legalDefenderDecisions],
      discardableCards: view.phase === 'DECLARER_DISCARD' ? view.ownHand.map(card => card.id) : [],
    },
  })
}

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
  return JSON.stringify(value)
}

export function contextHash(context: LLMDecisionContext): string {
  let hash = 2166136261
  const text = stable(context)
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619) }
  return `ctx-${(hash >>> 0).toString(16).padStart(8, '0')}`
}
