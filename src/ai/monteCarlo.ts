import { ContractKind, type Card } from '../game/model'
import { CardInferenceEngine } from './inference'
import type { BotMemory } from './memory'
import type { BotDecisionContext } from './types'
import { BotRandom } from './random'

export class MonteCarloSimulator {
  constructor(private readonly inference = new CardInferenceEngine()) {}

  estimateCardSafety(context: BotDecisionContext, memory: BotMemory, card: Card, samples: number, random: BotRandom): number {
    if (samples <= 0) return .5
    let favorable = 0, completed = 0
    const deadline = performance.now() + (context.config.timeBudgetMs ?? 150)
    for (let index = 0; index < samples && performance.now() < deadline; index += 1) {
      let world
      try { world = this.inference.samplePossibleWorld(context.view, memory, random) } catch { break }
      const opponents = context.view.playersInOrder.filter(player => player.id !== context.botId)
      const sameSuit = opponents.flatMap(player => world.hands[player.id]!).filter(other => other.suit === card.suit)
      const higherExists = sameSuit.some(other => other.numericStrength > card.numericStrength)
      const lowerExists = sameSuit.some(other => other.numericStrength < card.numericStrength)
      const avoiding = !context.view.contract || context.view.contract.kind === ContractKind.MIZER
      if (avoiding ? higherExists : (!higherExists || lowerExists)) favorable += 1
      completed += 1
    }
    return completed ? favorable / completed : .5
  }
}
