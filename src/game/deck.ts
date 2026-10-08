import { Rank, Suit, type Card } from './model'
import type { RandomProvider } from './random'

const SUITS = [Suit.SPADES, Suit.CLUBS, Suit.DIAMONDS, Suit.HEARTS] as const
const RANKS = [Rank.ACE, Rank.KING, Rank.QUEEN, Rank.JACK, Rank.TEN, Rank.NINE, Rank.EIGHT, Rank.SEVEN] as const

export class Deck {
  static create(): readonly Card[] {
    return SUITS.flatMap(suit => RANKS.map(rank => Object.freeze({
      id: `${suit}-${rank}`,
      suit,
      rank,
      numericStrength: rank,
    })))
  }

  static shuffled(random: RandomProvider): Card[] {
    return random.shuffle(Deck.create())
  }
}
