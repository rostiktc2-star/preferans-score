import { describe, expect, it } from 'vitest'
import { createRound, discardHuman, legalCards, playBots, playCard, resolveAuction } from './botGame'

describe('partita contro bot', () => {
  it('distribuisce 10 carte a testa e due nel tallone', () => {
    const r = createRound(42)
    expect(Object.values(r.hands).map(h => h.length)).toEqual([10, 10, 10])
    expect(r.talon).toHaveLength(2)
    expect(new Set([...Object.values(r.hands).flat(), ...r.talon].map(c => c.id)).size).toBe(32)
  })

  it('il dichiarante umano prende il tallone e scarta due carte', () => {
    const a = resolveAuction(createRound(1), 10, 'H')
    expect(a.phase).toBe('discard'); expect(a.hands.you).toHaveLength(12)
    const p = discardHuman(a, a.hands.you.slice(0, 2).map(c => c.id))
    expect(p.phase).toBe('play'); expect(p.hands.you).toHaveLength(10)
  })

  it('impone seme e poi briscola', () => {
    const r = resolveAuction(createRound(8), 10, 'H')
    let p = discardHuman(r, r.hands.you.slice(0, 2).map(c => c.id))
    p = playBots(p)
    if (p.currentPlayerId === 'you' && p.trick.length) {
      const lead = p.trick[0]!.card.suit
      const follows = p.hands.you.filter(c => c.suit === lead)
      if (follows.length) expect(legalCards(p, 'you').every(c => c.suit === lead)).toBe(true)
    }
  })

  it('completa una mano automatizzando i bot', () => {
    let r = resolveAuction(createRound(5), 10, 'S')
    r = discardHuman(r, r.hands.you.slice(0, 2).map(c => c.id))
    let guard = 0
    while (r.phase !== 'done' && guard++ < 100) {
      r = playBots(r)
      if (r.phase === 'play' && r.currentPlayerId === 'you') r = playCard(r, 'you', legalCards(r, 'you')[0]!.id)
    }
    expect(r.phase).toBe('done')
    expect(Object.values(r.tricks).reduce((a, b) => a + b, 0)).toBe(10)
  })
})
