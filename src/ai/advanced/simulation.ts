import { GameEngine } from '../../game/engine'
import { ContractKind, DefenderDecision, GamePhase, type PlayerId } from '../../game/model'
import { PreferansBot } from '../bot'
import { PlayStyle, SkillLevel, type BotConfig } from '../types'
import { AdvancedBotAdvisor } from './advisor'
import { AdvancedAiMode, ArbitrationStrategy, type AdvisorStats, type AdvisorTransport } from './types'

export enum AdvancedSelfPlayMode { ALGORITHM_VS_ALGORITHM = 'ALGORITHM_VS_ALGORITHM', ADVANCED_VS_ALGORITHM = 'ADVANCED_VS_ALGORITHM', ADVANCED_VS_ADVANCED = 'ADVANCED_VS_ADVANCED' }
export interface AdvancedSimulationStats {
  readonly hands: number; readonly successfulContracts: number; readonly failedContracts: number; readonly raspasy: number
  readonly vists: number; readonly mizers: number; readonly ruleErrors: number; readonly blockedHands: number
  readonly totalTricks: Readonly<Record<PlayerId, number>>; readonly advisor: AdvisorStats
  readonly averageResultValue: number; readonly averageAdvisorLatencyMs: number; readonly averageCostPerHandUsd: number; readonly divergenceRate: number
}

const botConfigs: readonly BotConfig[] = [
  { skillLevel: SkillLevel.NORMAL, playStyle: PlayStyle.BALANCED, seed: 'advanced-a', monteCarloSamples: 0 },
  { skillLevel: SkillLevel.NORMAL, playStyle: PlayStyle.CONSERVATIVE, seed: 'advanced-b', monteCarloSamples: 0 },
  { skillLevel: SkillLevel.NORMAL, playStyle: PlayStyle.AGGRESSIVE, seed: 'advanced-c', monteCarloSamples: 0 },
]
const emptyAdvisor = (): AdvisorStats => ({ requests: 0, cacheHits: 0, fallbacks: 0, accepted: 0, divergences: 0, totalLatencyMs: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 })

export async function simulateAdvancedGames(count: number, mode: AdvancedSelfPlayMode, transportFactory: (playerId: PlayerId, hand: number) => AdvisorTransport): Promise<AdvancedSimulationStats> {
  if (!Number.isInteger(count) || count <= 0) throw new Error('Numero di mani non valido')
  const players = [{ id: 'bot-a', name: 'Bot A' }, { id: 'bot-b', name: 'Bot B' }, { id: 'bot-c', name: 'Bot C' }] as const
  const totalTricks: Record<PlayerId, number> = { 'bot-a': 0, 'bot-b': 0, 'bot-c': 0 }, advisor = emptyAdvisor()
  let hands = 0, successfulContracts = 0, failedContracts = 0, raspasy = 0, vists = 0, mizers = 0, ruleErrors = 0, blockedHands = 0, resultValue = 0
  while (hands < count) {
    const game = new GameEngine({ players, seed: `advanced-self-play-${hands}`, firstPlayerId: players[hands % 3]!.id, poolTarget: 1_000_000 })
    const bots = Object.fromEntries(players.map((player, index) => [player.id, new PreferansBot(player.id, { ...botConfigs[index]!, seed: `${botConfigs[index]!.seed}-${hands}` })])) as Record<PlayerId, PreferansBot>
    const enabled = (id: PlayerId) => mode === AdvancedSelfPlayMode.ADVANCED_VS_ADVANCED || (mode === AdvancedSelfPlayMode.ADVANCED_VS_ALGORITHM && id === 'bot-a')
    const advisors = Object.fromEntries(players.filter(player => enabled(player.id)).map(player => [player.id, new AdvancedBotAdvisor({ enabled: true, mode: AdvancedAiMode.BALANCED, strategy: ArbitrationStrategy.CONFIDENCE_BASED, timeoutMs: 50, maxCallsPerHand: 20, maxCallsPerGame: 20, budgetLimitUsd: 10 }, transportFactory(player.id, hands))])) as Record<PlayerId, AdvancedBotAdvisor>
    game.startGame(); let guard = 0
    try {
      while (![GamePhase.HAND_COMPLETE, GamePhase.GAME_COMPLETE].includes(game.phase) && guard++ < 250) {
        const observer = game.getPlayerView('bot-a')
        if ([GamePhase.BIDDING, GamePhase.DEFENDER_DECISIONS, GamePhase.DECLARER_DISCARD, GamePhase.PLAYING_FIRST_TRICK, GamePhase.PLAYING, GamePhase.RASPASY_PLAYING].includes(observer.phase)) {
          const id = observer.currentPlayerId!, bot = bots[id]!, decision = enabled(id) ? (await advisors[id]!.decide(bot, game.getPlayerView(id))).decision : bot.decide(game.getPlayerView(id))
          if (decision.type === 'BID') { game.makeBid(id, decision.action); if (decision.action !== 'PASS' && decision.action.kind === ContractKind.MIZER) mizers += 1 }
          else if (decision.type === 'DEFENSE') { game.makeDefenderDecision(id, decision.decision); if (decision.decision === DefenderDecision.VIST) vists += 1 }
          else if (decision.type === 'DISCARD') game.discard(id, decision.cardIds)
          else game.playCard(id, decision.card.id)
        } else if (observer.phase === GamePhase.TRICK_COMPLETE) game.resolveTrick()
        else if (observer.phase === GamePhase.TALON_REVEAL) game.revealTalon()
        else if (observer.phase === GamePhase.RASPASY_TALON_REVEAL) game.revealNextRaspasyTalonCard()
        else if (observer.phase === GamePhase.SCORING) game.scoreHand()
        else throw new Error(`Stato inatteso: ${observer.phase}`)
      }
      if (guard >= 250) { blockedHands += 1; throw new Error('Mano bloccata') }
      const view = game.getPlayerView('bot-a'), result = game.getLastResult()!
      if (result.kind === 'RASPASY') raspasy += 1
      else if (result.poolAwards[view.contract!.declarerId]! > 0) successfulContracts += 1
      else failedContracts += 1
      resultValue += Object.values(result.poolAwards).reduce((sum, value) => sum + value, 0) - Object.values(result.penalties).reduce((sum, value) => sum + value, 0)
      for (const player of players) totalTricks[player.id] = (totalTricks[player.id] ?? 0) + (view.tricksWon[player.id] ?? 0)
      for (const item of Object.values(advisors)) for (const key of Object.keys(advisor) as (keyof AdvisorStats)[]) {
        const totals = advisor as unknown as Record<string, number>
        totals[key] = (totals[key] ?? 0) + item.stats[key]
      }
      hands += 1
    } catch (error) { ruleErrors += 1; throw new Error(`Self-play avanzato fallito alla mano ${hands + 1}: ${error instanceof Error ? error.message : String(error)}`) }
  }
  return { hands, successfulContracts, failedContracts, raspasy, vists, mizers, ruleErrors, blockedHands, totalTricks, advisor, averageResultValue: resultValue / hands, averageAdvisorLatencyMs: advisor.requests ? advisor.totalLatencyMs / advisor.requests : 0, averageCostPerHandUsd: advisor.estimatedCostUsd / hands, divergenceRate: advisor.requests ? advisor.divergences / advisor.requests : 0 }
}
