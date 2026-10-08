import type { BotDecision } from '../types'
import { decisionKey } from './gating'
import { ArbitrationStrategy, type AdvisorDecisionResult } from './types'

export class DecisionArbiter {
  choose(algorithm: BotDecision, llm: BotDecision, strategy = ArbitrationStrategy.CONFIDENCE_BASED): Pick<AdvisorDecisionResult, 'decision' | 'source'> {
    const agrees = decisionKey(algorithm) === decisionKey(llm)
    if (agrees) return { decision: { ...algorithm, confidence: Math.min(1, Math.max(algorithm.confidence, llm.confidence) + .05), reasons: [...new Set([...algorithm.reasons, ...llm.reasons, 'algorithm_llm_agreement'])] } as BotDecision, source: 'AGREEMENT' }
    if (strategy === ArbitrationStrategy.ALGORITHM_OVERRIDE) return { decision: algorithm, source: 'ALGORITHM' }
    if (strategy === ArbitrationStrategy.LLM_OVERRIDE) return { decision: llm, source: 'LLM' }
    const llmThreshold = strategy === ArbitrationStrategy.HYBRID ? algorithm.confidence + .04 : algorithm.confidence + .08
    return llm.confidence >= llmThreshold ? { decision: llm, source: 'LLM' } : { decision: algorithm, source: 'ALGORITHM' }
  }
}
