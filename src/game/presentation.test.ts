import { describe, expect, it } from 'vitest'
import { AnimationQueue, ContractKind, GameEngine, GamePresentationController, Suit, animationDuration, runTwentyHandSoak, type PresentationAnimation, type VisibleEvent } from './index'

const event = (sequence: number, type: VisibleEvent['type']): VisibleEvent => ({ sequence, type, handNumber: 1, data: {} })

describe('presentazione event-driven', () => {
  it('traduce gli eventi pubblici in animazioni e mantiene l’ordine', () => {
    const controller = new GamePresentationController()
    controller.consume([event(1, 'CARDS_DEALT'), event(2, 'CARD_PLAYED'), event(3, 'TRICK_WON'), event(4, 'TALON_REVEALED')])
    expect(controller.queue.snapshot().map(item => item.kind)).toEqual(['DEAL_SEQUENCE', 'CARD_TO_CENTER', 'CAPTURE_TRICK', 'FLIP_TALON'])
    controller.queue.completeCurrent()
    expect(controller.queue.current?.kind).toBe('CARD_TO_CENTER')
  })

  it('supporta skip corrente, skip totale e reduced motion', () => {
    const queue = new AnimationQueue()
    const animations: PresentationAnimation[] = [1, 2].map(sequence => ({ id: String(sequence), kind: 'INFO', event: event(sequence, 'CONTRACT_WON') }))
    animations.forEach(item => queue.enqueue(item)); queue.startNext(); queue.skipCurrentAnimation()
    expect(queue.current?.id).toBe('2')
    queue.skipAllAnimations(); expect(queue.isBusy).toBe(false)
    expect(animationDuration('DEAL_SEQUENCE', 'slow', true)).toBe(20)
    expect(animationDuration('DEAL_SEQUENCE', 'fast', false)).toBeLessThan(animationDuration('DEAL_SEQUENCE', 'normal', false))
  })

  it('espone alla UI solo dichiarazioni realmente legali', () => {
    const players = [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }, { id: 'C', name: 'C' }] as const
    const game = new GameEngine({ players, seed: 4, firstPlayerId: 'A' }); game.startGame()
    expect(game.getPlayerView('A').legalAuctionActions.some(action => action !== 'PASS' && action.kind === ContractKind.MIZER)).toBe(true)
    game.makeBid('A', { kind: ContractKind.NORMAL, level: 8, trump: 'NT' }); game.makeBid('B', { kind: ContractKind.MIZER }); game.makeBid('C', 'PASS')
    expect(game.getPlayerView('A').legalAuctionActions.some(action => action !== 'PASS' && action.kind === ContractKind.MIZER)).toBe(false)
    expect(game.getPlayerView('A').legalAuctionActions.some(action => action !== 'PASS' && action.kind === ContractKind.NORMAL && action.level === 9 && action.trump === Suit.SPADES)).toBe(true)
  })

  it('completa 20 mani consecutive con bot limitati alle PlayerView', () => {
    const report = runTwentyHandSoak()
    expect(report).toMatchObject({ completedHands: 20, finalHandNumber: 20 })
    expect(report.commands).toBeGreaterThan(600)
  })
})
