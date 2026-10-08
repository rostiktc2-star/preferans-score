import type { AuctionAction, Card, DefenderDecision, GamePhase, PlayerId, Suit } from '../../game/model'
import type { BotDecision, BotDecisionContext } from '../types'

export enum AdvancedAiMode { CONSERVATIVE = 'CONSERVATIVE', BALANCED = 'BALANCED', CREATIVE = 'CREATIVE' }
export enum ArbitrationStrategy { LLM_OVERRIDE = 'LLM_OVERRIDE', ALGORITHM_OVERRIDE = 'ALGORITHM_OVERRIDE', CONFIDENCE_BASED = 'CONFIDENCE_BASED', HYBRID = 'HYBRID' }

export interface AdvancedAiConfig {
  readonly enabled: boolean
  readonly mode: AdvancedAiMode
  readonly strategy?: ArbitrationStrategy
  readonly endpoint?: string
  readonly timeoutMs?: number
  readonly maxCallsPerHand?: number
  readonly maxCallsPerGame?: number
  readonly budgetLimitUsd?: number
}

export interface LLMCard { readonly id: string; readonly suit: Suit; readonly rank: number }
export interface LLMTrick { readonly number: number; readonly leaderId: PlayerId; readonly forcedLeadSuit?: Suit; readonly cards: readonly { readonly playerId: PlayerId; readonly card: LLMCard }[]; readonly winnerId?: PlayerId }

export interface LLMDecisionContext {
  readonly game: 'Preferans Sochi'
  readonly playerId: PlayerId
  readonly phase: GamePhase
  readonly role: 'DECLARER' | 'DEFENDER' | 'RASPASY'
  readonly mode: AdvancedAiMode
  readonly hand: readonly LLMCard[]
  readonly contract?: Readonly<{ kind: string; declarerId: PlayerId; level?: number; trump: string; requiredTricks: number; value: number }>
  readonly auction: readonly Readonly<{ playerId: PlayerId; action: string }>[]
  readonly defenderDecisions: Readonly<Record<PlayerId, DefenderDecision>>
  readonly currentTrick?: LLMTrick
  readonly completedTricks: readonly LLMTrick[]
  readonly revealedTalon: readonly LLMCard[]
  readonly publicHands: Readonly<Record<PlayerId, readonly LLMCard[]>>
  readonly handSizes: Readonly<Record<PlayerId, number>>
  readonly tricksWon: Readonly<Record<PlayerId, number>>
  readonly voidSuits: Readonly<Record<PlayerId, readonly Suit[]>>
  readonly possibleTrumpCount: Readonly<Record<PlayerId, Readonly<{ min: number; max: number }>>>
  readonly legal: Readonly<{
    cards: readonly string[]
    bids: readonly string[]
    defenderActions: readonly DefenderDecision[]
    discardableCards: readonly string[]
  }>
}

export interface LLMProposal {
  readonly action: 'BID' | 'PASS' | 'VIST' | 'POLVIST' | 'DISCARD' | 'PLAY_CARD'
  readonly cardId?: string | null
  readonly cardIds?: readonly string[]
  readonly bid?: Readonly<{ kind: 'NORMAL' | 'MIZER'; level?: number | null; trump?: string | null }> | null
  readonly confidence: number
  readonly reasonCodes: readonly string[]
}

export interface AdvisorUsage { readonly inputTokens: number; readonly outputTokens: number; readonly estimatedCostUsd: number }
export interface AdvisorTransportResponse { readonly proposal?: unknown; readonly unavailable?: boolean; readonly usage?: Partial<AdvisorUsage>; readonly model?: string; readonly requestId?: string }
export interface AdvisorTransport { request(context: LLMDecisionContext, signal: AbortSignal): Promise<AdvisorTransportResponse> }

export interface AdvisorStats extends AdvisorUsage {
  readonly requests: number
  readonly cacheHits: number
  readonly fallbacks: number
  readonly accepted: number
  readonly divergences: number
  readonly totalLatencyMs: number
}

export interface AdvisorDecisionResult {
  readonly decision: BotDecision
  readonly source: 'ALGORITHM' | 'LLM' | 'AGREEMENT'
  readonly consulted: boolean
  readonly validationStatus: 'NOT_CONSULTED' | 'VALID' | 'INVALID' | 'TIMEOUT' | 'UNAVAILABLE' | 'BUDGET_BLOCKED' | 'CACHED'
  readonly contextHash?: string
}

export interface DecisionLogEntry {
  readonly decisionType: BotDecision['type']
  readonly contextHash?: string
  readonly algorithmChoice: string
  readonly llmChoice?: string
  readonly finalChoice: string
  readonly latencyMs: number
  readonly usage: AdvisorUsage
  readonly validationStatus: AdvisorDecisionResult['validationStatus']
}

export interface ValidatedLLMDecision { readonly decision: BotDecision; readonly raw: LLMProposal }
export interface AdvancedDecisionInput { readonly context: BotDecisionContext; readonly algorithmDecision: BotDecision }

export type LegalActionSnapshot = Readonly<{ cards: readonly Card[]; bids: readonly AuctionAction[]; defenderActions: readonly DefenderDecision[] }>
