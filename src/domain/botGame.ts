import type { DefenderChoice, GameEvent, Suit } from './types'

export type CardSuit = 'S' | 'C' | 'D' | 'H'
export type Rank = 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14
export interface Card { id: string; suit: CardSuit; rank: Rank }
export interface Contract { declarerId: string; level: 6 | 7 | 8 | 9 | 10; trump: CardSuit | 'NT' }
export interface PlayedCard { playerId: string; card: Card }
export type BotPhase = 'auction' | 'discard' | 'play' | 'done'

export interface BotRound {
  seed: number
  dealer: number
  phase: BotPhase
  hands: Record<string, Card[]>
  talon: Card[]
  contract?: Contract
  botBids: Record<string, number>
  currentPlayerId: string
  leaderId: string
  trick: PlayedCard[]
  tricks: Record<string, number>
  lastTrick?: { cards: PlayedCard[]; winnerId: string }
  message: string
}

export const BOT_IDS = ['you', 'vera', 'nikolaj'] as const
export const SUIT_SYMBOL: Record<CardSuit, string> = { S: '♠', C: '♣', D: '♦', H: '♥' }
export const SUIT_NAME: Record<CardSuit | 'NT', Suit> = { S: 'picche', C: 'fiori', D: 'quadri', H: 'cuori', NT: 'senza briscola' }
export const RANK_LABEL: Record<Rank, string> = { 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }

const nextId = (id: string) => BOT_IDS[(BOT_IDS.indexOf(id as typeof BOT_IDS[number]) + 1) % 3]!
const rng = (seed: number) => { let a = seed >>> 0; return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
const sortCards = (cards: Card[]) => [...cards].sort((a, b) => ['S', 'C', 'D', 'H'].indexOf(a.suit) - ['S', 'C', 'D', 'H'].indexOf(b.suit) || a.rank - b.rank)

export function createRound(seed = Date.now(), dealer = 0): BotRound {
  const deck: Card[] = (['S', 'C', 'D', 'H'] as CardSuit[]).flatMap(suit => ([7, 8, 9, 10, 11, 12, 13, 14] as Rank[]).map(rank => ({ id: `${suit}${rank}`, suit, rank })))
  const random = rng(seed); for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [deck[i], deck[j]] = [deck[j]!, deck[i]!] }
  const first = BOT_IDS[(dealer + 1) % 3]!
  const hands: Record<string, Card[]> = Object.fromEntries(BOT_IDS.map(id => [id, []]))
  for (let i = 0; i < 30; i++) hands[BOT_IDS[(dealer + 1 + i) % 3]!]!.push(deck[i]!)
  BOT_IDS.forEach(id => { hands[id] = sortCards(hands[id]!) })
  const strength = (cards: Card[]) => cards.reduce((n, c) => n + Math.max(0, c.rank - 10), 0) + Math.max(...(['S', 'C', 'D', 'H'] as CardSuit[]).map(s => Math.max(0, cards.filter(c => c.suit === s).length - 2)))
  const bid = (id: string) => { const n = strength(hands[id]!); return n >= 18 ? 7 : n >= 13 ? 6 : 0 }
  return { seed, dealer, phase: 'auction', hands, talon: deck.slice(30), botBids: { vera: bid('vera'), nikolaj: bid('nikolaj') }, currentPlayerId: first, leaderId: first, trick: [], tricks: { you: 0, vera: 0, nikolaj: 0 }, message: 'Scegli il tuo contratto oppure passa.' }
}

const bestTrump = (cards: Card[]): CardSuit => (['S', 'C', 'D', 'H'] as CardSuit[]).sort((a, b) => {
  const score = (s: CardSuit) => cards.filter(c => c.suit === s).reduce((n, c) => n + 1 + Math.max(0, c.rank - 11), 0)
  return score(b) - score(a)
})[0]!
const discardWeakest = (cards: Card[], count: number) => [...cards].sort((a, b) => a.rank - b.rank || a.suit.localeCompare(b.suit)).slice(0, count)

export function resolveAuction(round: BotRound, humanLevel: 0 | 6 | 7 | 8 | 9 | 10, humanTrump: CardSuit | 'NT'): BotRound {
  if (round.phase !== 'auction') return round
  const candidates = [{ id: 'you', level: humanLevel }, { id: 'vera', level: round.botBids.vera ?? 0 }, { id: 'nikolaj', level: round.botBids.nikolaj ?? 0 }]
  const max = Math.max(...candidates.map(c => c.level))
  if (max === 0) return { ...round, phase: 'play', contract: undefined, currentPlayerId: round.leaderId, message: 'Tutti passano: si gioca il raspasy. Evita le prese.' }
  const winner = candidates.find(c => c.level === max)!
  const trump = winner.id === 'you' ? humanTrump : bestTrump([...round.hands[winner.id]!, ...round.talon])
  const contract: Contract = { declarerId: winner.id, level: winner.level as Contract['level'], trump }
  const hands = structuredClone(round.hands)
  hands[winner.id] = sortCards([...hands[winner.id]!, ...round.talon])
  if (winner.id === 'you') return { ...round, hands, contract, phase: 'discard', currentPlayerId: 'you', message: 'Hai vinto l’asta. Scarta due carte dal tallone.' }
  const discarded = discardWeakest(hands[winner.id]!, 2); hands[winner.id] = hands[winner.id]!.filter(c => !discarded.some(d => d.id === c.id))
  return { ...round, hands, talon: discarded, contract, phase: 'play', currentPlayerId: round.leaderId, message: `${winner.id === 'vera' ? 'Vera' : 'Nikolaj'} gioca ${winner.level} ${SUIT_NAME[trump]}.` }
}

export function discardHuman(round: BotRound, cardIds: string[]): BotRound {
  if (round.phase !== 'discard' || cardIds.length !== 2 || new Set(cardIds).size !== 2) return round
  const cards = round.hands.you!.filter(c => cardIds.includes(c.id)); if (cards.length !== 2) return round
  return { ...round, phase: 'play', hands: { ...round.hands, you: round.hands.you!.filter(c => !cardIds.includes(c.id)) }, talon: cards, currentPlayerId: round.leaderId, message: 'Contratto iniziato. Tocca una carta valida per giocarla.' }
}

export function legalCards(round: BotRound, playerId: string): Card[] {
  const hand = round.hands[playerId] ?? []; if (!round.trick.length) return hand
  const lead = round.trick[0]!.card.suit; const follow = hand.filter(c => c.suit === lead); if (follow.length) return follow
  if (round.contract?.trump && round.contract.trump !== 'NT') { const trumps = hand.filter(c => c.suit === round.contract!.trump); if (trumps.length) return trumps }
  return hand
}

function winnerOf(cards: PlayedCard[], trump?: CardSuit | 'NT'): string {
  const lead = cards[0]!.card.suit
  return cards.reduce((best, current) => {
    const b = best.card, c = current.card
    const bTrump = trump !== undefined && trump !== 'NT' && b.suit === trump, cTrump = trump !== undefined && trump !== 'NT' && c.suit === trump
    if (cTrump !== bTrump) return cTrump ? current : best
    if (c.suit === b.suit && c.rank > b.rank) return current
    if (b.suit !== lead && c.suit === lead) return current
    return best
  }).playerId
}

export function playCard(round: BotRound, playerId: string, cardId: string): BotRound {
  if (round.phase !== 'play' || round.currentPlayerId !== playerId) return round
  const card = legalCards(round, playerId).find(c => c.id === cardId); if (!card) return { ...round, message: 'Devi rispondere al seme; se non puoi, usa la briscola.' }
  const hands = { ...round.hands, [playerId]: round.hands[playerId]!.filter(c => c.id !== cardId) }
  const trick = [...round.trick, { playerId, card }]
  if (trick.length < 3) return { ...round, hands, trick, currentPlayerId: nextId(playerId), message: '' }
  const winnerId = winnerOf(trick, round.contract?.trump); const tricks = { ...round.tricks, [winnerId]: round.tricks[winnerId]! + 1 }
  const done = Object.values(hands).every(hand => hand.length === 0)
  return { ...round, hands, trick: [], tricks, lastTrick: { cards: trick, winnerId }, currentPlayerId: winnerId, leaderId: winnerId, phase: done ? 'done' : 'play', message: done ? 'Mano conclusa.' : `${winnerId === 'you' ? 'Hai' : winnerId === 'vera' ? 'Vera ha' : 'Nikolaj ha'} preso la mano.` }
}

export function chooseBotCard(round: BotRound, playerId: string): Card {
  const legal = legalCards(round, playerId); const declarer = round.contract?.declarerId === playerId
  const sorted = [...legal].sort((a, b) => a.rank - b.rank)
  if (!round.contract) return sorted[0]!
  if (declarer) return sorted.at(-1)!
  if (round.trick.length) {
    const winning = sorted.filter(card => winnerOf([...round.trick, { playerId, card }], round.contract?.trump) === playerId)
    if (winning.length) return winning[0]!
  }
  return sorted[0]!
}

export function playBots(round: BotRound): BotRound {
  let next = round; let guard = 0
  while (next.phase === 'play' && next.currentPlayerId !== 'you' && guard++ < 30) next = playCard(next, next.currentPlayerId, chooseBotCard(next, next.currentPlayerId).id)
  return next
}

export function roundEvent(round: BotRound): GameEvent {
  const base = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), note: 'Giocata contro i bot' }
  if (!round.contract) return { ...base, type: 'raspasy', tricks: round.tricks }
  const defenders = BOT_IDS.filter(id => id !== round.contract!.declarerId)
  const defenderChoices = Object.fromEntries(defenders.map(id => [id, 'vist'])) as Record<string, DefenderChoice>
  return { ...base, type: 'normal', declarerId: round.contract.declarerId, level: round.contract.level, suit: SUIT_NAME[round.contract.trump], defenderChoices, tricks: round.tricks }
}
