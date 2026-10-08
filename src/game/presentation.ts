import type { GameEventType, VisibleEvent } from './model'

export type AnimationKind =
  | 'DEAL_SEQUENCE' | 'BID_BUBBLE' | 'CARD_TO_CENTER' | 'CAPTURE_TRICK'
  | 'FLIP_TALON' | 'DISCARD_SEQUENCE' | 'HAND_SUMMARY' | 'INFO'

export interface PresentationAnimation {
  readonly id: string
  readonly kind: AnimationKind
  readonly event: VisibleEvent
}

const EVENT_ANIMATION: Partial<Record<GameEventType, AnimationKind>> = {
  CARDS_DEALT: 'DEAL_SEQUENCE',
  BID_MADE: 'BID_BUBBLE',
  PLAYER_PASSED: 'BID_BUBBLE',
  DEFENDER_VIST: 'BID_BUBBLE',
  DEFENDER_PASS: 'BID_BUBBLE',
  POLVIST_DECLARED: 'BID_BUBBLE',
  CONTRACT_WON: 'INFO',
  RASPASY_STARTED: 'INFO',
  CARD_PLAYED: 'CARD_TO_CENTER',
  TRICK_WON: 'CAPTURE_TRICK',
  TALON_CARD_REVEALED: 'FLIP_TALON',
  TALON_REVEALED: 'FLIP_TALON',
  CARDS_DISCARDED: 'DISCARD_SEQUENCE',
  HAND_COMPLETED: 'HAND_SUMMARY',
}

export class AnimationQueue {
  #pending: PresentationAnimation[] = []
  #current?: PresentationAnimation

  enqueue(animation: PresentationAnimation): void { this.#pending.push(animation) }

  startNext(): PresentationAnimation | undefined {
    if (!this.#current) this.#current = this.#pending.shift()
    return this.#current
  }

  completeCurrent(): PresentationAnimation | undefined {
    this.#current = undefined
    return this.startNext()
  }

  skipCurrentAnimation(): PresentationAnimation | undefined { return this.completeCurrent() }

  skipAllAnimations(): void {
    this.#pending = []
    this.#current = undefined
  }

  get current(): PresentationAnimation | undefined { return this.#current }
  get pendingCount(): number { return this.#pending.length }
  get isBusy(): boolean { return Boolean(this.#current || this.#pending.length) }
  snapshot(): readonly PresentationAnimation[] { return this.#current ? [this.#current, ...this.#pending] : [...this.#pending] }
}

export class GamePresentationController {
  readonly queue = new AnimationQueue()
  #lastSequence = 0

  consume(events: readonly VisibleEvent[]): readonly PresentationAnimation[] {
    const added: PresentationAnimation[] = []
    for (const event of events) {
      if (event.sequence <= this.#lastSequence) continue
      this.#lastSequence = event.sequence
      const kind = EVENT_ANIMATION[event.type]
      if (!kind) continue
      const animation = Object.freeze({ id: `animation-${event.sequence}`, kind, event })
      this.queue.enqueue(animation)
      added.push(animation)
    }
    this.queue.startNext()
    return added
  }
}

export type GameSpeed = 'slow' | 'normal' | 'fast'

export const animationDuration = (kind: AnimationKind, speed: GameSpeed, reducedMotion: boolean): number => {
  if (reducedMotion) return kind === 'HAND_SUMMARY' ? 100 : 20
  const base: Record<AnimationKind, number> = {
    DEAL_SEQUENCE: 1500,
    BID_BUBBLE: 650,
    CARD_TO_CENTER: 360,
    CAPTURE_TRICK: 720,
    FLIP_TALON: 1100,
    DISCARD_SEQUENCE: 650,
    HAND_SUMMARY: 350,
    INFO: 700,
  }
  const factor = speed === 'slow' ? 1.35 : speed === 'fast' ? 0.45 : 1
  return Math.round(base[kind] * factor)
}
