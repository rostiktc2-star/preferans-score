import { GameEngine } from '../game/engine'
import { ContractKind, DefenderDecision, GamePhase, type PlayerId } from '../game/model'
import { PreferansBot } from './bot'
import { PlayStyle, SkillLevel, type BotConfig } from './types'

export interface SimulationStats {
  readonly hands: number
  readonly successfulContracts: number
  readonly failedContracts: number
  readonly bids: number
  readonly passes: number
  readonly mizers: number
  readonly vists: number
  readonly polvists: number
  readonly raspasy: number
  readonly totalTricks: Readonly<Record<PlayerId, number>>
  readonly ruleErrors: number
  readonly blockedHands: number
  readonly averageDecisionMs: number
  readonly maxDecisionMs: number
  readonly resultDistribution: Readonly<Record<string, number>>
}

const defaults: readonly BotConfig[] = [
  { skillLevel: SkillLevel.NORMAL, playStyle: PlayStyle.BALANCED, seed: 'sim-a', monteCarloSamples: 0, timeBudgetMs: 20 },
  { skillLevel: SkillLevel.NORMAL, playStyle: PlayStyle.CONSERVATIVE, seed: 'sim-b', monteCarloSamples: 0, timeBudgetMs: 20 },
  { skillLevel: SkillLevel.NORMAL, playStyle: PlayStyle.AGGRESSIVE, seed: 'sim-c', monteCarloSamples: 0, timeBudgetMs: 20 },
]

export function simulateGames(count: number, botConfigs: readonly BotConfig[] = defaults): SimulationStats {
  if (!Number.isInteger(count) || count <= 0 || botConfigs.length !== 3) throw new Error('Servono un numero positivo di mani e tre configurazioni bot')
  const players = [{ id: 'bot-a', name: 'Bot A' }, { id: 'bot-b', name: 'Bot B' }, { id: 'bot-c', name: 'Bot C' }] as const
  const totalTricks: Record<PlayerId, number> = { 'bot-a': 0, 'bot-b': 0, 'bot-c': 0 }
  const distribution: Record<string, number> = {}
  let hands = 0, successfulContracts = 0, failedContracts = 0, bids = 0, passes = 0, mizers = 0, vists = 0, polvists = 0, raspasy = 0, ruleErrors = 0, blockedHands = 0, decisionMs = 0, decisions = 0, maxDecisionMs = 0
  while (hands < count) {
    const firstPlayerId = players[hands % 3]!.id
    const game = new GameEngine({ players, seed: `self-play-${count}-${hands}`, firstPlayerId, poolTarget: 1_000_000 })
    const bots = Object.fromEntries(players.map((player, index) => [player.id, new PreferansBot(player.id, { ...botConfigs[index]!, seed: `${botConfigs[index]!.seed}-${hands}` })])) as Record<PlayerId, PreferansBot>
    game.startGame()
    let guard = 0
    try {
      while (![GamePhase.HAND_COMPLETE, GamePhase.GAME_COMPLETE].includes(game.phase) && guard++ < 250) {
        const observer = game.getPlayerView('bot-a')
        if ([GamePhase.BIDDING, GamePhase.DEFENDER_DECISIONS, GamePhase.DECLARER_DISCARD, GamePhase.PLAYING_FIRST_TRICK, GamePhase.PLAYING, GamePhase.RASPASY_PLAYING].includes(observer.phase)) {
          const id = observer.currentPlayerId!
          const start = performance.now(); const decision = bots[id]!.decide(game.getPlayerView(id)); const elapsed = performance.now() - start
          decisionMs += elapsed; decisions += 1; maxDecisionMs = Math.max(maxDecisionMs, elapsed)
          if (decision.type === 'BID') { game.makeBid(id, decision.action); if (decision.action === 'PASS') passes += 1; else { bids += 1; if (decision.action.kind === ContractKind.MIZER) mizers += 1 } }
          else if (decision.type === 'DEFENSE') { game.makeDefenderDecision(id, decision.decision); if (decision.decision === DefenderDecision.VIST) vists += 1; if (decision.decision === DefenderDecision.POLVIST) polvists += 1 }
          else if (decision.type === 'DISCARD') game.discard(id, decision.cardIds)
          else game.playCard(id, decision.card.id)
        } else if (observer.phase === GamePhase.TRICK_COMPLETE) game.resolveTrick()
        else if (observer.phase === GamePhase.TALON_REVEAL) game.revealTalon()
        else if (observer.phase === GamePhase.RASPASY_TALON_REVEAL) game.revealNextRaspasyTalonCard()
        else if (observer.phase === GamePhase.SCORING) game.scoreHand()
        else throw new Error(`Stato self-play inatteso: ${observer.phase}`)
      }
      if (guard >= 250) { blockedHands += 1; throw new Error('Mano bloccata') }
      const view = game.getPlayerView('bot-a'), result = game.getLastResult()!
      if (result.kind === 'RASPASY') raspasy += 1
      else {
        const declarer = view.contract!.declarerId
        const success = result.poolAwards[declarer]! > 0
        if (success) successfulContracts += 1; else failedContracts += 1
      }
      for (const id of players.map(player => player.id)) totalTricks[id]! += view.tricksWon[id]!
      const totalPenalty = Object.values(result.penalties).reduce((sum, value) => sum + value, 0)
      const bucket = totalPenalty === 0 ? 'zero_penalty' : totalPenalty <= 4 ? 'penalty_1_4' : totalPenalty <= 10 ? 'penalty_5_10' : 'penalty_11_plus'
      distribution[bucket] = (distribution[bucket] ?? 0) + 1
      hands += 1
    } catch (error) {
      ruleErrors += 1
      throw new Error(`Self-play fallito alla mano ${hands + 1}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { hands, successfulContracts, failedContracts, bids, passes, mizers, vists, polvists, raspasy, totalTricks, ruleErrors, blockedHands, averageDecisionMs: decisions ? decisionMs / decisions : 0, maxDecisionMs, resultDistribution: distribution }
}
