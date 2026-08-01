// Прогон всех проверок: node tests/run.mjs
import { readdirSync } from 'fs'
import { execFileSync } from 'child_process'

const files = readdirSync(new URL('.', import.meta.url)).filter((f) => f.endsWith('.mjs') && f !== 'run.mjs').sort()
for (const f of files) {
  console.log(`\n=== ${f} ${'='.repeat(Math.max(0, 40 - f.length))}`)
  try {
    process.stdout.write(execFileSync('node', [new URL(f, import.meta.url).pathname], { encoding: 'utf8' }))
  } catch (e) {
    console.log('ОШИБКА:', e.message.split('\n')[0])
  }
}
