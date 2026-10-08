import type { AdvisorTransport, AdvisorTransportResponse, LLMDecisionContext } from './types'

export class BrowserAdvisorTransport implements AdvisorTransport {
  constructor(private readonly endpoint = '/api/advanced-ai') {}
  async request(context: LLMDecisionContext, signal: AbortSignal): Promise<AdvisorTransportResponse> {
    const response = await fetch(this.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context }), signal })
    if (!response.ok) throw new Error(`Advanced AI unavailable (${response.status})`)
    const result = await response.json() as AdvisorTransportResponse
    if (result.unavailable) throw new Error('Advanced AI unavailable')
    return result
  }
}
