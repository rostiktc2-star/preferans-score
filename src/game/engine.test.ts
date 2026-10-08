import { describe, expect, it } from 'vitest'
import {
  ContractKind,
  DefenderDecision,
  DefenseMode,
  GameEngine,
  GamePhase,
  Rank,
  runHeadlessDemo,
  RuleEngine,
  ScoringEngine,
  SeededRandomProvider,
  Suit,
  type Bid,
  type Card,
  type Contract,
  type PlayerId,
} from './index'

const players = [
  { id: 'A', name: 'Anna' },
  { id: 'B', name: 'Boris' },
  { id: 'C', name: 'Carlo' },
] as const
const normalBid = (level: 6 | 7 | 8 | 9 | 10 = 6, trump: Suit | 'NT' = Suit.SPADES): Bid => ({ kind: ContractKind.NORMAL, level, trump })
const engine = (seed: number | string = 1) => new GameEngine({ players, seed, firstPlayerId: 'A', poolTarget: 100 })

function startNormal(game: GameEngine, level: 6 | 7 | 8 | 9 | 10 = 6, decisions: readonly [DefenderDecision, DefenderDecision] = [DefenderDecision.VIST, DefenderDecision.PASS]): void {
  game.startGame()
  game.makeBid('A', normalBid(level, Suit.HEARTS))
  game.makeBid('B', 'PASS')
  game.makeBid('C', 'PASS')
  game.makeDefenderDecision('B', decisions[0])
  game.makeDefenderDecision('C', decisions[1])
}

function playCurrentTrick(game: GameEngine): PlayerId {
  while (game.phase !== GamePhase.TRICK_COMPLETE) {
    const current = game.getPlayerView('A').currentPlayerId!
    const legal = game.getPlayerView(current).legalMoves
    game.playCard(current, legal[0]!.id)
  }
  return game.resolveTrick()
}

function finishPlayedHand(game: GameEngine): void {
  if (game.phase === GamePhase.PLAYING_FIRST_TRICK) {
    playCurrentTrick(game)
    game.revealTalon()
    const declarer = game.getPlayerView('A').contract!.declarerId
    const cards = game.getPlayerView(declarer).ownHand
    game.discard(declarer, [cards[0]!.id, cards[1]!.id])
  }
  while (game.phase !== GamePhase.SCORING) {
    if (game.phase === GamePhase.RASPASY_TALON_REVEAL) game.revealNextRaspasyTalonCard()
    playCurrentTrick(game)
  }
  game.scoreHand()
}

function completeRaspasy(game: GameEngine): void {
  if (game.phase === GamePhase.SETUP) game.startGame()
  game.makeBid(game.getPlayerView('A').currentPlayerId!, 'PASS')
  game.makeBid(game.getPlayerView('A').currentPlayerId!, 'PASS')
  game.makeBid(game.getPlayerView('A').currentPlayerId!, 'PASS')
  finishPlayedHand(game)
}

describe('mazzo, distribuzione e casualità', () => {
  it('distribuisce 10 + 10 + 10 e conserva due carte nascoste nel tallone', () => {
    const game = engine(42)
    game.startGame()
    const views = players.map(player => game.getPlayerView(player.id))
    expect(views.map(view => view.ownHand.length)).toEqual([10, 10, 10])
    expect(views.every(view => view.revealedTalon.length === 0)).toBe(true)
    const dealt = views.flatMap(view => view.ownHand.map(card => card.id))
    expect(new Set(dealt).size).toBe(30)
  })

  it('usa carte tipizzate, univoche e ordinate per forza numerica', () => {
    const cards = engine(2)
    cards.startGame()
    const all = players.flatMap(player => cards.getPlayerView(player.id).ownHand)
    expect(all.every(card => card.id && Object.values(Suit).includes(card.suit) && card.numericStrength === card.rank)).toBe(true)
    expect(Rank.ACE).toBeGreaterThan(Rank.KING)
  })

  it('riproduce esattamente la distribuzione con lo stesso seed', () => {
    const a = engine('replay'); const b = engine('replay')
    a.startGame(); b.startGame()
    expect(a.getPlayerView('A').ownHand).toEqual(b.getPlayerView('A').ownHand)
    expect(new SeededRandomProvider(9).shuffle([1, 2, 3, 4])).toEqual(new SeededRandomProvider(9).shuffle([1, 2, 3, 4]))
  })
})

describe('asta', () => {
  it('ordina Mizer esattamente tra 8NT e 9 picche', () => {
    expect(RuleEngine.bidOrder(normalBid(8, 'NT'))).toBeLessThan(RuleEngine.bidOrder({ kind: ContractKind.MIZER }))
    expect(RuleEngine.bidOrder({ kind: ContractKind.MIZER })).toBeLessThan(RuleEngine.bidOrder(normalBid(9, Suit.SPADES)))
  })

  it('mantiene lo storico, vieta offerte inferiori e rende il Pass definitivo', () => {
    const game = engine(); game.startGame()
    game.makeBid('A', normalBid(6, Suit.SPADES))
    expect(() => game.makeBid('B', normalBid(6, Suit.SPADES))).toThrow(/superare/)
    game.makeBid('B', 'PASS')
    expect(() => game.makeBid('B', normalBid(10, 'NT'))).toThrow(/turno|passa/)
    expect(game.getPlayerView('A').auction).toHaveLength(2)
  })

  it('consente Mizer solo come prima dichiarazione personale', () => {
    const game = engine(); game.startGame()
    game.makeBid('A', normalBid(6, Suit.SPADES))
    game.makeBid('B', normalBid(6, Suit.CLUBS))
    game.makeBid('C', 'PASS')
    expect(() => game.makeBid('A', { kind: ContractKind.MIZER })).toThrow(/prima dichiarazione/)
  })

  it('trasforma tre Pass iniziali in Raspasy', () => {
    const game = engine(); game.startGame()
    game.makeBid('A', 'PASS'); game.makeBid('B', 'PASS'); game.makeBid('C', 'PASS')
    expect(game.phase).toBe(GamePhase.RASPASY_PLAYING)
    expect(game.getPlayerView('B').contract).toBeUndefined()
    expect(game.getPlayerView('B').revealedTalon).toHaveLength(1)
  })
})

describe('gioco delle carte e tallone personalizzato', () => {
  it('impone risposta al seme e, in mancanza, la briscola', () => {
    const lead: Card = { id: 'S7', suit: Suit.SPADES, rank: Rank.SEVEN, numericStrength: 7 }
    const follow: Card = { id: 'SA', suit: Suit.SPADES, rank: Rank.ACE, numericStrength: 14 }
    const trump: Card = { id: 'H7', suit: Suit.HEARTS, rank: Rank.SEVEN, numericStrength: 7 }
    const discard: Card = { id: 'C7', suit: Suit.CLUBS, rank: Rank.SEVEN, numericStrength: 7 }
    const trick = { number: 1, leaderId: 'A', cards: [{ playerId: 'A', card: lead }] }
    expect(RuleEngine.getLegalMoves([follow, trump], trick, Suit.HEARTS)).toEqual([follow])
    expect(RuleEngine.getLegalMoves([trump, discard], trick, Suit.HEARTS)).toEqual([trump])
    expect(RuleEngine.getLegalMoves([discard], trick, 'NT')).toEqual([discard])
  })

  it('determina correttamente vincitore, briscola e carta alta', () => {
    const card = (id: string, suit: Suit, rank: Rank): Card => ({ id, suit, rank, numericStrength: rank })
    const plays = [
      { playerId: 'A', card: card('SA', Suit.SPADES, Rank.ACE) },
      { playerId: 'B', card: card('H7', Suit.HEARTS, Rank.SEVEN) },
      { playerId: 'C', card: card('SK', Suit.SPADES, Rank.KING) },
    ]
    expect(RuleEngine.trickWinner(plays, Suit.HEARTS)).toBe('B')
    expect(RuleEngine.trickWinner(plays, 'NT')).toBe('A')
  })

  it('gioca la prima presa dalle mani originali e blocca la seconda fino allo scarto', () => {
    const game = engine(8); startNormal(game)
    expect(game.getPlayerView('A').ownHand).toHaveLength(10)
    expect(game.getPlayerView('A').currentPlayerId).toBe('A')
    playCurrentTrick(game)
    expect(game.phase).toBe(GamePhase.TALON_REVEAL)
    expect(() => game.playCard(game.firstPlayerId, 'x')).toThrow(/stato/)
    game.revealTalon()
    expect(game.phase).toBe(GamePhase.DECLARER_DISCARD)
    expect(game.getPlayerView('A').ownHand).toHaveLength(11)
    expect(() => game.playCard('A', game.getPlayerView('A').ownHand[0]!.id)).toThrow(/stato/)
    const hand = game.getPlayerView('A').ownHand
    game.discard('A', [hand[0]!.id, hand[1]!.id])
    expect(game.phase).toBe(GamePhase.PLAYING)
    expect(game.getPlayerView('A').ownHand).toHaveLength(9)
  })

  it('permette di scartare qualsiasi coppia posseduta e fa condurre il vincitore', () => {
    const game = engine(15); startNormal(game)
    const winner = playCurrentTrick(game)
    game.revealTalon()
    const hand = game.getPlayerView('A').ownHand
    game.discard('A', [hand.at(-1)!.id, hand.at(-2)!.id])
    expect(game.getPlayerView('A').currentPlayerId).toBe(winner)
  })
})

describe('difesa e scoring puro', () => {
  const contract = (level: 6 | 7 | 8 | 9 | 10): Contract => ({ kind: ContractKind.NORMAL, declarerId: 'A', level, trump: Suit.SPADES, requiredTricks: level, value: { 6: 2, 7: 4, 8: 6, 9: 8, 10: 10 }[level] })

  it('gestisce due Pass come mano non giocata e non resetta i Raspasy', () => {
    const game = engine(22); game.startGame()
    game.makeBid('A', normalBid()); game.makeBid('B', 'PASS'); game.makeBid('C', 'PASS')
    game.makeDefenderDecision('B', DefenderDecision.PASS); game.makeDefenderDecision('C', DefenderDecision.PASS)
    expect(game.phase).toBe(GamePhase.SCORING)
    game.scoreHand()
    expect(game.getPlayerView('A').scoreboard.scores.A.pool).toBe(2)
  })

  it('attribuisce a un solo vistante tutte le prese difensive e la responsabilità complessiva', () => {
    const result = ScoringEngine.normal({ players: ['A', 'B', 'C'], contract: contract(6), defenderOrder: ['B', 'C'], decisions: { B: DefenderDecision.VIST, C: DefenderDecision.PASS }, tricks: { A: 7, B: 1, C: 2 } })
    expect(result.credits.B!.A).toBe(6)
    expect(result.credits.C!.A).toBe(0)
    expect(result.penalties.B).toBe(2)
  })

  it('attribuisce ai due vistanti crediti personali e quote personali', () => {
    const result = ScoringEngine.normal({ players: ['A', 'B', 'C'], contract: contract(7), defenderOrder: ['B', 'C'], decisions: { B: DefenderDecision.VIST, C: DefenderDecision.VIST }, tricks: { A: 8, B: 0, C: 2 } })
    expect(result.credits.B!.A).toBe(0)
    expect(result.credits.C!.A).toBe(8)
    expect(result.penalties.B).toBe(4)
    expect(result.penalties.C).toBe(0)
  })

  it('sui contratti 8-10 rende responsabile solo il secondo difensore', () => {
    const result = ScoringEngine.normal({ players: ['A', 'B', 'C'], contract: contract(9), defenderOrder: ['B', 'C'], decisions: { B: DefenderDecision.VIST, C: DefenderDecision.VIST }, tricks: { A: 10, B: 0, C: 0 } })
    expect(result.penalties.B).toBe(0)
    expect(result.penalties.C).toBe(8)
  })

  it('valida e calcola il Polvist giocato', () => {
    const game = engine(); game.startGame()
    game.makeBid('A', normalBid(7)); game.makeBid('B', 'PASS'); game.makeBid('C', 'PASS')
    expect(() => game.makeDefenderDecision('B', DefenderDecision.POLVIST)).toThrow(/Polvist/)
    game.makeDefenderDecision('B', DefenderDecision.PASS)
    game.makeDefenderDecision('C', DefenderDecision.POLVIST)
    expect(game.getPlayerView('A').defenseMode).toBe(DefenseMode.POLVIST)
    const result = ScoringEngine.normal({ players: ['A', 'B', 'C'], contract: contract(7), defenderOrder: ['B', 'C'], decisions: { B: DefenderDecision.PASS, C: DefenderDecision.POLVIST }, tricks: { A: 8, B: 1, C: 1 } })
    expect(result.credits.C!.A).toBe(4)
    expect(result.penalties.C).toBe(0)
  })

  it('calcola successo e fallimento di tutti i livelli normali', () => {
    for (const level of [6, 7, 8, 9, 10] as const) {
      const success = ScoringEngine.normal({ players: ['A', 'B', 'C'], contract: contract(level), defenderOrder: ['B', 'C'], decisions: { B: DefenderDecision.VIST, C: DefenderDecision.PASS }, tricks: { A: level, B: 10 - level, C: 0 } })
      expect(success.poolAwards.A).toBe(contract(level).value)
      const failed = ScoringEngine.normal({ players: ['A', 'B', 'C'], contract: contract(level), defenderOrder: ['B', 'C'], decisions: { B: DefenderDecision.VIST, C: DefenderDecision.PASS }, tricks: { A: level - 1, B: 11 - level, C: 0 } })
      expect(failed.penalties.A).toBe(contract(level).value)
    }
  })

  it('calcola Mizer riuscito e fallito', () => {
    const mizer: Contract = { kind: ContractKind.MIZER, declarerId: 'A', trump: 'NT', requiredTricks: 0, value: 10 }
    expect(ScoringEngine.mizer({ players: ['A', 'B', 'C'], contract: mizer, tricks: { A: 0, B: 4, C: 6 } }).poolAwards.A).toBe(10)
    expect(ScoringEngine.mizer({ players: ['A', 'B', 'C'], contract: mizer, tricks: { A: 2, B: 4, C: 4 } }).penalties.A).toBe(20)
  })
})

describe('Raspasy', () => {
  it('usa le due carte del tallone come semi richiesti senza farle vincere', () => {
    const game = engine(40); game.startGame()
    game.makeBid('A', 'PASS'); game.makeBid('B', 'PASS'); game.makeBid('C', 'PASS')
    const firstTalon = game.getPlayerView('A').revealedTalon[0]!
    const firstLegal = game.getPlayerView('A').legalMoves
    if (game.getPlayerView('A').ownHand.some(card => card.suit === firstTalon.suit)) expect(firstLegal.every(card => card.suit === firstTalon.suit)).toBe(true)
    playCurrentTrick(game)
    expect(game.phase).toBe(GamePhase.RASPASY_TALON_REVEAL)
    game.revealNextRaspasyTalonCard()
    expect(game.getPlayerView('B').revealedTalon).toHaveLength(2)
  })

  it('calcola minimo, penalità e premio fisso per zero prese', () => {
    const result = ScoringEngine.raspasy({ players: ['A', 'B', 'C'], tricks: { A: 0, B: 3, C: 7 }, value: 3 })
    expect(result.poolAwards.A).toBe(1)
    expect(result.penalties).toEqual({ A: 0, B: 9, C: 21 })
  })

  it('progredisce 1, 2, 3, 3 e ruota il giocatore di mano', () => {
    const game = engine(51)
    const values: number[] = []
    const firsts: string[] = []
    for (let hand = 0; hand < 4; hand += 1) {
      if (hand > 0) game.nextHand()
      firsts.push(game.firstPlayerId)
      completeRaspasy(game)
      values.push(game.getLastResult()!.raspasyValue!)
    }
    expect(values).toEqual([1, 2, 3, 3])
    expect(firsts).toEqual(['A', 'B', 'C', 'A'])
  })

  it('non viene resettato da due Pass ma viene resettato da un contratto giocato', () => {
    const game = engine(61)
    completeRaspasy(game)
    game.nextHand()
    game.makeBid('B', normalBid()); game.makeBid('C', 'PASS'); game.makeBid('A', 'PASS')
    game.makeDefenderDecision('C', DefenderDecision.PASS); game.makeDefenderDecision('A', DefenderDecision.PASS)
    game.scoreHand()
    game.nextHand()
    completeRaspasy(game)
    expect(game.getLastResult()!.raspasyValue).toBe(2)

    game.nextHand()
    game.makeBid('A', normalBid()); game.makeBid('B', 'PASS'); game.makeBid('C', 'PASS')
    game.makeDefenderDecision('B', DefenderDecision.VIST); game.makeDefenderDecision('C', DefenderDecision.PASS)
    finishPlayedHand(game)
    game.nextHand()
    completeRaspasy(game)
    expect(game.getLastResult()!.raspasyValue).toBe(1)
  })
})

describe('informazione imperfetta e anti-cheat', () => {
  it('non espone mai mani avversarie né tallone prima della rivelazione', () => {
    const game = engine(70); game.startGame()
    const a = game.getPlayerView('A') as unknown as Record<string, unknown>
    const b = game.getPlayerView('B') as unknown as Record<string, unknown>
    expect(a.hands).toBeUndefined()
    expect(b.gameState).toBeUndefined()
    expect(game.getPlayerView('A').publicHands.B).toBeUndefined()
    expect(game.getPlayerView('B').publicHands.A).toBeUndefined()
    expect(players.every(player => game.getPlayerView(player.id).revealedTalon.length === 0)).toBe(true)
  })

  it('rende pubblico il tallone, mantiene privati gli scarti e limita il Vist aperto ai difensori', () => {
    const game = engine(71); startNormal(game, 6, [DefenderDecision.VIST, DefenderDecision.PASS])
    expect(game.getPlayerView('A').publicHands.B).toHaveLength(10)
    expect(game.getPlayerView('A').publicHands.C).toHaveLength(10)
    expect(game.getPlayerView('B').publicHands.A).toBeUndefined()
    playCurrentTrick(game)
    game.revealTalon()
    const cards = game.getPlayerView('A').ownHand
    const discarded = [cards[0]!.id, cards[1]!.id] as const
    game.discard('A', discarded)
    for (const id of ['A', 'B', 'C']) expect(game.getPlayerView(id).revealedTalon).toHaveLength(2)
    expect(game.getPlayerView('A').ownDiscards.map(card => card.id)).toEqual(discarded)
    expect(game.getPlayerView('B').ownDiscards).toEqual([])
    expect(game.getPlayerView('C').events.find(event => event.type === 'CARDS_DISCARDED')!.data).toEqual({ playerId: 'A', count: 2 })
  })

  it('non apre le mani difensive quando entrambi vistano', () => {
    const game = engine(72); startNormal(game, 6, [DefenderDecision.VIST, DefenderDecision.VIST])
    expect(game.getPlayerView('A').publicHands).toEqual({})
  })
})

describe('esecuzione headless completa', () => {
  it('completa legalmente un contratto, produce eventi e passa alla mano successiva', () => {
    const game = engine(90); startNormal(game)
    finishPlayedHand(game)
    expect(game.phase).toBe(GamePhase.HAND_COMPLETE)
    expect(Object.values(game.getPlayerView('A').tricksWon).reduce((sum, count) => sum + count, 0)).toBe(10)
    expect(game.getPlayerView('A').events.some(event => event.type === 'SCORE_UPDATED')).toBe(true)
    game.nextHand()
    expect(game.handNumber).toBe(2)
    expect(game.firstPlayerId).toBe('B')
    expect(game.phase).toBe(GamePhase.BIDDING)
  })

  it('completa un Mizer reale senza decisioni Vist', () => {
    const game = engine(91); game.startGame()
    game.makeBid('A', { kind: ContractKind.MIZER }); game.makeBid('B', 'PASS'); game.makeBid('C', 'PASS')
    expect(game.phase).toBe(GamePhase.PLAYING_FIRST_TRICK)
    expect(game.getPlayerView('A').defenderDecisions).toEqual({})
    finishPlayedHand(game)
    expect(game.getLastResult()!.kind).toBe('MIZER')
  })

  it('offre un driver di debug completo che usa soltanto PlayerView e mosse legali', () => {
    const report = runHeadlessDemo('debug')
    expect(report.finalViews.every(view => view.phase === GamePhase.HAND_COMPLETE)).toBe(true)
    expect(report.eventCount).toBeGreaterThan(30)
  })
})
