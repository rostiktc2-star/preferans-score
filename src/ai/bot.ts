import { GamePhase } from '../game/model'
import { BidEvaluator } from './bidEvaluator'
import { CardPlayEvaluator } from './cardPlayEvaluator'
import { DefenseEvaluator } from './defenseEvaluator'
import { DiscardEvaluator } from './discardEvaluator'
import { CardInferenceEngine } from './inference'
import { BotMemory } from './memory'
import { BotRandom } from './random'
import type { BotConfig, BotDecision, BotDecisionContext } from './types'

export class PreferansBot {
  readonly memory = new BotMemory()
  readonly inference = new CardInferenceEngine()
  readonly #random: BotRandom
  readonly #bid = new BidEvaluator()
  readonly #defense = new DefenseEvaluator()
  readonly #discard = new DiscardEvaluator()
  readonly #play = new CardPlayEvaluator()
  lastDecision?: BotDecision

  constructor(readonly id: string, readonly config: BotConfig) { this.#random = new BotRandom(config.seed) }

  decide(view: BotDecisionContext['view']): BotDecision {
    if (view.viewerId !== this.id) throw new Error('Il bot può ricevere solamente la propria PlayerView')
    const context: BotDecisionContext = Object.freeze({ botId: this.id, view, config: this.config })
    this.memory.update(view)
    let decision: BotDecision
    if (view.phase === GamePhase.BIDDING) decision = { type: 'BID', ...this.#bid.choose(context) }
    else if (view.phase === GamePhase.DEFENDER_DECISIONS) decision = { type: 'DEFENSE', ...this.#defense.choose(context) }
    else if (view.phase === GamePhase.DECLARER_DISCARD) decision = { type: 'DISCARD', ...this.#discard.choose(context) }
    else if ([GamePhase.PLAYING_FIRST_TRICK, GamePhase.PLAYING, GamePhase.RASPASY_PLAYING].includes(view.phase)) decision = { type: 'PLAY_CARD', ...this.#play.choose(context, this.memory, this.#random) }
    else throw new Error(`Il bot non decide nello stato ${view.phase}`)
    this.lastDecision = decision
    return decision
  }
}
