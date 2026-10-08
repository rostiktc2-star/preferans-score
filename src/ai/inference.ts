import { Deck } from '../game/deck'
import type { Card, PlayerId, PlayerView } from '../game/model'
import type { PossibleWorld } from './types'
import { BotMemory } from './memory'
import { BotRandom } from './random'

export class CardInferenceEngine {
  possibleCards(view: PlayerView, memory: BotMemory): Record<PlayerId, Card[]> {
    const unavailable = new Set([...memory.playedCards.keys(), ...view.ownHand.map(card => card.id), ...view.ownDiscards.map(card => card.id), ...Object.values(view.publicHands).flat().map(card => card.id)])
    const unknown = Deck.create().filter(card => !unavailable.has(card.id))
    const revealedTalon = new Set(view.revealedTalon.map(card => card.id))
    return Object.fromEntries(view.playersInOrder.filter(player => player.id !== view.viewerId).map(player => {
      const knownPublic = view.publicHands[player.id]
      if (knownPublic) return [player.id, [...knownPublic]]
      const impossible = memory.inference[player.id]!.impossibleCards
      return [player.id, unknown.filter(card => !impossible.has(card.id) && (!revealedTalon.has(card.id) || player.id === view.contract?.declarerId))]
    }))
  }

  probabilities(view: PlayerView, memory: BotMemory): Record<PlayerId, Record<string, number>> {
    const possible = this.possibleCards(view, memory)
    const opponents = view.playersInOrder.filter(player => player.id !== view.viewerId)
    const result: Record<PlayerId, Record<string, number>> = Object.fromEntries(opponents.map(player => [player.id, {}]))
    for (const card of Deck.create()) {
      const compatible = opponents.filter(player => possible[player.id]?.some(item => item.id === card.id))
      const totalSlots = compatible.reduce((sum, player) => sum + (view.handSizes[player.id] ?? 0), 0)
      for (const player of compatible) result[player.id]![card.id] = totalSlots ? (view.handSizes[player.id] ?? 0) / totalSlots : 0
    }
    return result
  }

  samplePossibleWorld(view: PlayerView, memory: BotMemory, random: BotRandom): PossibleWorld {
    const players = view.playersInOrder.map(player => player.id)
    const hands: Record<PlayerId, Card[]> = Object.fromEntries(players.map(id => [id, id === view.viewerId ? [...view.ownHand] : [...(view.publicHands[id] ?? [])]]))
    const fixed = new Set(Object.values(hands).flat().map(card => card.id))
    for (const card of memory.playedCards.values()) fixed.add(card.id)
    for (const card of view.ownDiscards) fixed.add(card.id)
    let unknown = random.shuffle(Deck.create().filter(card => !fixed.has(card.id)))
    const hiddenPlayers = players.filter(id => id !== view.viewerId && !view.publicHands[id])
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const candidate: Record<PlayerId, Card[]> = Object.fromEntries(players.map(id => [id, [...hands[id]!]]))
      let pool = [...unknown], valid = true
      for (const id of hiddenPlayers.sort((a, b) => memory.inference[b]!.voidSuits.size - memory.inference[a]!.voidSuits.size)) {
        const need = (view.handSizes[id] ?? 0) - candidate[id]!.length
        const revealedTalon = new Set(view.revealedTalon.map(card => card.id))
        const compatible = pool.filter(card => !memory.inference[id]!.voidSuits.has(card.suit) && (!revealedTalon.has(card.id) || id === view.contract?.declarerId))
        if (compatible.length < need) { valid = false; break }
        const chosen = random.shuffle(compatible).slice(0, need)
        candidate[id]!.push(...chosen)
        const chosenIds = new Set(chosen.map(card => card.id)); pool = pool.filter(card => !chosenIds.has(card.id))
      }
      if (valid) return { hands: candidate, unknownDiscards: pool }
      unknown = random.shuffle(unknown)
    }
    throw new Error('Nessun mondo compatibile con le informazioni pubbliche')
  }
}
