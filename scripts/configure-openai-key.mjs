import { chmod, readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'

const target = new URL('../.env.local', import.meta.url)

function secretPrompt(label) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error('Serve un terminale interattivo.'))
    process.stdout.write(label)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    let value = ''
    const cleanup = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', onData) }
    const onData = chunk => {
      for (const character of chunk) {
        if (character === '\u0003') { cleanup(); process.stdout.write('\n'); return reject(new Error('Operazione annullata.')) }
        if (character === '\r' || character === '\n') { cleanup(); process.stdout.write('\n'); return resolve(value.trim()) }
        if (character === '\u007f') value = value.slice(0, -1)
        else value += character
      }
    }
    process.stdin.on('data', onData)
  })
}

const key = await secretPrompt('Incolla OPENAI_API_KEY (input nascosto) e premi Invio: ')
if (!key.startsWith('sk-') || key.length < 20) throw new Error('La chiave non sembra valida.')

let current = ''
try { current = await readFile(target, 'utf8') } catch {}
const values = new Map(current.split(/\r?\n/).filter(Boolean).map(line => {
  const separator = line.indexOf('=')
  return separator > 0 ? [line.slice(0, separator), line.slice(separator + 1)] : [line, '']
}))
values.set('OPENAI_API_KEY', key)
if (!values.get('OPENAI_MODEL')) values.set('OPENAI_MODEL', 'gpt-6-luna')
if (!values.get('OPENAI_TIMEOUT_MS')) values.set('OPENAI_TIMEOUT_MS', '4000')
if (!values.get('OPENAI_SERVICE_TIER')) values.set('OPENAI_SERVICE_TIER', 'fast')
if (!values.has('OPENAI_INPUT_COST_PER_MILLION')) values.set('OPENAI_INPUT_COST_PER_MILLION', '0.20')
if (!values.has('OPENAI_OUTPUT_COST_PER_MILLION')) values.set('OPENAI_OUTPUT_COST_PER_MILLION', '1.00')
await writeFile(target, `${[...values].map(([name, value]) => `${name}=${value}`).join('\n')}\n`, { mode: 0o600 })
await chmod(target, 0o600)
console.log('Configurazione OpenAI salvata in .env.local (permessi 600).')
