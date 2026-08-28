// Прогон всех проверок: node tests/run.mjs
//   node tests/run.mjs --approve   — принять нынешний вывод как эталонный
//
// Здесь две защиты, и они дополняют друг друга.
//
// Первая: файл не должен падать. Ненулевой код выхода — это либо исключение,
// либо непрошедшая проверка из assert.mjs.
//
// Вторая: вывод не должен меняться молча. Большинство проверок в этом
// хозяйстве ничего не утверждают, а печатают числа — «шар лёг на y = 777.0»,
// «провисание 0.69 px». Переписать их все в утверждения значит выдумать
// ожидания задним числом и почти наверняка местами ошибиться. Но сравнивать
// вывод с прошлым можно и без этого: симуляция детерминирована, поэтому любое
// изменение числа означает, что изменилась физика. Прошло это намеренно или
// нет — решает человек, глядя на разницу.
//
// Из сравнения выброшено время работы: оно скачет от загрузки машины и к
// физике отношения не имеет.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { execFileSync } from 'child_process'

const dir = new URL('.', import.meta.url)
const approvedDir = new URL('./approved/', import.meta.url)
const approve = process.argv.includes('--approve')

const files = readdirSync(dir)
  .filter((f) => f.endsWith('.mjs') && f !== 'run.mjs' && f !== 'assert.mjs')
  .sort()

// Файлы, чей вывод сравнивать бессмысленно: они меряют скорость, и числа в них
// зависят от машины, а не от кода.
const TIMED = new Set(['perf.mjs', 'airperf.mjs', 'profile.mjs'])

// Убираем из вывода всё, что меняется само по себе
// \b в регулярных выражениях JavaScript считает границей только латиницу,
// поэтому после кириллического «с» или «мс» она не срабатывает — здесь везде
// явные окончания вместо границ слова.
const normalize = (s) => s
  .replace(/\d+([.,]\d+)?\s*(мс|ms)(\/[^\s]+)?/g, '<время>')
  .replace(/\d+([.,]\d+)?\s*с(?=[\s)),.]|$)/gm, '<время>')
  .replace(/\d{4}-\d{2}-\d{2}T[\d:.-]+/g, '<дата>')
  .trimEnd()

if (approve && !existsSync(approvedDir)) mkdirSync(approvedDir, { recursive: true })

const broken = []
const drifted = []
let approved = 0

for (const f of files) {
  console.log(`\n=== ${f} ${'='.repeat(Math.max(0, 40 - f.length))}`)
  let out = ''
  let failed = false
  try {
    out = execFileSync('node', [new URL(f, dir).pathname], { encoding: 'utf8' })
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '')
    failed = true
  }
  process.stdout.write(out)
  if (failed) { console.log(`ОШИБКА: ${f} не прошёл`); broken.push(f) }

  if (TIMED.has(f)) continue
  const snap = new URL(`${f}.txt`, approvedDir)
  const now = normalize(out)

  if (approve) {
    writeFileSync(snap, `${now}\n`)
    approved++
    continue
  }
  let want = null
  try { want = normalize(readFileSync(snap, 'utf8')) } catch { /* эталона ещё нет */ }
  if (want === null) continue
  if (want !== now) {
    console.log(`ВЫВОД ИЗМЕНИЛСЯ: ${f}`)
    // показываем первую разошедшуюся строку — по ней обычно всё понятно
    const a = want.split('\n')
    const b = now.split('\n')
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        console.log(`  строка ${i + 1}:`)
        console.log(`    было:  ${a[i] ?? '(нет строки)'}`)
        console.log(`    стало: ${b[i] ?? '(нет строки)'}`)
        break
      }
    }
    drifted.push(f)
  }
}

console.log(`\n${'='.repeat(46)}`)
if (approve) {
  console.log(`эталонный вывод принят для ${approved} файлов`)
  process.exit(0)
}
if (broken.length) console.log(`НЕ ПРОШЛИ (${broken.length}): ${broken.join(', ')}`)
if (drifted.length) {
  console.log(`ВЫВОД ИЗМЕНИЛСЯ (${drifted.length}): ${drifted.join(', ')}`)
  console.log('  Числа в этих проверках стали другими — значит изменилась физика.')
  console.log('  Посмотрите разницу: если правка намеренная, примите новый эталон')
  console.log('  командой  npm test -- --approve  и не забудьте про RULES_VERSION.')
}
if (broken.length || drifted.length) process.exit(1)
console.log(`все проверки прошли: файлов ${files.length}`)
