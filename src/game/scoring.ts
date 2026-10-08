import {
  ContractKind,
  DefenderDecision,
  type Contract,
  type HandResult,
  type PlayerId,
  type PoolAwardContext,
  type PoolAwardOutcome,
  type PoolAwardPolicy,
} from './model'

type MutableMatrix = Record<PlayerId, Record<PlayerId, number>>

function zeros(players: readonly PlayerId[]): Record<PlayerId, number> {
  return Object.fromEntries(players.map(id => [id, 0]))
}

function creditMatrix(players: readonly PlayerId[]): MutableMatrix {
  return Object.fromEntries(players.map(from => [from, Object.fromEntries(players.filter(to => to !== from).map(to => [to, 0]))]))
}

export interface NormalScoreInput {
  readonly players: readonly PlayerId[]
  readonly contract: Contract
  readonly defenderOrder: readonly [PlayerId, PlayerId]
  readonly decisions: Readonly<Record<PlayerId, DefenderDecision>>
  readonly tricks: Readonly<Record<PlayerId, number>>
}

export interface MizerScoreInput {
  readonly players: readonly PlayerId[]
  readonly contract: Contract
  readonly tricks: Readonly<Record<PlayerId, number>>
}

export interface RaspasyScoreInput {
  readonly players: readonly PlayerId[]
  readonly tricks: Readonly<Record<PlayerId, number>>
  readonly value: 1 | 2 | 3
}

export class ScoringEngine {
  static normal(input: NormalScoreInput): HandResult {
    const { players, contract, defenderOrder, decisions, tricks } = input
    if (contract.kind !== ContractKind.NORMAL || contract.level === undefined) throw new Error('Contratto normale richiesto')
    const poolAwards = zeros(players)
    const penalties = zeros(players)
    const credits = creditMatrix(players)
    const declarerTricks = tricks[contract.declarerId] ?? 0
    const [first, second] = defenderOrder
    const firstChoice = decisions[first]
    const secondChoice = decisions[second]
    if (firstChoice === DefenderDecision.PASS && secondChoice === DefenderDecision.PASS) {
      poolAwards[contract.declarerId] = contract.value
      return { kind: 'NORMAL', poolAwards, penalties, credits, tricks: { ...tricks } }
    }
    if (declarerTricks >= contract.level) poolAwards[contract.declarerId] = contract.value
    else penalties[contract.declarerId] = (contract.level - declarerTricks) * contract.value
    const defenseTotal = (tricks[first] ?? 0) + (tricks[second] ?? 0)
    if (secondChoice === DefenderDecision.POLVIST) {
      const quota = contract.level === 6 ? 2 : 1
      credits[second]![contract.declarerId] = Math.min(defenseTotal, quota) * contract.value
      penalties[second] = Math.max(0, quota - defenseTotal) * contract.value
      return { kind: 'NORMAL', poolAwards, penalties, credits, tricks: { ...tricks } }
    }
    const visters = defenderOrder.filter(id => decisions[id] === DefenderDecision.VIST)
    if (visters.length === 1) {
      const vister = visters[0]!
      const obligation = contract.level === 6 ? 4 : contract.level === 7 ? 2 : 1
      credits[vister]![contract.declarerId] = defenseTotal * contract.value
      penalties[vister] = Math.max(0, obligation - defenseTotal) * contract.value
    } else if (visters.length === 2) {
      for (const defender of defenderOrder) credits[defender]![contract.declarerId] = (tricks[defender] ?? 0) * contract.value
      if (contract.level === 6 || contract.level === 7) {
        const quota = contract.level === 6 ? 2 : 1
        for (const defender of defenderOrder) penalties[defender] = Math.max(0, quota - (tricks[defender] ?? 0)) * contract.value
      } else {
        penalties[second] = Math.max(0, 1 - (tricks[second] ?? 0)) * contract.value
      }
    }
    return { kind: 'NORMAL', poolAwards, penalties, credits, tricks: { ...tricks } }
  }

  static mizer(input: MizerScoreInput): HandResult {
    const { players, contract, tricks } = input
    if (contract.kind !== ContractKind.MIZER) throw new Error('Contratto Mizer richiesto')
    const poolAwards = zeros(players)
    const penalties = zeros(players)
    const declarerTricks = tricks[contract.declarerId] ?? 0
    if (declarerTricks === 0) poolAwards[contract.declarerId] = 10
    else penalties[contract.declarerId] = declarerTricks * 10
    return { kind: 'MIZER', poolAwards, penalties, credits: creditMatrix(players), tricks: { ...tricks } }
  }

  static raspasy(input: RaspasyScoreInput): HandResult {
    const { players, tricks, value } = input
    const poolAwards = zeros(players)
    const penalties = zeros(players)
    const minimum = Math.min(...players.map(id => tricks[id] ?? 0))
    for (const id of players) {
      const count = tricks[id] ?? 0
      penalties[id] = (count - minimum) * value
      if (count === 0) poolAwards[id] = 1
    }
    return { kind: 'RASPASY', poolAwards, penalties, credits: creditMatrix(players), tricks: { ...tricks }, raspasyValue: value }
  }
}

export class AmericanAidPoolPolicy implements PoolAwardPolicy {
  award(context: PoolAwardContext, playerId: PlayerId, points: number): PoolAwardOutcome {
    if (!Number.isInteger(points) || points < 0) throw new Error('I punti Pozzo devono essere interi non negativi')
    const poolChanges = zeros(context.playersInOrder)
    const penaltyChanges = zeros(context.playersInOrder)
    const creditChanges: Array<{ fromId: PlayerId; againstId: PlayerId; amount: number }> = []
    const aidTransfers = []
    const virtualPool = Object.fromEntries(context.playersInOrder.map(id => [id, context.scores[id]!.pool])) as Record<PlayerId, number>
    const own = Math.min(points, Math.max(0, context.poolTarget - virtualPool[playerId]!))
    virtualPool[playerId]! += own
    poolChanges[playerId]! += own
    let remaining = points - own
    while (remaining > 0) {
      const candidates = context.playersInOrder.filter(id => virtualPool[id]! < context.poolTarget)
      if (candidates.length === 0) {
        const reduction = Math.min(remaining, context.scores[playerId]!.penalty)
        penaltyChanges[playerId]! -= reduction
        break
      }
      const highestPool = Math.max(...candidates.map(id => virtualPool[id]!))
      const tied = new Set(candidates.filter(id => virtualPool[id] === highestPool))
      const donorIndex = context.playersInOrder.indexOf(playerId)
      const recipientId = [...context.playersInOrder.slice(donorIndex + 1), ...context.playersInOrder.slice(0, donorIndex + 1)].find(id => tied.has(id))!
      const transfer = Math.min(remaining, context.poolTarget - virtualPool[recipientId]!)
      virtualPool[recipientId]! += transfer
      poolChanges[recipientId]! += transfer
      const credits = transfer * 10
      creditChanges.push({ fromId: playerId, againstId: recipientId, amount: credits })
      aidTransfers.push({ donorId: playerId, recipientId, poolPoints: transfer, credits })
      remaining -= transfer
    }
    return { poolChanges, penaltyChanges, creditChanges, aidTransfers }
  }
}
