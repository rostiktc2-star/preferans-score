import { chmod, readFile, writeFile } from 'node:fs/promises'

const target = new URL('../.env.local', import.meta.url)
const current = await readFile(target, 'utf8')
const values = new Map(current.split(/\r?\n/).filter(Boolean).map(line => {
  const separator = line.indexOf('=')
  return [line.slice(0, separator), line.slice(separator + 1)]
}))
if (!values.get('OPENAI_API_KEY')) throw new Error('OPENAI_API_KEY non configurata.')
values.set('OPENAI_MODEL', 'gpt-6-luna')
values.set('OPENAI_TIMEOUT_MS', '4000')
values.set('OPENAI_SERVICE_TIER', 'fast')
values.set('OPENAI_INPUT_COST_PER_MILLION', '0.20')
values.set('OPENAI_OUTPUT_COST_PER_MILLION', '1.00')
await writeFile(target, `${[...values].map(([name, value]) => `${name}=${value}`).join('\n')}\n`, { mode: 0o600 })
await chmod(target, 0o600)
console.log('Modello, timeout e stima costi OpenAI aggiornati.')
