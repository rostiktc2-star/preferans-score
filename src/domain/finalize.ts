import { add, compare, fraction, isZero, neg } from './fraction'
import type { CreditChange, FinalPlayerResult, FinalResult, Fraction, GameState, Payment, PlayerId } from './types'

const sum = (values: Fraction[]) => values.reduce(add, fraction())

export const balancedCents = (net: { id: PlayerId; credits: Fraction }[], centsPerCredit: number): Record<PlayerId, number> => {
  const exact = net.map(x => ({ ...x, value: x.credits.n * centsPerCredit / x.credits.d }))
  const result = Object.fromEntries(exact.map(x => [x.id, Math.trunc(x.value)])) as Record<PlayerId, number>
  const missing = -Object.values(result).reduce((a, b) => a + b, 0)
  const ranked = [...exact].sort((a, b) => missing > 0 ? (b.value - Math.trunc(b.value)) - (a.value - Math.trunc(a.value)) || a.id.localeCompare(b.id) : (a.value - Math.trunc(a.value)) - (b.value - Math.trunc(b.value)) || a.id.localeCompare(b.id))
  for (let i = 0; i < Math.abs(missing); i++) result[ranked[i % ranked.length]!.id]! += Math.sign(missing)
  if (Object.values(result).reduce((a, b) => a + b, 0) !== 0) throw new Error('Arrotondamento monetario non bilanciato')
  return result
}

export const settle = (cents: Record<PlayerId, number>): Payment[] => {
  const debtors = Object.entries(cents).filter(([, v]) => v < 0).map(([id, v]) => ({ id, left: -v }))
  const creditors = Object.entries(cents).filter(([, v]) => v > 0).map(([id, v]) => ({ id, left: v }))
  const payments: Payment[] = []; let d = 0; let c = 0
  while (d < debtors.length && c < creditors.length) { const amount = Math.min(debtors[d]!.left, creditors[c]!.left); payments.push({ fromId: debtors[d]!.id, toId: creditors[c]!.id, cents: amount }); debtors[d]!.left -= amount; creditors[c]!.left -= amount; if (!debtors[d]!.left) d++; if (!creditors[c]!.left) c++ }
  if (debtors.some(x => x.left) || creditors.some(x => x.left)) throw new Error('I pagamenti non ricostruiscono i saldi')
  return payments
}

export const finalize = (state: GameState): FinalResult => {
  const ids = state.config.players.map(p => p.id); const minimumPenalty = Math.min(...ids.map(id => state.scores[id]!.penalty)); const penaltyCredits: CreditChange[] = []
  const credits = structuredClone(state.credits)
  for (const penalized of ids) { const residual = state.scores[penalized]!.penalty - minimumPenalty; if (!residual) continue; for (const other of ids.filter(id => id !== penalized)) { const amount = fraction(residual * 10, ids.length - 1); credits[other]![penalized] = add(credits[other]![penalized]!, amount); penaltyCredits.push({ fromId: other, againstId: penalized, amount, reason: 'Calcolo finale della Multa' }) } }
  const raw = ids.map(id => { const owned = sum(ids.filter(x => x !== id).map(x => credits[id]![x]!)); const suffered = sum(ids.filter(x => x !== id).map(x => credits[x]![id]!)); return { id, owned, suffered, net: add(owned, neg(suffered)) } })
  if (!isZero(sum(raw.map(x => x.net)))) throw new Error('I Crediti netti non sommano a zero')
  const cents = balancedCents(raw.map(x => ({ id: x.id, credits: x.net })), state.config.euroCentsPerCredit)
  const players: FinalPlayerResult[] = raw.map(x => ({ playerId: x.id, residualPenalty: state.scores[x.id]!.penalty - minimumPenalty, grossOwned: x.owned, grossSuffered: x.suffered, netCredits: x.net, euroCents: cents[x.id]! })).sort((a, b) => compare(b.netCredits, a.netCredits))
  const payments = settle(cents)
  const reconstructed = Object.fromEntries(ids.map(id => [id, 0])) as Record<PlayerId, number>; payments.forEach(p => { reconstructed[p.fromId]! -= p.cents; reconstructed[p.toId]! += p.cents })
  if (ids.some(id => reconstructed[id] !== cents[id])) throw new Error('Invariante dei pagamenti violata')
  return { minimumPenalty, penaltyCredits, players, payments }
}
