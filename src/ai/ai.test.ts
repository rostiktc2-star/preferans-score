import { describe, expect, it } from 'vitest'
import { ContractKind, Deck, DefenderDecision, DefenseMode, GameEngine, GamePhase, Rank, Suit, type Card, type PlayerView, type RandomProvider, type Trick } from '../game'
import { BotMemory, CardInferenceEngine, HandEvaluator, PlayStyle, PreferansBot, SkillLevel, simulateGames, type BotConfig } from './index'

const players = [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }, { id: 'C', name: 'C' }] as const
const card = (suit: Suit, rank: Rank): Card => ({ id: `${suit}-${rank}`, suit, rank, numericStrength: rank })
const config = (seed: string, skillLevel = SkillLevel.NORMAL, playStyle = PlayStyle.BALANCED): BotConfig => ({ seed, skillLevel, playStyle, monteCarloSamples: 0, timeBudgetMs: 20 })
const initialView = (): PlayerView => { const game = new GameEngine({ players, seed: 10, firstPlayerId: 'A', poolTarget: 100 }); game.startGame(); return game.getPlayerView('A') }
const withView = (changes: Partial<PlayerView>): PlayerView => ({ ...initialView(), ...changes })

class FixedDeckRandom implements RandomProvider {
  constructor(private readonly deck: readonly Card[]) {}
  next(): number { return 0 }
  integer(): number { return 0 }
  shuffle<T>(): T[] { return structuredClone(this.deck) as T[] }
}

function hiddenWorldPair(): readonly [GameEngine, GameEngine] {
  const firstDeck = [...Deck.create()]
  const secondDeck = [...firstDeck]
  for (let index = 0; index < 30; index += 3) {
    ;[secondDeck[index + 1], secondDeck[index + 2]] = [secondDeck[index + 2]!, secondDeck[index + 1]!]
  }
  const create = (deck: readonly Card[]) => {
    const engine = new GameEngine({ players, firstPlayerId: 'A', poolTarget: 100 }, { random: new FixedDeckRandom(deck) })
    engine.startGame()
    return engine
  }
  return [create(firstDeck), create(secondDeck)]
}

describe('valutazione strategica', () => {
  const evaluator = new HandEvaluator()
  it('riconosce una mano con almeno sei prese plausibili', () => {
    const hand = [card(Suit.SPADES, Rank.ACE), card(Suit.SPADES, Rank.KING), card(Suit.SPADES, Rank.QUEEN), card(Suit.SPADES, Rank.JACK), card(Suit.HEARTS, Rank.ACE), card(Suit.CLUBS, Rank.ACE), card(Suit.DIAMONDS, Rank.ACE), card(Suit.HEARTS, Rank.KING), card(Suit.CLUBS, Rank.KING), card(Suit.DIAMONDS, Rank.SEVEN)]
    expect(evaluator.evaluateContract(hand, 6, Suit.SPADES).expectedTricks).toBeGreaterThanOrEqual(6)
    const view = withView({ ownHand: hand, currentPlayerId: 'A', legalAuctionActions: ['PASS', { kind: ContractKind.NORMAL, level: 6, trump: Suit.SPADES }] })
    expect(new PreferansBot('A', config('strong')).decide(view)).toMatchObject({ type: 'BID', action: { kind: ContractKind.NORMAL, level: 6 } })
  })

  it('passa con una mano pessima', () => {
    const hand = [Suit.SPADES, Suit.CLUBS, Suit.DIAMONDS, Suit.HEARTS].flatMap(suit => [card(suit, Rank.SEVEN), card(suit, Rank.EIGHT)]).concat([card(Suit.SPADES, Rank.NINE), card(Suit.CLUBS, Rank.NINE)])
    const view = withView({ ownHand: hand, currentPlayerId: 'A', legalAuctionActions: ['PASS', { kind: ContractKind.NORMAL, level: 6, trump: Suit.HEARTS }] })
    expect(new PreferansBot('A', config('weak')).decide(view)).toMatchObject({ type: 'BID', action: 'PASS' })
  })

  it('valuta positivamente una forma estrema da Mizer', () => {
    const hand = [card(Suit.SPADES, Rank.SEVEN), card(Suit.SPADES, Rank.EIGHT), card(Suit.SPADES, Rank.NINE), card(Suit.CLUBS, Rank.SEVEN), card(Suit.CLUBS, Rank.EIGHT), card(Suit.CLUBS, Rank.NINE), card(Suit.DIAMONDS, Rank.SEVEN), card(Suit.DIAMONDS, Rank.EIGHT), card(Suit.HEARTS, Rank.SEVEN), card(Suit.HEARTS, Rank.EIGHT)]
    expect(evaluator.evaluateMizer(hand).successProbability).toBeGreaterThan(.78)
    const view = withView({ ownHand: hand, currentPlayerId: 'A', legalAuctionActions: ['PASS', { kind: ContractKind.MIZER }] })
    expect(new PreferansBot('A', config('mizer')).decide(view)).toMatchObject({ type: 'BID', action: { kind: ContractKind.MIZER } })
  })

  it('preferisce Pass senza quota difensiva raggiungibile e Vist con quattro controlli', () => {
    const contract = { kind: ContractKind.NORMAL, declarerId: 'B', level: 6 as const, trump: Suit.HEARTS, requiredTricks: 6, value: 2 }
    const low = [card(Suit.SPADES, Rank.SEVEN), card(Suit.CLUBS, Rank.SEVEN), card(Suit.DIAMONDS, Rank.SEVEN)]
    const high = [card(Suit.SPADES, Rank.ACE), card(Suit.CLUBS, Rank.ACE), card(Suit.DIAMONDS, Rank.ACE), card(Suit.HEARTS, Rank.ACE), card(Suit.SPADES, Rank.KING)]
    const base = { phase: GamePhase.DEFENDER_DECISIONS, currentPlayerId: 'A', contract, legalDefenderDecisions: [DefenderDecision.PASS, DefenderDecision.VIST], defenderDecisions: {} }
    expect(new PreferansBot('A', config('def-low', SkillLevel.HARD, PlayStyle.CONSERVATIVE)).decide(withView({ ...base, ownHand: low }))).toMatchObject({ type: 'DEFENSE', decision: DefenderDecision.PASS })
    expect(new PreferansBot('A', config('def-high', SkillLevel.HARD, PlayStyle.AGGRESSIVE)).decide(withView({ ...base, ownHand: high }))).toMatchObject({ type: 'DEFENSE', decision: DefenderDecision.VIST })
  })
})

describe('memoria e inferenza', () => {
  it('rende permanente un void suit e scarta carte già giocate', () => {
    const trick: Trick = { number: 1, leaderId: 'A', cards: [{ playerId: 'A', card: card(Suit.HEARTS, Rank.TEN) }, { playerId: 'B', card: card(Suit.CLUBS, Rank.SEVEN) }, { playerId: 'C', card: card(Suit.HEARTS, Rank.SEVEN) }], winnerId: 'A' }
    const view = withView({ viewerId: 'A', completedTricks: [trick], contract: { kind: ContractKind.NORMAL, declarerId: 'A', level: 6, trump: Suit.SPADES, requiredTricks: 6, value: 2 } })
    const memory = new BotMemory(); memory.update(view)
    expect(memory.inference.B!.voidSuits.has(Suit.HEARTS)).toBe(true)
    expect(memory.inference.B!.voidSuits.has(Suit.SPADES)).toBe(true)
    const possible = new CardInferenceEngine().possibleCards(view, memory)
    expect(possible.B!.some(item => item.suit === Suit.HEARTS || item.id === `${Suit.CLUBS}-${Rank.SEVEN}`)).toBe(false)
  })

  it('usa esattamente le carte rese pubbliche dal Vist aperto', () => {
    const publicCards = [card(Suit.SPADES, Rank.ACE), card(Suit.CLUBS, Rank.SEVEN)]
    const view = withView({ defenseMode: DefenseMode.ONE_VIST_OPEN, publicHands: { B: publicCards }, handSizes: { A: 10, B: 2, C: 10 } })
    const memory = new BotMemory(); memory.update(view)
    expect(new CardInferenceEngine().possibleCards(view, memory).B).toEqual(publicCards)
  })
})

describe('gioco, Mizer, Raspasy e scarto', () => {
  it('con una sola mossa legale sceglie sempre quella', () => {
    const only = card(Suit.HEARTS, Rank.SEVEN)
    const view = withView({ phase: GamePhase.PLAYING, currentPlayerId: 'A', ownHand: [only, card(Suit.CLUBS, Rank.ACE)], legalMoves: [only], currentTrick: { number: 3, leaderId: 'B', cards: [{ playerId: 'B', card: card(Suit.HEARTS, Rank.KING) }] } })
    expect(new PreferansBot('A', config('only')).decide(view)).toMatchObject({ type: 'PLAY_CARD', card: only, reasons: ['only_legal_move'] })
  })

  it('evita una presa evidente sia in Mizer sia nei Raspasy', () => {
    const low = card(Suit.HEARTS, Rank.SEVEN), high = card(Suit.HEARTS, Rank.ACE)
    const trick = { number: 4, leaderId: 'B', cards: [{ playerId: 'B', card: card(Suit.HEARTS, Rank.TEN) }] }
    const common = { phase: GamePhase.PLAYING, currentPlayerId: 'A', ownHand: [low, high], legalMoves: [low, high], currentTrick: trick }
    const mizer = withView({ ...common, contract: { kind: ContractKind.MIZER, declarerId: 'A', trump: 'NT', requiredTricks: 0, value: 10 } })
    const raspasy = withView({ ...common, contract: undefined, phase: GamePhase.RASPASY_PLAYING })
    expect(new PreferansBot('A', config('m-play')).decide(mizer)).toMatchObject({ card: low })
    expect(new PreferansBot('A', config('r-play')).decide(raspasy)).toMatchObject({ card: low })
  })

  it('valuta tutte le combinazioni di scarto e rimuove carte pericolose nel Mizer', () => {
    const hand = [card(Suit.SPADES, Rank.ACE), card(Suit.CLUBS, Rank.KING), card(Suit.SPADES, Rank.SEVEN), card(Suit.SPADES, Rank.EIGHT), card(Suit.CLUBS, Rank.SEVEN), card(Suit.CLUBS, Rank.EIGHT), card(Suit.DIAMONDS, Rank.SEVEN), card(Suit.DIAMONDS, Rank.EIGHT), card(Suit.DIAMONDS, Rank.NINE), card(Suit.HEARTS, Rank.SEVEN), card(Suit.HEARTS, Rank.EIGHT)]
    const view = withView({ phase: GamePhase.DECLARER_DISCARD, currentPlayerId: 'A', ownHand: hand, contract: { kind: ContractKind.MIZER, declarerId: 'A', trump: 'NT', requiredTricks: 0, value: 10 } })
    const decision = new PreferansBot('A', config('discard')).decide(view)
    expect(decision).toMatchObject({ type: 'DISCARD' })
    if (decision.type === 'DISCARD') { expect(decision.metrics.combinations).toBe(55); expect(decision.cardIds).toEqual(expect.arrayContaining([`${Suit.SPADES}-${Rank.ACE}`, `${Suit.CLUBS}-${Rank.KING}`])) }
  })
})

describe('anti-cheat', () => {
  it.each(['asta', 'vist', 'carta', 'mizer', 'raspasy'])('produce la stessa decisione con PlayerView identica e mondi nascosti diversi: %s', scenario => {
    const [worldOne, worldTwo] = hiddenWorldPair()
    const base = worldOne.getPlayerView('A')
    expect(worldOne.getPlayerView('B').ownHand).not.toEqual(worldTwo.getPlayerView('B').ownHand)
    expect(worldOne.getPlayerView('A')).toEqual(worldTwo.getPlayerView('A'))
    let view: PlayerView
    if (scenario === 'vist') view = withView({ phase: GamePhase.DEFENDER_DECISIONS, currentPlayerId: 'A', contract: { kind: ContractKind.NORMAL, declarerId: 'B', level: 6, trump: Suit.CLUBS, requiredTricks: 6, value: 2 }, legalDefenderDecisions: [DefenderDecision.PASS, DefenderDecision.VIST] })
    else if (scenario === 'carta') view = withView({ phase: GamePhase.PLAYING, currentPlayerId: 'A', legalMoves: base.ownHand.slice(0, 2), currentTrick: { number: 2, leaderId: 'A', cards: [] } })
    else if (scenario === 'mizer') view = withView({ legalAuctionActions: ['PASS', { kind: ContractKind.MIZER }], currentPlayerId: 'A' })
    else if (scenario === 'raspasy') view = withView({ phase: GamePhase.RASPASY_PLAYING, currentPlayerId: 'A', legalMoves: base.ownHand.slice(0, 2), currentTrick: { number: 3, leaderId: 'A', cards: [] } })
    else view = withView({ currentPlayerId: 'A' })
    const first = new PreferansBot('A', config(`same-${scenario}`)).decide(structuredClone(view))
    const matchingViewFromSecondWorld = { ...worldTwo.getPlayerView('A'), ...view }
    const second = new PreferansBot('A', config(`same-${scenario}`)).decide(structuredClone(matchingViewFromSecondWorld))
    expect(second).toEqual(first)
    expect(Object.keys({ botId: 'A', view, config: config('x') })).toEqual(['botId', 'view', 'config'])
  })
})

describe('self-play', () => {
  it('completa 1.000 mani senza mosse illegali, blocchi o stati impossibili', () => {
    const stats = simulateGames(1_000)
    expect(stats.hands).toBe(1_000)
    expect(stats.ruleErrors).toBe(0)
    expect(stats.blockedHands).toBe(0)
    expect(stats.bids + stats.passes).toBeGreaterThan(1_000)
    expect(stats.successfulContracts + stats.failedContracts + stats.raspasy).toBe(1_000)
    expect(stats.raspasy).toBeGreaterThan(0)
    expect(stats.vists).toBeGreaterThan(0)
    expect(Object.values(stats.totalTricks).reduce((sum, count) => sum + count, 0)).toBeLessThanOrEqual(10_000)
    expect(stats.averageDecisionMs).toBeLessThan(100)
  }, 30_000)
})
