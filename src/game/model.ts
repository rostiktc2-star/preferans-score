export enum Suit {
  SPADES = 'SPADES',
  CLUBS = 'CLUBS',
  DIAMONDS = 'DIAMONDS',
  HEARTS = 'HEARTS',
}

export enum Rank {
  SEVEN = 7,
  EIGHT = 8,
  NINE = 9,
  TEN = 10,
  JACK = 11,
  QUEEN = 12,
  KING = 13,
  ACE = 14,
}

export interface Card {
  readonly id: string
  readonly suit: Suit
  readonly rank: Rank
  readonly numericStrength: number
}

export interface Player {
  readonly id: string
  readonly name: string
}

export type PlayerId = string

export enum ContractKind {
  NORMAL = 'NORMAL',
  MIZER = 'MIZER',
}

export type ContractLevel = 6 | 7 | 8 | 9 | 10
export type Trump = Suit | 'NT'

export interface NormalBid {
  readonly kind: ContractKind.NORMAL
  readonly level: ContractLevel
  readonly trump: Trump
}

export interface MizerBid {
  readonly kind: ContractKind.MIZER
}

export type Bid = NormalBid | MizerBid
export type AuctionAction = Bid | 'PASS'

export interface Contract {
  readonly kind: ContractKind
  readonly declarerId: PlayerId
  readonly level?: ContractLevel
  readonly trump: Trump
  readonly requiredTricks: number
  readonly value: number
}

export interface AuctionRecord {
  readonly sequence: number
  readonly playerId: PlayerId
  readonly action: AuctionAction
}

export enum DefenderDecision {
  PASS = 'PASS',
  VIST = 'VIST',
  POLVIST = 'POLVIST',
}

export enum DefenseMode {
  NONE = 'NONE',
  TWO_PASS = 'TWO_PASS',
  ONE_VIST_OPEN = 'ONE_VIST_OPEN',
  TWO_VISTS = 'TWO_VISTS',
  POLVIST = 'POLVIST',
}

export enum GamePhase {
  SETUP = 'SETUP',
  DEALING = 'DEALING',
  BIDDING = 'BIDDING',
  DEFENDER_DECISIONS = 'DEFENDER_DECISIONS',
  PLAYING_FIRST_TRICK = 'PLAYING_FIRST_TRICK',
  TALON_REVEAL = 'TALON_REVEAL',
  DECLARER_DISCARD = 'DECLARER_DISCARD',
  PLAYING = 'PLAYING',
  RASPASY_PLAYING = 'RASPASY_PLAYING',
  RASPASY_TALON_REVEAL = 'RASPASY_TALON_REVEAL',
  TRICK_COMPLETE = 'TRICK_COMPLETE',
  SCORING = 'SCORING',
  HAND_COMPLETE = 'HAND_COMPLETE',
  GAME_COMPLETE = 'GAME_COMPLETE',
}

export interface PlayedCard {
  readonly playerId: PlayerId
  readonly card: Card
}

export interface Trick {
  readonly number: number
  readonly leaderId: PlayerId
  readonly forcedLeadSuit?: Suit
  readonly cards: PlayedCard[]
  readonly winnerId?: PlayerId
}

export interface PlayerScore {
  pool: number
  penalty: number
}

export interface ScoreBoard {
  readonly scores: Record<PlayerId, PlayerScore>
  readonly credits: Record<PlayerId, Record<PlayerId, number>>
}

export interface GameConfig {
  readonly players: readonly [Player, Player, Player]
  readonly seed?: number | string
  readonly poolTarget?: number
  readonly firstPlayerId?: PlayerId
}

export interface HandResult {
  readonly kind: 'NORMAL' | 'MIZER' | 'RASPASY'
  readonly poolAwards: Readonly<Record<PlayerId, number>>
  readonly penalties: Readonly<Record<PlayerId, number>>
  readonly credits: Readonly<Record<PlayerId, Readonly<Record<PlayerId, number>>>>
  readonly tricks: Readonly<Record<PlayerId, number>>
  readonly raspasyValue?: 1 | 2 | 3
}

export interface AmericanAidTransfer {
  readonly donorId: PlayerId
  readonly recipientId: PlayerId
  readonly poolPoints: number
  readonly credits: number
}

export interface PoolAwardContext {
  readonly playersInOrder: readonly PlayerId[]
  readonly poolTarget: number
  readonly scores: Readonly<Record<PlayerId, Readonly<PlayerScore>>>
}

export interface PoolAwardOutcome {
  readonly poolChanges: Readonly<Record<PlayerId, number>>
  readonly penaltyChanges: Readonly<Record<PlayerId, number>>
  readonly creditChanges: ReadonlyArray<{ fromId: PlayerId; againstId: PlayerId; amount: number }>
  readonly aidTransfers: readonly AmericanAidTransfer[]
}

export interface PoolAwardPolicy {
  award(context: PoolAwardContext, playerId: PlayerId, points: number): PoolAwardOutcome
}

export type GameEventType =
  | 'GAME_STARTED' | 'HAND_STARTED' | 'CARDS_DEALT' | 'BID_MADE' | 'PLAYER_PASSED'
  | 'CONTRACT_WON' | 'RASPASY_STARTED' | 'DEFENDER_VIST' | 'DEFENDER_PASS'
  | 'POLVIST_DECLARED' | 'CARD_PLAYED' | 'TRICK_WON' | 'TALON_CARD_REVEALED'
  | 'TALON_REVEALED' | 'CARDS_DISCARDED' | 'HAND_COMPLETED' | 'SCORE_UPDATED'

export interface GameEvent {
  readonly sequence: number
  readonly type: GameEventType
  readonly handNumber: number
  readonly publicData: Readonly<Record<string, unknown>>
  readonly privateData?: Readonly<Partial<Record<PlayerId, Readonly<Record<string, unknown>>>>>
}

export interface VisibleEvent {
  readonly sequence: number
  readonly type: GameEventType
  readonly handNumber: number
  readonly data: Readonly<Record<string, unknown>>
}

export interface PlayerView {
  readonly viewerId: PlayerId
  readonly phase: GamePhase
  readonly handNumber: number
  readonly playersInOrder: readonly Player[]
  readonly firstPlayerId: PlayerId
  readonly currentPlayerId?: PlayerId
  readonly ownHand: readonly Card[]
  readonly publicHands: Readonly<Record<PlayerId, readonly Card[]>>
  readonly handSizes: Readonly<Record<PlayerId, number>>
  readonly auction: readonly AuctionRecord[]
  readonly contract?: Contract
  readonly defenderDecisions: Readonly<Record<PlayerId, DefenderDecision>>
  readonly defenseMode: DefenseMode
  readonly currentTrick?: Trick
  readonly completedTricks: readonly Trick[]
  readonly revealedTalon: readonly Card[]
  readonly ownDiscards: readonly Card[]
  readonly tricksWon: Readonly<Record<PlayerId, number>>
  readonly scoreboard: ScoreBoard
  readonly raspasyStreak: number
  readonly raspasyValue: 1 | 2 | 3
  readonly legalMoves: readonly Card[]
  readonly legalAuctionActions: readonly AuctionAction[]
  readonly legalDefenderDecisions: readonly DefenderDecision[]
  readonly events: readonly VisibleEvent[]
}
