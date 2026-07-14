export type PlayerId = string
export type Suit = 'picche' | 'fiori' | 'quadri' | 'cuori' | 'senza briscola'
export type DefenderChoice = 'pass' | 'vist' | 'polvist'
export type HandType = 'normal' | 'mizer' | 'raspasy' | 'manual'

export interface Player { id: PlayerId; name: string }
export interface GameConfig {
  schemaVersion: 1
  createdAt: string
  players: Player[]
  poolTarget: number
  euroCentsPerCredit: number
  firstRestPlayerId?: PlayerId
  animations: boolean
}

interface BaseEvent { id: string; createdAt: string; restPlayerId?: PlayerId; note?: string }
export interface NormalHandEvent extends BaseEvent {
  type: 'normal'
  declarerId: PlayerId
  level: 6 | 7 | 8 | 9 | 10
  suit: Suit
  defenderChoices: Record<PlayerId, DefenderChoice>
  tricks?: Record<PlayerId, number>
}
export interface MizerHandEvent extends BaseEvent {
  type: 'mizer'
  declarerId: PlayerId
  declarerTricks: number
  tricks?: Record<PlayerId, number>
}
export interface RaspasyHandEvent extends BaseEvent {
  type: 'raspasy'
  tricks: Record<PlayerId, number>
}
export type ManualAdjustment =
  | { kind: 'pool'; playerId: PlayerId; amount: number }
  | { kind: 'penalty'; playerId: PlayerId; amount: number }
  | { kind: 'credit'; fromId: PlayerId; againstId: PlayerId; amount: number }
export interface ManualEvent extends BaseEvent {
  type: 'manual'
  adjustments: ManualAdjustment[]
  raspasyLevel?: 1 | 2 | 3
}
export type GameEvent = NormalHandEvent | MizerHandEvent | RaspasyHandEvent | ManualEvent

export interface Fraction { n: number; d: number }
export interface PlayerScore { pool: number; penalty: number }
export interface AmericanAid { donorId: PlayerId; recipientId: PlayerId; poolPoints: number; credits: number }
export interface CreditChange { fromId: PlayerId; againstId: PlayerId; amount: Fraction; reason: string }
export interface AppliedEvent {
  event: GameEvent
  handNumber: number
  activeIds: PlayerId[]
  restPlayerId?: PlayerId
  defenderOrder?: [PlayerId, PlayerId]
  raspasyBefore: 1 | 2 | 3
  raspasyAfter: 1 | 2 | 3
  poolChanges: Record<PlayerId, number>
  penaltyChanges: Record<PlayerId, number>
  creditChanges: CreditChange[]
  aids: AmericanAid[]
  summary: string
  nextRestPlayerId?: PlayerId
}
export interface GameState {
  config: GameConfig
  scores: Record<PlayerId, PlayerScore>
  credits: Record<PlayerId, Record<PlayerId, Fraction>>
  raspasyLevel: 1 | 2 | 3
  nextRestPlayerId?: PlayerId
  applied: AppliedEvent[]
  completed: boolean
}
export interface SavedGame {
  schemaVersion: 1
  config: GameConfig
  events: GameEvent[]
  undone: GameEvent[]
  updatedAt: string
}

export interface FinalPlayerResult {
  playerId: PlayerId
  residualPenalty: number
  grossOwned: Fraction
  grossSuffered: Fraction
  netCredits: Fraction
  euroCents: number
}
export interface Payment { fromId: PlayerId; toId: PlayerId; cents: number }
export interface FinalResult {
  minimumPenalty: number
  penaltyCredits: CreditChange[]
  players: FinalPlayerResult[]
  payments: Payment[]
}
