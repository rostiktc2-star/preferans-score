import { Deck } from './deck'
import { EventLog } from './eventLog'
import { Hand } from './hand'
import {
  ContractKind,
  DefenderDecision,
  DefenseMode,
  GamePhase,
  type AuctionAction,
  type AuctionRecord,
  type Bid,
  type Card,
  type Contract,
  type GameConfig,
  type HandResult,
  type PlayerId,
  type PlayerView,
  type PoolAwardPolicy,
  type ScoreBoard,
  type Trick,
} from './model'
import { CryptoRandomProvider, SeededRandomProvider, type RandomProvider } from './random'
import { RuleEngine, RuleViolation } from './rules'
import { AmericanAidPoolPolicy, ScoringEngine } from './scoring'

const clone = <T>(value: T): T => structuredClone(value)

export class GameEngine {
  readonly #config: Required<Pick<GameConfig, 'poolTarget'>> & GameConfig
  readonly #players: readonly PlayerId[]
  readonly #random: RandomProvider
  readonly #poolPolicy: PoolAwardPolicy
  readonly #events = new EventLog()
  readonly #scoreboard: ScoreBoard

  #phase = GamePhase.SETUP
  #handNumber = 0
  #firstPlayerId: PlayerId
  #currentPlayerId?: PlayerId
  #hands: Record<PlayerId, Hand> = {}
  #talon: Card[] = []
  #revealedTalon: Card[] = []
  #discards: Card[] = []
  #discardOwnerId?: PlayerId
  #auction: AuctionRecord[] = []
  #passed = new Set<PlayerId>()
  #highestBid?: Bid
  #highestBidderId?: PlayerId
  #contract?: Contract
  #defenderOrder?: readonly [PlayerId, PlayerId]
  #defenderDecisions: Record<PlayerId, DefenderDecision> = {}
  #defenseMode = DefenseMode.NONE
  #currentTrick?: Trick
  #completedTricks: Trick[] = []
  #tricksWon: Record<PlayerId, number>
  #phaseBeforeTrickComplete?: GamePhase
  #raspasyStreak = 0
  #currentRaspasyValue: 1 | 2 | 3 = 1
  #lastResult?: HandResult

  constructor(config: GameConfig, dependencies: { random?: RandomProvider; poolPolicy?: PoolAwardPolicy } = {}) {
    const players = config.players.map(player => player.id)
    if (new Set(players).size !== 3 || config.players.some(player => !player.id || !player.name.trim())) {
      throw new Error('La partita richiede esattamente tre giocatori distinti')
    }
    const poolTarget = config.poolTarget ?? 10
    if (!Number.isInteger(poolTarget) || poolTarget <= 0) throw new Error('Il limite Pozzo deve essere un intero positivo')
    this.#config = { ...config, poolTarget }
    this.#players = players
    this.#random = dependencies.random ?? (config.seed === undefined ? new CryptoRandomProvider() : new SeededRandomProvider(config.seed))
    this.#poolPolicy = dependencies.poolPolicy ?? new AmericanAidPoolPolicy()
    if (config.firstPlayerId && !players.includes(config.firstPlayerId)) throw new Error('Primo giocatore non valido')
    this.#firstPlayerId = config.firstPlayerId ?? players[this.#random.integer(3)]!
    this.#tricksWon = this.#zeroes()
    this.#scoreboard = {
      scores: Object.fromEntries(players.map(id => [id, { pool: 0, penalty: 0 }])),
      credits: Object.fromEntries(players.map(from => [from, Object.fromEntries(players.filter(to => to !== from).map(to => [to, 0]))])),
    }
  }

  get phase(): GamePhase { return this.#phase }
  get handNumber(): number { return this.#handNumber }
  get firstPlayerId(): PlayerId { return this.#firstPlayerId }

  startGame(): void {
    this.#requirePhase(GamePhase.SETUP)
    this.#events.append('GAME_STARTED', 0, { players: clone(this.#config.players), firstPlayerId: this.#firstPlayerId })
    this.#startHand()
  }

  makeBid(playerId: PlayerId, action: AuctionAction): void {
    this.#requirePhase(GamePhase.BIDDING)
    RuleEngine.validateAuctionAction({
      playerId,
      action,
      currentPlayerId: this.#currentPlayerId!,
      history: this.#auction,
      passedPlayers: this.#passed,
      highestBid: this.#highestBid,
    })
    const record = Object.freeze({ sequence: this.#auction.length + 1, playerId, action: clone(action) })
    this.#auction.push(record)
    if (action === 'PASS') {
      this.#passed.add(playerId)
      this.#events.append('PLAYER_PASSED', this.#handNumber, { playerId })
    } else {
      this.#highestBid = action
      this.#highestBidderId = playerId
      this.#events.append('BID_MADE', this.#handNumber, { playerId, bid: clone(action) })
    }
    const remaining = this.#players.filter(id => !this.#passed.has(id))
    if (!this.#highestBid && remaining.length === 0) {
      this.#startRaspasy()
      return
    }
    if (this.#highestBid && remaining.length === 1) {
      this.#winContract(this.#highestBidderId!, this.#highestBid)
      return
    }
    this.#currentPlayerId = this.#nextMatching(playerId, id => !this.#passed.has(id))
  }

  makeDefenderDecision(playerId: PlayerId, decision: DefenderDecision): void {
    this.#requirePhase(GamePhase.DEFENDER_DECISIONS)
    const index = Object.keys(this.#defenderDecisions).length
    const expected = this.#defenderOrder?.[index]
    if (!expected || playerId !== expected) throw new RuleViolation('I difensori devono dichiarare in ordine')
    RuleEngine.validateDefenderDecision({
      decision,
      defenderIndex: index,
      contract: this.#contract!,
      decisions: this.#defenderDecisions,
      defenderOrder: this.#defenderOrder!,
    })
    this.#defenderDecisions[playerId] = decision
    const eventType = decision === DefenderDecision.PASS ? 'DEFENDER_PASS' : decision === DefenderDecision.VIST ? 'DEFENDER_VIST' : 'POLVIST_DECLARED'
    this.#events.append(eventType, this.#handNumber, { playerId })
    if (index === 0) {
      this.#currentPlayerId = this.#defenderOrder![1]
      return
    }
    this.#finishDefenderDecisions()
  }

  getLegalMoves(playerId: PlayerId): readonly Card[] {
    if (![GamePhase.PLAYING_FIRST_TRICK, GamePhase.PLAYING, GamePhase.RASPASY_PLAYING].includes(this.#phase)) return []
    if (playerId !== this.#currentPlayerId || !this.#currentTrick) return []
    return clone(RuleEngine.getLegalMoves(this.#hands[playerId]!.cards(), this.#currentTrick, this.#contract?.trump ?? 'NT'))
  }

  playCard(playerId: PlayerId, cardId: string): void {
    if (![GamePhase.PLAYING_FIRST_TRICK, GamePhase.PLAYING, GamePhase.RASPASY_PLAYING].includes(this.#phase)) {
      throw new RuleViolation('Non è possibile giocare una carta in questo stato')
    }
    if (playerId !== this.#currentPlayerId) throw new RuleViolation('Non è il turno di questo giocatore')
    const trick = this.#currentTrick!
    const card = RuleEngine.validateCardPlay(this.#hands[playerId]!.cards(), trick, this.#contract?.trump ?? 'NT', cardId)
    this.#hands[playerId]!.remove(cardId)
    trick.cards.push({ playerId, card })
    this.#events.append('CARD_PLAYED', this.#handNumber, { playerId, card: clone(card), trickNumber: trick.number })
    if (trick.cards.length === 3) {
      this.#phaseBeforeTrickComplete = this.#phase
      this.#phase = GamePhase.TRICK_COMPLETE
      this.#currentPlayerId = undefined
    } else {
      this.#currentPlayerId = this.#nextPlayer(playerId)
    }
  }

  resolveTrick(): PlayerId {
    this.#requirePhase(GamePhase.TRICK_COMPLETE)
    const trick = this.#currentTrick!
    const winnerId = RuleEngine.trickWinner(trick.cards, this.#contract?.trump ?? 'NT')
    this.#tricksWon[winnerId]! += 1
    this.#completedTricks.push(clone({ ...trick, winnerId }))
    this.#events.append('TRICK_WON', this.#handNumber, { trickNumber: trick.number, winnerId })
    this.#currentTrick = undefined
    if (this.#completedTricks.length === 10) {
      this.#phase = GamePhase.SCORING
      return winnerId
    }
    if (this.#phaseBeforeTrickComplete === GamePhase.PLAYING_FIRST_TRICK) {
      this.#phase = GamePhase.TALON_REVEAL
      return winnerId
    }
    if (this.#phaseBeforeTrickComplete === GamePhase.RASPASY_PLAYING && trick.number === 1) {
      this.#phase = GamePhase.RASPASY_TALON_REVEAL
      this.#currentPlayerId = winnerId
      return winnerId
    }
    const raspasy = this.#phaseBeforeTrickComplete === GamePhase.RASPASY_PLAYING
    this.#phase = raspasy ? GamePhase.RASPASY_PLAYING : GamePhase.PLAYING
    this.#beginTrick(trick.number + 1, winnerId)
    return winnerId
  }

  revealTalon(): readonly Card[] {
    this.#requirePhase(GamePhase.TALON_REVEAL)
    const recipientId = this.#completedTricks[0]?.winnerId
    if (!recipientId) throw new RuleViolation('Il vincitore della prima presa non è disponibile')
    this.#revealedTalon = [...this.#talon]
    this.#hands[recipientId]!.add(this.#talon)
    this.#events.append('TALON_REVEALED', this.#handNumber, { cards: clone(this.#talon), recipientId })
    this.#phase = GamePhase.DECLARER_DISCARD
    this.#currentPlayerId = recipientId
    return clone(this.#revealedTalon)
  }

  discard(playerId: PlayerId, cardIds: readonly [string, string]): void {
    this.#requirePhase(GamePhase.DECLARER_DISCARD)
    const recipientId = this.#completedTricks[0]?.winnerId
    if (playerId !== recipientId) throw new RuleViolation('Solo il vincitore della prima presa può scartare')
    if (cardIds[0] === cardIds[1]) throw new RuleViolation('Occorrono due carte distinte')
    const cards = cardIds.map(id => this.#hands[playerId]!.find(id))
    if (cards.some(card => !card)) throw new RuleViolation('Si possono scartare solo carte possedute')
    this.#discards = cards as Card[]
    this.#discardOwnerId = playerId
    this.#hands[playerId]!.removeMany(cardIds)
    this.#events.append('CARDS_DISCARDED', this.#handNumber, { playerId, count: 2 }, { [playerId]: { cards: clone(this.#discards) } })
    const leaderId = this.#completedTricks[0]!.winnerId!
    this.#phase = GamePhase.PLAYING
    this.#beginTrick(2, leaderId)
  }

  revealNextRaspasyTalonCard(): Card {
    this.#requirePhase(GamePhase.RASPASY_TALON_REVEAL)
    const card = this.#talon[1]!
    this.#revealedTalon.push(card)
    this.#events.append('TALON_CARD_REVEALED', this.#handNumber, { card: clone(card), trickNumber: 2 })
    const leaderId = this.#currentPlayerId!
    this.#phase = GamePhase.RASPASY_PLAYING
    this.#beginTrick(2, leaderId, card.suit)
    return clone(card)
  }

  scoreHand(): HandResult {
    this.#requirePhase(GamePhase.SCORING)
    let result: HandResult
    if (!this.#contract) {
      result = ScoringEngine.raspasy({ players: this.#players, tricks: this.#tricksWon, value: this.#currentRaspasyValue })
      this.#raspasyStreak = Math.min(3, this.#raspasyStreak + 1)
    } else if (this.#contract.kind === ContractKind.MIZER) {
      result = ScoringEngine.mizer({ players: this.#players, contract: this.#contract, tricks: this.#tricksWon })
    } else {
      result = ScoringEngine.normal({
        players: this.#players,
        contract: this.#contract,
        defenderOrder: this.#defenderOrder!,
        decisions: this.#defenderDecisions,
        tricks: this.#tricksWon,
      })
    }
    this.#applyResult(result)
    this.#lastResult = clone(result)
    this.#events.append('SCORE_UPDATED', this.#handNumber, { result: clone(result), scoreboard: clone(this.#scoreboard) })
    this.#events.append('HAND_COMPLETED', this.#handNumber, { tricks: clone(this.#tricksWon) })
    const complete = this.#players.every(id => this.#scoreboard.scores[id]!.pool >= this.#config.poolTarget)
    this.#phase = complete ? GamePhase.GAME_COMPLETE : GamePhase.HAND_COMPLETE
    this.#currentPlayerId = undefined
    return clone(result)
  }

  nextHand(): void {
    this.#requirePhase(GamePhase.HAND_COMPLETE)
    this.#firstPlayerId = this.#nextPlayer(this.#firstPlayerId)
    this.#startHand()
  }

  getPlayerView(playerId: PlayerId): PlayerView {
    if (!this.#players.includes(playerId)) throw new Error('Giocatore sconosciuto')
    const publicHands: Record<PlayerId, readonly Card[]> = {}
    if (this.#defenseMode === DefenseMode.ONE_VIST_OPEN && this.#contract) {
      for (const defenderId of this.#players.filter(id => id !== this.#contract!.declarerId)) publicHands[defenderId] = clone(this.#hands[defenderId]!.cards())
    }
    return Object.freeze({
      viewerId: playerId,
      phase: this.#phase,
      handNumber: this.#handNumber,
      playersInOrder: clone(this.#config.players),
      firstPlayerId: this.#firstPlayerId,
      currentPlayerId: this.#currentPlayerId,
      ownHand: clone(this.#hands[playerId]?.cards() ?? []),
      publicHands: Object.freeze(publicHands),
      handSizes: Object.freeze(Object.fromEntries(this.#players.map(id => [id, this.#hands[id]?.size ?? 0]))),
      auction: clone(this.#auction),
      contract: this.#contract ? clone(this.#contract) : undefined,
      defenderDecisions: clone(this.#defenderDecisions),
      defenseMode: this.#defenseMode,
      currentTrick: this.#currentTrick ? clone(this.#currentTrick) : undefined,
      completedTricks: clone(this.#completedTricks),
      revealedTalon: clone(this.#revealedTalon),
      ownDiscards: playerId === this.#discardOwnerId ? clone(this.#discards) : [],
      tricksWon: clone(this.#tricksWon),
      scoreboard: clone(this.#scoreboard),
      raspasyStreak: this.#raspasyStreak,
      raspasyValue: this.#currentRaspasyValue,
      legalMoves: this.getLegalMoves(playerId),
      legalAuctionActions: this.#legalAuctionActions(playerId),
      legalDefenderDecisions: this.#legalDefenderDecisions(playerId),
      events: this.#events.forPlayer(playerId),
    })
  }

  getLastResult(): HandResult | undefined {
    return this.#lastResult ? clone(this.#lastResult) : undefined
  }

  #startHand(): void {
    this.#phase = GamePhase.DEALING
    this.#handNumber += 1
    this.#hands = Object.fromEntries(this.#players.map(id => [id, new Hand()]))
    this.#talon = []
    this.#revealedTalon = []
    this.#discards = []
    this.#discardOwnerId = undefined
    this.#auction = []
    this.#passed = new Set()
    this.#highestBid = undefined
    this.#highestBidderId = undefined
    this.#contract = undefined
    this.#defenderOrder = undefined
    this.#defenderDecisions = {}
    this.#defenseMode = DefenseMode.NONE
    this.#currentTrick = undefined
    this.#completedTricks = []
    this.#tricksWon = this.#zeroes()
    this.#lastResult = undefined
    const deck = Deck.shuffled(this.#random)
    for (let index = 0; index < 30; index += 1) {
      const playerId = this.#players[(this.#players.indexOf(this.#firstPlayerId) + index) % 3]!
      this.#hands[playerId]!.add([deck[index]!])
    }
    this.#talon = deck.slice(30)
    this.#events.append('HAND_STARTED', this.#handNumber, { firstPlayerId: this.#firstPlayerId })
    this.#events.append('CARDS_DEALT', this.#handNumber, { handSizes: this.#zeroes(10), talonSize: 2 }, Object.fromEntries(this.#players.map(id => [id, { hand: clone(this.#hands[id]!.cards()) }])))
    this.#phase = GamePhase.BIDDING
    this.#currentPlayerId = this.#firstPlayerId
  }

  #winContract(declarerId: PlayerId, bid: Bid): void {
    this.#contract = RuleEngine.contractFromBid(declarerId, bid)
    this.#events.append('CONTRACT_WON', this.#handNumber, { contract: clone(this.#contract) })
    if (bid.kind === ContractKind.MIZER) {
      this.#raspasyStreak = 0
      this.#beginFirstTrick()
      return
    }
    const afterDeclarer = this.#nextPlayer(declarerId)
    this.#defenderOrder = [afterDeclarer, this.#nextPlayer(afterDeclarer)]
    this.#phase = GamePhase.DEFENDER_DECISIONS
    this.#currentPlayerId = this.#defenderOrder[0]
  }

  #finishDefenderDecisions(): void {
    const [first, second] = this.#defenderOrder!
    const firstChoice = this.#defenderDecisions[first]
    const secondChoice = this.#defenderDecisions[second]
    if (firstChoice === DefenderDecision.PASS && secondChoice === DefenderDecision.PASS) {
      this.#defenseMode = DefenseMode.TWO_PASS
      this.#phase = GamePhase.SCORING
      this.#currentPlayerId = undefined
      return
    }
    if (secondChoice === DefenderDecision.POLVIST) this.#defenseMode = DefenseMode.POLVIST
    else if (firstChoice === DefenderDecision.VIST && secondChoice === DefenderDecision.VIST) this.#defenseMode = DefenseMode.TWO_VISTS
    else this.#defenseMode = DefenseMode.ONE_VIST_OPEN
    this.#raspasyStreak = 0
    this.#beginFirstTrick()
  }

  #beginFirstTrick(): void {
    this.#phase = GamePhase.PLAYING_FIRST_TRICK
    this.#beginTrick(1, this.#firstPlayerId)
  }

  #startRaspasy(): void {
    this.#contract = undefined
    this.#defenseMode = DefenseMode.NONE
    this.#currentRaspasyValue = Math.min(3, this.#raspasyStreak + 1) as 1 | 2 | 3
    const card = this.#talon[0]!
    this.#revealedTalon = [card]
    this.#events.append('RASPASY_STARTED', this.#handNumber, { value: this.#currentRaspasyValue })
    this.#events.append('TALON_CARD_REVEALED', this.#handNumber, { card: clone(card), trickNumber: 1 })
    this.#phase = GamePhase.RASPASY_PLAYING
    this.#beginTrick(1, this.#firstPlayerId, card.suit)
  }

  #beginTrick(number: number, leaderId: PlayerId, forcedLeadSuit?: Card['suit']): void {
    this.#currentTrick = { number, leaderId, forcedLeadSuit, cards: [] }
    this.#currentPlayerId = leaderId
  }

  #applyResult(result: HandResult): void {
    for (const id of this.#players) {
      this.#scoreboard.scores[id]!.penalty += result.penalties[id] ?? 0
      for (const againstId of this.#players.filter(other => other !== id)) {
        this.#scoreboard.credits[id]![againstId]! += result.credits[id]?.[againstId] ?? 0
      }
    }
    for (const id of this.#players) {
      const points = result.poolAwards[id] ?? 0
      if (points > 0) this.#awardPool(id, points)
    }
  }

  #awardPool(playerId: PlayerId, points: number): void {
    const outcome = this.#poolPolicy.award({
      playersInOrder: this.#players,
      poolTarget: this.#config.poolTarget,
      scores: clone(this.#scoreboard.scores),
    }, playerId, points)
    for (const id of this.#players) {
      this.#scoreboard.scores[id]!.pool += outcome.poolChanges[id] ?? 0
      this.#scoreboard.scores[id]!.penalty += outcome.penaltyChanges[id] ?? 0
    }
    for (const change of outcome.creditChanges) this.#scoreboard.credits[change.fromId]![change.againstId]! += change.amount
  }

  #zeroes(value = 0): Record<PlayerId, number> {
    return Object.fromEntries(this.#players.map(id => [id, value]))
  }

  #legalAuctionActions(playerId: PlayerId): AuctionAction[] {
    if (this.#phase !== GamePhase.BIDDING || this.#currentPlayerId !== playerId || this.#passed.has(playerId)) return []
    const actions: AuctionAction[] = ['PASS']
    const hasActed = this.#auction.some(record => record.playerId === playerId)
    for (const bid of RuleEngine.allBids()) {
      if (bid.kind === ContractKind.MIZER && hasActed) continue
      if (!this.#highestBid || RuleEngine.bidOrder(bid) > RuleEngine.bidOrder(this.#highestBid)) actions.push(clone(bid))
    }
    return actions
  }

  #legalDefenderDecisions(playerId: PlayerId): DefenderDecision[] {
    if (this.#phase !== GamePhase.DEFENDER_DECISIONS || this.#currentPlayerId !== playerId) return []
    const result = [DefenderDecision.PASS, DefenderDecision.VIST]
    const index = Object.keys(this.#defenderDecisions).length
    if (index === 1 && (this.#contract?.level === 6 || this.#contract?.level === 7) && this.#defenderDecisions[this.#defenderOrder![0]] === DefenderDecision.PASS) {
      result.push(DefenderDecision.POLVIST)
    }
    return result
  }

  #nextPlayer(playerId: PlayerId): PlayerId {
    return this.#players[(this.#players.indexOf(playerId) + 1) % 3]!
  }

  #nextMatching(playerId: PlayerId, predicate: (id: PlayerId) => boolean): PlayerId {
    let candidate = this.#nextPlayer(playerId)
    while (!predicate(candidate)) candidate = this.#nextPlayer(candidate)
    return candidate
  }

  #requirePhase(expected: GamePhase): void {
    if (this.#phase !== expected) throw new RuleViolation(`Comando non valido nello stato ${this.#phase}; richiesto ${expected}`)
  }
}
