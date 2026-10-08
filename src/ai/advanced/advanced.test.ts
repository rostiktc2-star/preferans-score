import { describe, expect, it } from 'vitest'
import { ContractKind, DefenderDecision, GameEngine, GamePhase, type PlayerView } from '../../game'
import { PreferansBot } from '../bot'
import { PlayStyle, SkillLevel, type BotConfig, type BotDecision } from '../types'
import { AdvancedBotAdvisor } from './advisor'
import { DecisionArbiter } from './arbiter'
import { buildLLMContext } from './context'
import { AdvancedSelfPlayMode, simulateAdvancedGames } from './simulation'
import { AdvancedAiMode, ArbitrationStrategy, type AdvisorTransport, type AdvisorTransportResponse, type LLMDecisionContext, type LLMProposal } from './types'

const players = [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }, { id: 'C', name: 'C' }] as const
const config: BotConfig = { skillLevel: SkillLevel.NORMAL, playStyle: PlayStyle.BALANCED, seed: 'advanced-test', monteCarloSamples: 0 }
const initialView = (): PlayerView => { const game = new GameEngine({ players, seed: 23, firstPlayerId: 'A', poolTarget: 100 }); game.startGame(); return game.getPlayerView('A') }
const defenseView = (): PlayerView => ({ ...initialView(), phase: GamePhase.DEFENDER_DECISIONS, currentPlayerId: 'A', contract: { kind: ContractKind.NORMAL, declarerId: 'B', level: 6, trump: 'NT', requiredTricks: 6, value: 2 }, legalAuctionActions: [], legalDefenderDecisions: [DefenderDecision.PASS, DefenderDecision.VIST] })
const proposal = (changes: Partial<LLMProposal> = {}): LLMProposal => ({ action: 'PASS', cardId: null, cardIds: [], bid: null, confidence: .99, reasonCodes: ['LOW_RISK'], ...changes })

class FakeTransport implements AdvisorTransport {
  calls = 0
  contexts: LLMDecisionContext[] = []
  constructor(private readonly responder: (context: LLMDecisionContext, signal: AbortSignal) => Promise<AdvisorTransportResponse> | AdvisorTransportResponse) {}
  async request(context: LLMDecisionContext, signal: AbortSignal): Promise<AdvisorTransportResponse> { this.calls += 1; this.contexts.push(context); return this.responder(context, signal) }
}
const advisor = (transport: AdvisorTransport, changes = {}) => new AdvancedBotAdvisor({ enabled: true, mode: AdvancedAiMode.BALANCED, strategy: ArbitrationStrategy.LLM_OVERRIDE, timeoutMs: 25, maxCallsPerHand: 10, maxCallsPerGame: 20, budgetLimitUsd: 1, ...changes }, transport)

describe('AdvancedBotAdvisor: validazione e failover', () => {
  it('usa il fallback se il modello propone una carta illegale', async () => {
    const view = { ...initialView(), phase: GamePhase.PLAYING, currentPlayerId: 'A', currentTrick: { number: 2, leaderId: 'A', cards: [] }, legalMoves: initialView().ownHand.slice(0, 2), legalAuctionActions: [] }
    const result = await advisor(new FakeTransport(() => ({ proposal: proposal({ action: 'PLAY_CARD', cardId: 'CARD-NOT-OWNED' }) }))).decide(new PreferansBot('A', config), view)
    expect(result.validationStatus).toBe('INVALID'); expect(result.source).toBe('ALGORITHM')
  })

  it('usa il fallback per JSON/proposta invalida', async () => {
    const result = await advisor(new FakeTransport(() => ({ proposal: '{invalid-json' }))).decide(new PreferansBot('A', config), defenseView())
    expect(result.validationStatus).toBe('INVALID')
  })

  it('interrompe al timeout e continua con il bot algoritmico', async () => {
    const transport = new FakeTransport((_context, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError')))))
    const result = await advisor(transport, { timeoutMs: 5 }).decide(new PreferansBot('A', config), defenseView())
    expect(result.validationStatus).toBe('TIMEOUT'); expect(result.decision.type).toBe('DEFENSE')
  })

  it('non chiama la API quando esiste una sola carta legale', async () => {
    const base = initialView(), transport = new FakeTransport(() => ({ proposal: proposal() }))
    const view = { ...base, phase: GamePhase.PLAYING, currentPlayerId: 'A', currentTrick: { number: 2, leaderId: 'B', cards: [] }, legalMoves: base.ownHand.slice(0, 1), legalAuctionActions: [] }
    const result = await advisor(transport).decide(new PreferansBot('A', config), view)
    expect(transport.calls).toBe(0); expect(result.consulted).toBe(false)
  })

  it('da disabilitata è identica alla decisione della Fase 3', async () => {
    const view = defenseView(), expected = new PreferansBot('A', config).decide(view), transport = new FakeTransport(() => ({ proposal: proposal() }))
    const disabled = new AdvancedBotAdvisor({ enabled: false, mode: AdvancedAiMode.BALANCED }, transport)
    expect((await disabled.decide(new PreferansBot('A', config), view)).decision).toEqual(expected)
    expect(transport.calls).toBe(0)
  })

  it('accetta una decisione valida dopo la validazione', async () => {
    const result = await advisor(new FakeTransport(() => ({ proposal: proposal({ action: 'PASS' }) }))).decide(new PreferansBot('A', config), defenseView())
    expect(result).toMatchObject({ source: 'LLM', validationStatus: 'VALID', decision: { type: 'DEFENSE', decision: DefenderDecision.PASS } })
  })

  it('l’arbiter conserva la scelta più affidabile e premia l’accordo', () => {
    const algorithm: BotDecision = { type: 'BID', action: 'PASS', confidence: .9, reasons: ['A'], metrics: {} }
    const llm: BotDecision = { type: 'BID', action: { kind: ContractKind.MIZER }, confidence: .6, reasons: ['B'], metrics: {} }
    const arbiter = new DecisionArbiter()
    expect(arbiter.choose(algorithm, llm).source).toBe('ALGORITHM')
    expect(arbiter.choose(algorithm, { ...algorithm, confidence: .92 }).source).toBe('AGREEMENT')
  })

  it('la cache evita chiamate duplicate', async () => {
    const transport = new FakeTransport(() => ({ proposal: proposal() })), instance = advisor(transport), bot = new PreferansBot('A', config), view = defenseView()
    await instance.decide(bot, view); const second = await instance.decide(bot, view)
    expect(transport.calls).toBe(1); expect(second.validationStatus).toBe('CACHED')
  })

  it('il budget massimo blocca ulteriori chiamate', async () => {
    const transport = new FakeTransport(() => ({ proposal: proposal(), usage: { estimatedCostUsd: .02 } })), instance = advisor(transport, { budgetLimitUsd: .01 })
    await instance.decide(new PreferansBot('A', config), defenseView())
    const second = await instance.decide(new PreferansBot('A', config), { ...defenseView(), handNumber: 2 })
    expect(transport.calls).toBe(1); expect(second.validationStatus).toBe('BUDGET_BLOCKED')
  })

  it('rate limit e outage non interrompono la partita', async () => {
    for (const message of ['429 rate limit', 'network offline']) {
      const result = await advisor(new FakeTransport(() => { throw new Error(message) })).decide(new PreferansBot('A', config), defenseView())
      expect(result).toMatchObject({ source: 'ALGORITHM', validationStatus: 'UNAVAILABLE' })
    }
  })
})

describe('AdvancedBotAdvisor: anti-cheat', () => {
  it('il contesto non contiene mani, tallone, scarti o seed nascosti', () => {
    const bot = new PreferansBot('A', config), view = initialView(); bot.memory.update(view)
    const context = buildLLMContext({ botId: 'A', view, config }, bot.memory)
    const serialized = JSON.stringify(context)
    for (const forbidden of ['hiddenHands', 'hiddenTalon', 'hiddenDiscard', 'futureDeck', 'randomSeed', 'internalGameState', 'ownDiscards', 'seed']) expect(serialized).not.toContain(forbidden)
    expect(context.hand).toHaveLength(10); expect(context.revealedTalon).toEqual([])
  })
})

const legalTransport = () => new FakeTransport(context => {
  let choice: LLMProposal
  if (context.legal.cards.length) choice = proposal({ action: 'PLAY_CARD', cardId: context.legal.cards[0] })
  else if (context.legal.discardableCards.length) choice = proposal({ action: 'DISCARD', cardIds: context.legal.discardableCards.slice(0, 2) })
  else if (context.legal.defenderActions.length) choice = proposal({ action: context.legal.defenderActions[0] === DefenderDecision.PASS ? 'PASS' : context.legal.defenderActions[0] })
  else choice = proposal({ action: 'PASS' })
  return { proposal: choice, usage: { inputTokens: 100, outputTokens: 20, estimatedCostUsd: .0001 } }
})

describe('self-play A/B', () => {
  it('completa 100 mani con AI avanzata simulata e 100 senza AI', async () => {
    const advanced = await simulateAdvancedGames(100, AdvancedSelfPlayMode.ADVANCED_VS_ADVANCED, () => legalTransport())
    const algorithm = await simulateAdvancedGames(100, AdvancedSelfPlayMode.ALGORITHM_VS_ALGORITHM, () => { throw new Error('Il trasporto non deve essere creato') })
    for (const stats of [advanced, algorithm]) { expect(stats.hands).toBe(100); expect(stats.ruleErrors).toBe(0); expect(stats.blockedHands).toBe(0); expect(stats.successfulContracts + stats.failedContracts + stats.raspasy).toBe(100) }
    expect(advanced.advisor.requests).toBeGreaterThan(0); expect(algorithm.advisor.requests).toBe(0)
  }, 30_000)
})
