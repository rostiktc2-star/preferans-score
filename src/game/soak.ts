import { GameEngine } from './engine'
import { ContractKind, DefenderDecision, GamePhase, Suit, type Bid, type GameConfig } from './model'

export interface SoakReport { readonly completedHands: number; readonly commands: number; readonly finalHandNumber: number }

/** Runs UI-style temporary bots: every decision is derived from that player's PlayerView. */
export function runTwentyHandSoak(count = 20, seed: number | string = 'phase-2-soak'): SoakReport {
  const config: GameConfig = { players: [{ id: 'human', name: 'Human' }, { id: 'bot-a', name: 'Bot A' }, { id: 'bot-b', name: 'Bot B' }], seed, firstPlayerId: 'human', poolTarget: 10_000 }
  const game = new GameEngine(config)
  game.startGame()
  let completedHands = 0, commands = 0, guard = 0
  while (completedHands < count && guard++ < count * 500) {
    const observer = game.getPlayerView('human')
    const mode = (observer.handNumber - 1) % 6
    if (observer.phase === GamePhase.BIDDING) {
      const playerId = observer.currentPlayerId!
      const playerView = game.getPlayerView(playerId)
      const nobodyBid = playerView.auction.every(record => record.action === 'PASS')
      let action: Bid | 'PASS' = 'PASS'
      if (nobodyBid && playerView.auction.length === 0 && mode !== 0) {
        action = mode === 1
          ? playerView.legalAuctionActions.find((item): item is Bid => item !== 'PASS' && item.kind === ContractKind.MIZER)!
          : playerView.legalAuctionActions.find((item): item is Bid => item !== 'PASS' && item.kind === ContractKind.NORMAL && item.level === 6 && item.trump === Suit.SPADES)!
      }
      game.makeBid(playerId, action)
    } else if (observer.phase === GamePhase.DEFENDER_DECISIONS) {
      const playerId = observer.currentPlayerId!
      const options = game.getPlayerView(playerId).legalDefenderDecisions
      const made = Object.keys(observer.defenderDecisions).length
      const choice = mode === 2 ? DefenderDecision.PASS
        : mode === 3 ? (made === 0 ? DefenderDecision.PASS : options.includes(DefenderDecision.POLVIST) ? DefenderDecision.POLVIST : DefenderDecision.VIST)
          : mode === 4 ? DefenderDecision.VIST
            : made === 0 ? DefenderDecision.VIST : DefenderDecision.PASS
      game.makeDefenderDecision(playerId, choice)
    } else if ([GamePhase.PLAYING_FIRST_TRICK, GamePhase.PLAYING, GamePhase.RASPASY_PLAYING].includes(observer.phase)) {
      const playerId = observer.currentPlayerId!
      const playerView = game.getPlayerView(playerId)
      game.playCard(playerId, playerView.legalMoves[0]!.id)
    } else if (observer.phase === GamePhase.TRICK_COMPLETE) game.resolveTrick()
    else if (observer.phase === GamePhase.TALON_REVEAL) game.revealTalon()
    else if (observer.phase === GamePhase.DECLARER_DISCARD) {
      const playerId = observer.currentPlayerId!
      const hand = game.getPlayerView(playerId).ownHand
      game.discard(playerId, [hand[0]!.id, hand[1]!.id])
    } else if (observer.phase === GamePhase.RASPASY_TALON_REVEAL) game.revealNextRaspasyTalonCard()
    else if (observer.phase === GamePhase.SCORING) game.scoreHand()
    else if (observer.phase === GamePhase.HAND_COMPLETE) { completedHands += 1; if (completedHands < count) game.nextHand() }
    else throw new Error(`Soak bloccato nello stato ${observer.phase}`)
    commands += 1
  }
  if (completedHands !== count) throw new Error(`Soak incompleto: ${completedHands}/${count}`)
  return { completedHands, commands, finalHandNumber: game.handNumber }
}
