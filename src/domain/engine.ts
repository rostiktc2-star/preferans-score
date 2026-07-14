import { add, compare, fraction } from './fraction'
import type { AmericanAid, CreditChange, DefenderChoice, GameConfig, GameEvent, GameState, ManualAdjustment, PlayerId } from './types'

const VALUES: Record<number, number> = { 6: 2, 7: 4, 8: 6, 9: 8, 10: 10 }
const OBLIGATION: Record<number, number> = { 6: 4, 7: 2, 8: 1, 9: 1, 10: 1 }
const zeroChanges = (ids: PlayerId[]) => Object.fromEntries(ids.map(id => [id, 0]))
const clockwiseAfter = (config: GameConfig, from: PlayerId): PlayerId[] => {
  const ids = config.players.map(p => p.id); const start = ids.indexOf(from)
  return ids.slice(start + 1).concat(ids.slice(0, start + 1))
}
export const activePlayers = (config: GameConfig, restId?: PlayerId): PlayerId[] => config.players.map(p => p.id).filter(id => id !== restId)
export const defenderOrder = (config: GameConfig, active: PlayerId[], declarerId: PlayerId): [PlayerId, PlayerId] => {
  const order = clockwiseAfter(config, declarerId).filter(id => id !== declarerId && active.includes(id))
  if (order.length !== 2) throw new Error('Servono esattamente due difensori attivi')
  return [order[0]!, order[1]!]
}
export const initialState = (config: GameConfig): GameState => {
  if (![3, 4].includes(config.players.length)) throw new Error('La partita richiede 3 o 4 partecipanti')
  if (config.poolTarget <= 0 || !Number.isInteger(config.poolTarget)) throw new Error('L’obiettivo del Pozzo deve essere un intero positivo')
  const ids = config.players.map(p => p.id)
  if (new Set(ids).size !== ids.length || config.players.some(p => !p.name.trim())) throw new Error('I giocatori devono avere nomi e identificativi distinti')
  const credits = Object.fromEntries(ids.map(a => [a, Object.fromEntries(ids.filter(b => b !== a).map(b => [b, fraction()]))]))
  return { config, scores: Object.fromEntries(ids.map(id => [id, { pool: 0, penalty: 0 }])), credits, raspasyLevel: 1, nextRestPlayerId: config.players.length === 4 ? config.firstRestPlayerId : undefined, applied: [], completed: false }
}

const validateTricks = (active: PlayerId[], tricks?: Record<PlayerId, number>) => {
  if (!tricks || active.some(id => !Number.isInteger(tricks[id]) || tricks[id]! < 0 || tricks[id]! > 10) || active.reduce((s, id) => s + tricks[id]!, 0) !== 10) throw new Error('Le prese dei tre giocatori attivi devono sommare esattamente a 10')
}
const addCredit = (state: GameState, changes: CreditChange[], fromId: PlayerId, againstId: PlayerId, amount: number, reason: string) => {
  if (fromId === againstId || !state.credits[fromId]?.[againstId]) throw new Error('Rapporto di Crediti non valido')
  const value = fraction(amount)
  const next = add(state.credits[fromId]![againstId]!, value)
  if (compare(next, fraction()) < 0) throw new Error('Una correzione non può rendere negativi i Crediti lordi')
  state.credits[fromId]![againstId] = next; changes.push({ fromId, againstId, amount: value, reason })
}
const awardPool = (state: GameState, donorId: PlayerId, points: number, poolChanges: Record<PlayerId, number>, penaltyChanges: Record<PlayerId, number>, creditChanges: CreditChange[], aids: AmericanAid[]) => {
  if (!Number.isInteger(points) || points < 0) throw new Error('Incremento del Pozzo non valido')
  const target = state.config.poolTarget; const donor = state.scores[donorId]!
  const own = Math.min(points, Math.max(0, target - donor.pool)); donor.pool += own; poolChanges[donorId]! += own
  let remaining = points - own
  while (remaining > 0) {
    const candidates = state.config.players.map(p => p.id).filter(id => state.scores[id]!.pool < target)
    if (!candidates.length) {
      const reduction = Math.min(remaining, donor.penalty); donor.penalty -= reduction; penaltyChanges[donorId]! -= reduction
      break
    }
    const maxPool = Math.max(...candidates.map(id => state.scores[id]!.pool))
    const tied = new Set(candidates.filter(id => state.scores[id]!.pool === maxPool))
    const recipientId = clockwiseAfter(state.config, donorId).find(id => tied.has(id))!
    const transfer = Math.min(remaining, target - state.scores[recipientId]!.pool)
    state.scores[recipientId]!.pool += transfer; poolChanges[recipientId]! += transfer
    addCredit(state, creditChanges, donorId, recipientId, transfer * 10, 'Aiuto americano')
    aids.push({ donorId, recipientId, poolPoints: transfer, credits: transfer * 10 }); remaining -= transfer
  }
}

const adjust = (state: GameState, a: ManualAdjustment, poolChanges: Record<PlayerId, number>, penaltyChanges: Record<PlayerId, number>, creditChanges: CreditChange[], aids: AmericanAid[]) => {
  if (!Number.isInteger(a.amount) || a.amount === 0) throw new Error('La correzione deve essere un intero diverso da zero')
  if (a.kind === 'pool') {
    if (a.amount > 0) awardPool(state, a.playerId, a.amount, poolChanges, penaltyChanges, creditChanges, aids)
    else { const score = state.scores[a.playerId]!; if (score.pool + a.amount < 0) throw new Error('Il Pozzo non può scendere sotto zero'); score.pool += a.amount; poolChanges[a.playerId]! += a.amount }
  } else if (a.kind === 'penalty') {
    const score = state.scores[a.playerId]!; if (score.penalty + a.amount < 0) throw new Error('La Multa non può scendere sotto zero'); score.penalty += a.amount; penaltyChanges[a.playerId]! += a.amount
  } else addCredit(state, creditChanges, a.fromId, a.againstId, a.amount, 'Correzione manuale')
}

export const applyEvent = (source: GameState, event: GameEvent): GameState => {
  const state: GameState = structuredClone(source); const ids = state.config.players.map(p => p.id)
  const restId = state.config.players.length === 4 && event.type !== 'manual' ? (event.restPlayerId ?? state.nextRestPlayerId) : undefined
  if (state.config.players.length === 4 && event.type !== 'manual' && !ids.includes(restId!)) throw new Error('Seleziona chi riposa')
  const active = event.type === 'manual' ? ids : activePlayers(state.config, restId)
  if (event.type !== 'manual' && active.length !== 3) throw new Error('Ogni mano deve avere esattamente tre giocatori attivi')
  const poolChanges = zeroChanges(ids), penaltyChanges = zeroChanges(ids), creditChanges: CreditChange[] = [], aids: AmericanAid[] = []
  const before = state.raspasyLevel; let summary = ''; let defenders: [PlayerId, PlayerId] | undefined
  const penalty = (id: PlayerId, amount: number) => { state.scores[id]!.penalty += amount; penaltyChanges[id]! += amount }
  if (event.type === 'normal') {
    if (!active.includes(event.declarerId)) throw new Error('Il dichiarante deve essere attivo')
    defenders = defenderOrder(state.config, active, event.declarerId)
    const [first, second] = defenders; const c1 = event.defenderChoices[first]; const c2 = event.defenderChoices[second]
    const allowed: DefenderChoice[] = event.level <= 7 ? ['pass', 'vist', 'polvist'] : ['pass', 'vist']
    if (!allowed.includes(c1!) || !allowed.includes(c2!)) throw new Error('Scelta difensiva non ammessa per questo contratto')
    if (c1 === 'polvist' || (c2 === 'polvist' && c1 !== 'pass')) throw new Error('Il polvist è ammesso solo al secondo difensore dopo il pass del primo')
    const value = VALUES[event.level]!; const unplayed = c1 === 'pass' && c2 === 'pass'
    if (unplayed) { awardPool(state, event.declarerId, value, poolChanges, penaltyChanges, creditChanges, aids); summary = `Contratto ${event.level} con entrambi passanti` }
    else {
      validateTricks(active, event.tricks); const tricks = event.tricks!; const declarerTricks = tricks[event.declarerId]!
      if (declarerTricks >= event.level) awardPool(state, event.declarerId, value, poolChanges, penaltyChanges, creditChanges, aids)
      else penalty(event.declarerId, (event.level - declarerTricks) * value)
      const defenseTotal = tricks[first]! + tricks[second]!
      if (c2 === 'polvist') {
        const quota = event.level === 6 ? 2 : 1; addCredit(state, creditChanges, second, event.declarerId, Math.min(defenseTotal, quota) * value, 'polvist')
        penalty(second, Math.max(0, quota - defenseTotal) * value)
      } else {
        const vistas = defenders.filter(id => event.defenderChoices[id] === 'vist')
        if (vistas.length === 1) { const v = vistas[0]!; addCredit(state, creditChanges, v, event.declarerId, defenseTotal * value, 'Prese della difesa'); penalty(v, Math.max(0, OBLIGATION[event.level]! - defenseTotal) * value) }
        else if (vistas.length === 2) {
          for (const d of defenders) addCredit(state, creditChanges, d, event.declarerId, tricks[d]! * value, 'Prese personali')
          if (event.level <= 7) defenders.forEach(d => penalty(d, Math.max(0, (event.level === 6 ? 2 : 1) - tricks[d]!) * value))
          else penalty(second, Math.max(0, 1 - tricks[second]!) * value)
        }
      }
      state.raspasyLevel = 1; summary = `Contratto ${event.level} ${event.suit}: ${declarerTricks} prese al dichiarante`
    }
  } else if (event.type === 'mizer') {
    if (!active.includes(event.declarerId) || !Number.isInteger(event.declarerTricks) || event.declarerTricks < 0 || event.declarerTricks > 10) throw new Error('Prese del mizer non valide')
    if (event.tricks) validateTricks(active, event.tricks)
    if (event.declarerTricks === 0) awardPool(state, event.declarerId, 10, poolChanges, penaltyChanges, creditChanges, aids); else penalty(event.declarerId, event.declarerTricks * 10)
    state.raspasyLevel = 1; summary = `Mizer: ${event.declarerTricks} prese`
  } else if (event.type === 'raspasy') {
    validateTricks(active, event.tricks); const min = Math.min(...active.map(id => event.tricks[id]!)); const value = before
    active.forEach(id => { penalty(id, (event.tricks[id]! - min) * value); if (event.tricks[id] === 0) awardPool(state, id, 1, poolChanges, penaltyChanges, creditChanges, aids) })
    state.raspasyLevel = Math.min(3, before + 1) as 1 | 2 | 3; summary = `Raspasy livello ${value}, minimo ${min} prese`
  } else {
    event.adjustments.forEach(a => adjust(state, a, poolChanges, penaltyChanges, creditChanges, aids)); if (event.raspasyLevel) state.raspasyLevel = event.raspasyLevel
    summary = event.note?.trim() || 'Correzione manuale'
  }
  let nextRest = state.nextRestPlayerId
  if (state.config.players.length === 4 && event.type !== 'manual') { const order = clockwiseAfter(state.config, restId!); nextRest = order[0]; state.nextRestPlayerId = nextRest }
  state.completed = ids.every(id => state.scores[id]!.pool === state.config.poolTarget)
  const handNumber = state.applied.filter(a => a.event.type !== 'manual').length + (event.type === 'manual' ? 0 : 1)
  state.applied.push({ event, handNumber, activeIds: active, restPlayerId: restId, defenderOrder: defenders, raspasyBefore: before, raspasyAfter: state.raspasyLevel, poolChanges, penaltyChanges, creditChanges, aids, summary, nextRestPlayerId: nextRest })
  return state
}

export const replay = (config: GameConfig, events: GameEvent[]): GameState => events.reduce(applyEvent, initialState(config))
