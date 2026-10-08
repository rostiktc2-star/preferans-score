import {
  ContractKind,
  DefenderDecision,
  Suit,
  type AuctionAction,
  type AuctionRecord,
  type Bid,
  type Card,
  type Contract,
  type PlayerId,
  type PlayedCard,
  type Trick,
  type Trump,
} from './model'

const SUIT_ORDER: readonly Trump[] = [Suit.SPADES, Suit.CLUBS, Suit.DIAMONDS, Suit.HEARTS, 'NT']
const CONTRACT_VALUES = { 6: 2, 7: 4, 8: 6, 9: 8, 10: 10 } as const

export class RuleViolation extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuleViolation'
  }
}

export class RuleEngine {
  static allBids(): readonly Bid[] {
    const normal = ([6, 7, 8, 9, 10] as const).flatMap(level => SUIT_ORDER.map(trump => ({ kind: ContractKind.NORMAL, level, trump }) as const))
    return [...normal.slice(0, 15), { kind: ContractKind.MIZER } as const, ...normal.slice(15)]
  }

  static bidOrder(bid: Bid): number {
    if (bid.kind === ContractKind.MIZER) return 15
    const base = (bid.level - 6) * 5
    const normalIndex = base + SUIT_ORDER.indexOf(bid.trump)
    return bid.level >= 9 ? normalIndex + 1 : normalIndex
  }

  static validateAuctionAction(input: {
    playerId: PlayerId
    action: AuctionAction
    currentPlayerId: PlayerId
    history: readonly AuctionRecord[]
    passedPlayers: ReadonlySet<PlayerId>
    highestBid?: Bid
  }): void {
    const { playerId, action, currentPlayerId, history, passedPlayers, highestBid } = input
    if (playerId !== currentPlayerId) throw new RuleViolation('Non è il turno di questo giocatore nell’asta')
    if (passedPlayers.has(playerId)) throw new RuleViolation('Un giocatore che passa non può rientrare nell’asta')
    if (action === 'PASS') return
    const personalActions = history.filter(record => record.playerId === playerId)
    if (action.kind === ContractKind.MIZER && personalActions.length > 0) {
      throw new RuleViolation('Il Mizer è valido solo come prima dichiarazione personale')
    }
    if (highestBid && RuleEngine.bidOrder(action) <= RuleEngine.bidOrder(highestBid)) {
      throw new RuleViolation('La dichiarazione deve superare il contratto corrente')
    }
  }

  static contractFromBid(declarerId: PlayerId, bid: Bid): Contract {
    if (bid.kind === ContractKind.MIZER) {
      return Object.freeze({ kind: ContractKind.MIZER, declarerId, trump: 'NT', requiredTricks: 0, value: 10 })
    }
    return Object.freeze({
      kind: ContractKind.NORMAL,
      declarerId,
      level: bid.level,
      trump: bid.trump,
      requiredTricks: bid.level,
      value: CONTRACT_VALUES[bid.level],
    })
  }

  static validateDefenderDecision(input: {
    decision: DefenderDecision
    defenderIndex: number
    contract: Contract
    decisions: Readonly<Record<PlayerId, DefenderDecision>>
    defenderOrder: readonly [PlayerId, PlayerId]
  }): void {
    const { decision, defenderIndex, contract, decisions, defenderOrder } = input
    if (contract.kind !== ContractKind.NORMAL) throw new RuleViolation('Il Mizer non prevede decisioni difensive')
    if (decision === DefenderDecision.POLVIST) {
      if (defenderIndex !== 1 || (contract.level !== 6 && contract.level !== 7) || decisions[defenderOrder[0]] !== DefenderDecision.PASS) {
        throw new RuleViolation('Il Polvist è ammesso solo al secondo difensore dopo un Pass, sui contratti 6 o 7')
      }
    }
  }

  static getLegalMoves(hand: readonly Card[], trick: Trick | undefined, trump: Trump): readonly Card[] {
    if (hand.length === 0) return []
    const leadSuit = trick?.cards[0]?.card.suit ?? trick?.forcedLeadSuit
    if (!leadSuit) return [...hand]
    const following = hand.filter(card => card.suit === leadSuit)
    if (following.length > 0) return following
    if (trump !== 'NT') {
      const trumps = hand.filter(card => card.suit === trump)
      if (trumps.length > 0) return trumps
    }
    return [...hand]
  }

  static validateCardPlay(hand: readonly Card[], trick: Trick, trump: Trump, cardId: string): Card {
    const owned = hand.find(card => card.id === cardId)
    if (!owned) throw new RuleViolation('La carta non appartiene al giocatore')
    const legal = RuleEngine.getLegalMoves(hand, trick, trump)
    if (!legal.some(card => card.id === cardId)) throw new RuleViolation('La carta non rispetta seme o briscola obbligatori')
    return owned
  }

  static trickWinner(cards: readonly PlayedCard[], trump: Trump): PlayerId {
    if (cards.length !== 3) throw new RuleViolation('Una presa richiede esattamente tre carte dei giocatori')
    const leadSuit = cards[0]!.card.suit
    const eligibleSuit = trump !== 'NT' && cards.some(play => play.card.suit === trump) ? trump : leadSuit
    return cards
      .filter(play => play.card.suit === eligibleSuit)
      .reduce((best, play) => play.card.numericStrength > best.card.numericStrength ? play : best)
      .playerId
  }
}
