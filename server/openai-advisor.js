const FORBIDDEN_KEYS = new Set(['hiddenHands', 'futureDeck', 'hiddenDiscard', 'hiddenTalon', 'randomSeed', 'internalGameState', 'gameState'])

function containsForbiddenKey(value) {
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([key, item]) => FORBIDDEN_KEYS.has(key) || containsForbiddenKey(item))
}

function sanitizeContext(input) {
  if (!input || typeof input !== 'object' || containsForbiddenKey(input)) throw new Error('Unsafe or missing context')
  const legal = input.legal && typeof input.legal === 'object' ? input.legal : {}
  return {
    game: 'Preferans Sochi', playerId: String(input.playerId ?? ''), phase: String(input.phase ?? ''), role: String(input.role ?? ''), mode: String(input.mode ?? 'BALANCED'),
    hand: Array.isArray(input.hand) ? input.hand : [], contract: input.contract ?? null,
    auction: Array.isArray(input.auction) ? input.auction : [], defenderDecisions: input.defenderDecisions ?? {},
    currentTrick: input.currentTrick ?? null, completedTricks: Array.isArray(input.completedTricks) ? input.completedTricks : [],
    revealedTalon: Array.isArray(input.revealedTalon) ? input.revealedTalon : [], publicHands: input.publicHands ?? {},
    handSizes: input.handSizes ?? {}, tricksWon: input.tricksWon ?? {}, voidSuits: input.voidSuits ?? {}, possibleTrumpCount: input.possibleTrumpCount ?? {},
    legal: { cards: Array.isArray(legal.cards) ? legal.cards : [], bids: Array.isArray(legal.bids) ? legal.bids : [], defenderActions: Array.isArray(legal.defenderActions) ? legal.defenderActions : [], discardableCards: Array.isArray(legal.discardableCards) ? legal.discardableCards : [] },
  }
}

const decisionSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['BID', 'PASS', 'VIST', 'POLVIST', 'DISCARD', 'PLAY_CARD'] },
    cardId: { type: ['string', 'null'] },
    cardIds: { type: 'array', items: { type: 'string' }, maxItems: 2 },
    bid: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', enum: ['NORMAL', 'MIZER'] }, level: { type: ['integer', 'null'] }, trump: { type: ['string', 'null'] } }, required: ['kind', 'level', 'trump'] }] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reasonCodes: { type: 'array', items: { type: 'string' }, maxItems: 8 },
  }, required: ['action', 'cardId', 'cardIds', 'bid', 'confidence', 'reasonCodes'],
}

function outputText(response) {
  if (typeof response.output_text === 'string') return response.output_text
  for (const item of response.output ?? []) for (const content of item.content ?? []) if (typeof content.text === 'string') return content.text
  return ''
}

export async function requestOpenAIAdvisor(payload, env = process.env, fetchImpl = fetch) {
  if (!env.OPENAI_API_KEY) throw Object.assign(new Error('OPENAI_API_KEY not configured'), { statusCode: 503 })
  if (!env.OPENAI_MODEL) throw Object.assign(new Error('OPENAI_MODEL not configured'), { statusCode: 503 })
  const context = sanitizeContext(payload?.context)
  const started = performance.now()
  const response = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST', signal: AbortSignal.timeout(Number(env.OPENAI_TIMEOUT_MS ?? 1500)),
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      reasoning: { effort: 'none' },
      ...(env.OPENAI_SERVICE_TIER ? { service_tier: env.OPENAI_SERVICE_TIER } : {}),
      instructions: 'You advise a legal move in Preferans Sochi. Use only the supplied public context. Choose only an action explicitly present in legal. Return the structured decision; never add narrative or hidden assumptions.',
      input: JSON.stringify(context),
      text: { format: { type: 'json_schema', name: 'preferans_decision', strict: true, schema: decisionSchema } },
      max_output_tokens: 180,
    }),
  })
  if (!response.ok) throw Object.assign(new Error(`OpenAI request failed (${response.status})`), { statusCode: response.status === 429 ? 429 : 502 })
  const body = await response.json()
  const text = outputText(body)
  if (!text) throw Object.assign(new Error('Empty model response'), { statusCode: 502 })
  let proposal
  try { proposal = JSON.parse(text) } catch { throw Object.assign(new Error('Invalid model JSON'), { statusCode: 502 }) }
  const inputTokens = Number(body.usage?.input_tokens ?? 0), outputTokens = Number(body.usage?.output_tokens ?? 0)
  const inputRate = Number(env.OPENAI_INPUT_COST_PER_MILLION ?? 0), outputRate = Number(env.OPENAI_OUTPUT_COST_PER_MILLION ?? 0)
  return { proposal, model: env.OPENAI_MODEL, requestId: body.id, latencyMs: performance.now() - started, usage: { inputTokens, outputTokens, estimatedCostUsd: inputTokens * inputRate / 1_000_000 + outputTokens * outputRate / 1_000_000 } }
}

export async function handleAdvisorHttp(req, res, env = process.env) {
  try {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const result = await requestOpenAIAdvisor(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'), env)
    res.statusCode = 200; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(result))
  } catch (error) {
    const status = Number(error?.statusCode ?? 500)
    res.statusCode = 200; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ unavailable: true, code: status === 429 ? 'rate_limited' : 'advanced_ai_unavailable' }))
  }
}

export const _testing = { containsForbiddenKey, sanitizeContext, decisionSchema, outputText }
