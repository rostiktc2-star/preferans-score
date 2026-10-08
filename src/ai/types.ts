import type { AuctionAction, Card, DefenderDecision, PlayerId, PlayerView } from '../game/model'

export enum SkillLevel { EASY = 'EASY', NORMAL = 'NORMAL', HARD = 'HARD' }
export enum PlayStyle { CONSERVATIVE = 'CONSERVATIVE', BALANCED = 'BALANCED', AGGRESSIVE = 'AGGRESSIVE' }

export interface BotConfig {
  readonly skillLevel: SkillLevel
  readonly playStyle: PlayStyle
  readonly seed: number | string
  readonly mizerThreshold?: number
  readonly monteCarloSamples?: number
  readonly timeBudgetMs?: number
}

export interface BotDecisionContext {
  readonly botId: PlayerId
  readonly view: PlayerView
  readonly config: BotConfig
}

export interface DecisionExplanation {
  readonly confidence: number
  readonly reasons: readonly string[]
  readonly metrics: Readonly<Record<string, number>>
}

export type BotDecision =
  | ({ readonly type: 'BID'; readonly action: AuctionAction } & DecisionExplanation)
  | ({ readonly type: 'DEFENSE'; readonly decision: DefenderDecision } & DecisionExplanation)
  | ({ readonly type: 'DISCARD'; readonly cardIds: readonly [string, string] } & DecisionExplanation)
  | ({ readonly type: 'PLAY_CARD'; readonly card: Card } & DecisionExplanation)

export interface ContractEvaluation {
  readonly expectedTricks: number
  readonly certainTricks: number
  readonly confidence: number
  readonly riskScore: number
  readonly successProbability: number
}

export interface MizerEvaluation {
  readonly expectedTricks: number
  readonly successProbability: number
  readonly riskScore: number
  readonly dangerousCards: number
}

export interface PossibleWorld {
  readonly hands: Readonly<Record<PlayerId, readonly Card[]>>
  readonly unknownDiscards: readonly Card[]
}
