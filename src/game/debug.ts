import { GameEngine } from './engine'
import { ContractKind, DefenderDecision, GamePhase, Suit, type GameConfig, type PlayerView } from './model'

export interface HeadlessHandReport {
  readonly finalViews: readonly PlayerView[]
  readonly eventCount: number
}

/** Minimal deterministic driver for development and CI; it never reads hidden state. */
export function runHeadlessDemo(seed: number | string = 1): HeadlessHandReport {
  const config: GameConfig = {
    players: [{ id: 'player-1', name: 'Player 1' }, { id: 'bot-1', name: 'Bot 1' }, { id: 'bot-2', name: 'Bot 2' }],
    seed,
    firstPlayerId: 'player-1',
    poolTarget: 100,
  }
  const game = new GameEngine(config)
  game.startGame()
  game.makeBid('player-1', { kind: ContractKind.NORMAL, level: 6, trump: Suit.SPADES })
  game.makeBid('bot-1', 'PASS')
  game.makeBid('bot-2', 'PASS')
  game.makeDefenderDecision('bot-1', DefenderDecision.VIST)
  game.makeDefenderDecision('bot-2', DefenderDecision.PASS)
  while (game.phase !== GamePhase.HAND_COMPLETE && game.phase !== GamePhase.GAME_COMPLETE) {
    if ([GamePhase.PLAYING_FIRST_TRICK, GamePhase.PLAYING, GamePhase.RASPASY_PLAYING].includes(game.phase)) {
      const observer = game.getPlayerView('player-1')
      const current = observer.currentPlayerId!
      const move = game.getPlayerView(current).legalMoves[0]!
      game.playCard(current, move.id)
    } else if (game.phase === GamePhase.TRICK_COMPLETE) game.resolveTrick()
    else if (game.phase === GamePhase.TALON_REVEAL) game.revealTalon()
    else if (game.phase === GamePhase.DECLARER_DISCARD) {
      const recipient = game.getPlayerView('player-1').currentPlayerId!
      const hand = game.getPlayerView(recipient).ownHand
      game.discard(recipient, [hand[0]!.id, hand[1]!.id])
    } else if (game.phase === GamePhase.RASPASY_TALON_REVEAL) game.revealNextRaspasyTalonCard()
    else if (game.phase === GamePhase.SCORING) game.scoreHand()
    else throw new Error(`Stato headless inatteso: ${game.phase}`)
  }
  const finalViews = config.players.map(player => game.getPlayerView(player.id))
  return { finalViews, eventCount: finalViews[0]!.events.length }
}
