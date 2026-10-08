import type { Card } from './model'

export class Hand {
  #cards: Card[]

  constructor(cards: readonly Card[] = []) {
    this.#cards = [...cards]
  }

  get size(): number { return this.#cards.length }

  cards(): readonly Card[] { return [...this.#cards] }

  add(cards: readonly Card[]): void { this.#cards.push(...cards) }

  find(cardId: string): Card | undefined { return this.#cards.find(card => card.id === cardId) }

  remove(cardId: string): Card {
    const index = this.#cards.findIndex(card => card.id === cardId)
    if (index < 0) throw new Error('Carta non presente nella mano')
    return this.#cards.splice(index, 1)[0]!
  }

  removeMany(cardIds: readonly string[]): Card[] {
    if (new Set(cardIds).size !== cardIds.length) throw new Error('Le carte devono essere distinte')
    const cards = cardIds.map(id => this.find(id))
    if (cards.some(card => !card)) throw new Error('Carta non presente nella mano')
    for (const id of cardIds) this.remove(id)
    return cards as Card[]
  }
}
