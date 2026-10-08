import type { PlayerView } from '../../game/model'
import type { PreferansBot } from '../bot'
import type { BotDecision, BotDecisionContext } from '../types'
import { DecisionArbiter } from './arbiter'
import { buildLLMContext, contextHash } from './context'
import { decisionKey, shouldConsultLLM } from './gating'
import { BrowserAdvisorTransport } from './transport'
import { AdvancedAiMode, ArbitrationStrategy, type AdvancedAiConfig, type AdvisorDecisionResult, type AdvisorStats, type AdvisorTransport, type DecisionLogEntry, type AdvisorUsage } from './types'
import { validateLLMProposal } from './validator'

const ZERO_USAGE: AdvisorUsage = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }
const DEFAULT_CONFIG: AdvancedAiConfig = { enabled: false, mode: AdvancedAiMode.BALANCED, strategy: ArbitrationStrategy.CONFIDENCE_BASED, timeoutMs: 4000, maxCallsPerHand: 4, maxCallsPerGame: 40, budgetLimitUsd: 1 }

export class AdvancedBotAdvisor {
  readonly logs: DecisionLogEntry[] = []
  #config: AdvancedAiConfig
  #transport: AdvisorTransport
  #cache = new Map<string, ReturnType<typeof validateLLMProposal>>()
  #handNumber = 0
  #callsThisHand = 0
  #stats: AdvisorStats = { ...ZERO_USAGE, requests: 0, cacheHits: 0, fallbacks: 0, accepted: 0, divergences: 0, totalLatencyMs: 0 }

  constructor(config: AdvancedAiConfig = DEFAULT_CONFIG, transport?: AdvisorTransport, private readonly arbiter = new DecisionArbiter()) {
    this.#config = { ...DEFAULT_CONFIG, ...config }
    this.#transport = transport ?? new BrowserAdvisorTransport(this.#config.endpoint)
  }

  configure(config: Partial<AdvancedAiConfig>): void {
    const endpointChanged = config.endpoint !== undefined && config.endpoint !== this.#config.endpoint
    this.#config = { ...this.#config, ...config }
    if (endpointChanged) this.#transport = new BrowserAdvisorTransport(this.#config.endpoint)
  }
  get stats(): AdvisorStats { return { ...this.#stats } }

  async decide(bot: PreferansBot, view: PlayerView): Promise<AdvisorDecisionResult> {
    const started = performance.now()
    const algorithm = bot.decide(view)
    const context: BotDecisionContext = Object.freeze({ botId: bot.id, view, config: bot.config })
    if (view.handNumber !== this.#handNumber) { this.#handNumber = view.handNumber; this.#callsThisHand = 0 }
    const blocked = !this.#config.enabled || !shouldConsultLLM({ context, algorithmDecision: algorithm })
    if (blocked) return this.#finish(algorithm, algorithm, { decision: algorithm, source: 'ALGORITHM', consulted: false, validationStatus: 'NOT_CONSULTED' }, started, ZERO_USAGE)
    if (this.#callsThisHand >= (this.#config.maxCallsPerHand ?? 4) || this.#stats.requests >= (this.#config.maxCallsPerGame ?? 40) || this.#stats.estimatedCostUsd >= (this.#config.budgetLimitUsd ?? 1)) {
      this.#stats = { ...this.#stats, fallbacks: this.#stats.fallbacks + 1 }
      return this.#finish(algorithm, algorithm, { decision: algorithm, source: 'ALGORITHM', consulted: false, validationStatus: 'BUDGET_BLOCKED' }, started, ZERO_USAGE)
    }
    const llmContext = buildLLMContext(context, bot.memory, this.#config.mode)
    const hash = contextHash(llmContext)
    const cached = this.#cache.get(hash)
    if (cached) {
      this.#stats = { ...this.#stats, cacheHits: this.#stats.cacheHits + 1 }
      const selected = this.arbiter.choose(algorithm, cached.decision, this.#config.strategy)
      return this.#finish(algorithm, cached.decision, { ...selected, consulted: true, validationStatus: 'CACHED', contextHash: hash }, started, ZERO_USAGE)
    }
    this.#callsThisHand += 1
    this.#stats = { ...this.#stats, requests: this.#stats.requests + 1 }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.#config.timeoutMs)
    try {
      const response = await this.#transport.request(llmContext, controller.signal)
      const usage: AdvisorUsage = { inputTokens: response.usage?.inputTokens ?? 0, outputTokens: response.usage?.outputTokens ?? 0, estimatedCostUsd: response.usage?.estimatedCostUsd ?? 0 }
      this.#stats = { ...this.#stats, inputTokens: this.#stats.inputTokens + usage.inputTokens, outputTokens: this.#stats.outputTokens + usage.outputTokens, estimatedCostUsd: this.#stats.estimatedCostUsd + usage.estimatedCostUsd }
      const validated = validateLLMProposal(response.proposal, context)
      if (!validated) {
        this.#stats = { ...this.#stats, fallbacks: this.#stats.fallbacks + 1 }
        return this.#finish(algorithm, undefined, { decision: algorithm, source: 'ALGORITHM', consulted: true, validationStatus: 'INVALID', contextHash: hash }, started, usage)
      }
      this.#cache.set(hash, validated)
      const selected = this.arbiter.choose(algorithm, validated.decision, this.#config.strategy)
      const divergent = decisionKey(algorithm) !== decisionKey(validated.decision)
      this.#stats = { ...this.#stats, accepted: this.#stats.accepted + (selected.source === 'LLM' || selected.source === 'AGREEMENT' ? 1 : 0), divergences: this.#stats.divergences + (divergent ? 1 : 0) }
      return this.#finish(algorithm, validated.decision, { ...selected, consulted: true, validationStatus: 'VALID', contextHash: hash }, started, usage)
    } catch {
      this.#stats = { ...this.#stats, fallbacks: this.#stats.fallbacks + 1 }
      const status = controller.signal.aborted ? 'TIMEOUT' : 'UNAVAILABLE'
      return this.#finish(algorithm, undefined, { decision: algorithm, source: 'ALGORITHM', consulted: true, validationStatus: status, contextHash: hash }, started, ZERO_USAGE)
    } finally { clearTimeout(timeout) }
  }

  #finish(algorithm: BotDecision, llm: BotDecision | undefined, result: AdvisorDecisionResult, started: number, usage: AdvisorUsage): AdvisorDecisionResult {
    const latency = performance.now() - started
    this.#stats = { ...this.#stats, totalLatencyMs: this.#stats.totalLatencyMs + latency }
    if (import.meta.env?.DEV) this.logs.push({ decisionType: algorithm.type, contextHash: result.contextHash, algorithmChoice: decisionKey(algorithm), llmChoice: llm ? decisionKey(llm) : undefined, finalChoice: decisionKey(result.decision), latencyMs: latency, usage, validationStatus: result.validationStatus })
    return result
  }
}
