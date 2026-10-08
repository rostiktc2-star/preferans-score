import { Deck } from '../game/deck'
import type { Card, PlayerId, PlayerView, Suit } from '../game/model'

export interface PlayerInference {
  readonly voidSuits: Set<Suit>
  readonly knownCards: Map<string, Card>
  readonly impossibleCards: Set<string>
  possibleTrumpCount: { min: number; max: number }
}

export class BotMemory {
  handNumber = 0
  readonly seenCards = new Map<string, Card>()
  readonly playedCards = new Map<string, Card>()
  readonly inference: Record<PlayerId, PlayerInference> = {}
  processedTricks = 0
  auctionLength = 0

  reset(view: PlayerView): void {
    this.handNumber = view.handNumber
    this.seenCards.clear(); this.playedCards.clear(); this.processedTricks = 0; this.auctionLength = 0
    for (const player of view.playersInOrder) this.inference[player.id] = { voidSuits: new Set(), knownCards: new Map(), impossibleCards: new Set(), possibleTrumpCount: { min: 0, max: view.handSizes[player.id] ?? 10 } }
  }

  update(view: PlayerView): void {
    if (this.handNumber !== view.handNumber) this.reset(view)
    for (const card of view.ownHand) this.rememberKnown(view.viewerId, card)
    for (const [playerId, cards] of Object.entries(view.publicHands)) for (const card of cards) this.rememberKnown(playerId, card)
    for (const card of view.revealedTalon) this.seenCards.set(card.id, card)
    for (const card of view.ownDiscards) this.seenCards.set(card.id, card)
    const tricks = [...view.completedTricks, ...(view.currentTrick ? [view.currentTrick] : [])]
    for (const trick of tricks) {
      const lead = trick.cards[0]?.card.suit ?? trick.forcedLeadSuit
      if (!lead) continue
      for (const play of trick.cards) {
        this.seenCards.set(play.card.id, play.card); this.playedCards.set(play.card.id, play.card)
        if (play.card.suit !== lead) {
          this.inference[play.playerId]!.voidSuits.add(lead)
          if (view.contract?.trump && view.contract.trump !== 'NT' && play.card.suit !== view.contract.trump) this.inference[play.playerId]!.voidSuits.add(view.contract.trump)
        }
      }
    }
    const trump = view.contract?.trump
    if (trump && trump !== 'NT') for (const player of view.playersInOrder) {
      const info = this.inference[player.id]!
      info.possibleTrumpCount.max = info.voidSuits.has(trump) ? 0 : view.handSizes[player.id] ?? 0
      info.possibleTrumpCount.min = [...info.knownCards.values()].filter(card => card.suit === trump).length
    }
    const remaining = Deck.create().filter(card => !this.seenCards.has(card.id))
    for (const player of view.playersInOrder) {
      const info = this.inference[player.id]!
      info.impossibleCards.clear()
      for (const card of remaining) if (info.voidSuits.has(card.suit)) info.impossibleCards.add(card.id)
    }
    this.processedTricks = view.completedTricks.length
    this.auctionLength = view.auction.length
  }

  private rememberKnown(playerId: PlayerId, card: Card): void {
    this.seenCards.set(card.id, card)
    this.inference[playerId]!.knownCards.set(card.id, card)
  }
}
