import { requestOpenAIAdvisor } from '../server/openai-advisor.js'

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'method_not_allowed' })
  try { return response.status(200).json(await requestOpenAIAdvisor(request.body)) }
  catch (error) { return response.status(200).json({ unavailable: true, code: Number(error?.statusCode) === 429 ? 'rate_limited' : 'advanced_ai_unavailable' }) }
}
