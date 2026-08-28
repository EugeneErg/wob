// Просмотр записи главы. Попытка главы — несколько заходов, и смотрят её
// заход за заходом. Проверяем, что каждый сегмент воспроизводится точно:
// иначе экран попыток показывал бы правдоподобную, но неправильную игру.

import '../src/entities/index.js'
import { Run, replayOf, PLAY } from '../src/core/run.js'
import { ChainRun, segmentRecord } from '../src/core/chain.js'
import { formatTime, KIND } from '../src/core/replays.js'
import { level } from './level.mjs'
import { check } from './assert.mjs'

const hash = (r) => {
  let h = 2166136261
  for (const p of r.world.physics.points) {
    const s = `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  }
  return (h >>> 0).toString(16)
}

// Настоящая игра: тащим шар и ставим в конструкцию
function playLevel(lvl, seed, moves) {
  const run = new Run(lvl, { mode: PLAY, seed })
  const f = (n) => { for (let i = 0; i < n; i++) run.frame(1 / 60) }
  f(60)
  for (const target of moves) {
    const b = run.world.instances.filter((x) => x.type === 'game-ball' && x.rt.state === 'free')
      .sort((a, c) => a.rt.p.x - c.rt.p.x)[0]
    if (!b) break
    run.down({ x: b.rt.p.x, y: b.rt.p.y })
    for (let k = 0; k < 20; k++) { run.move(target); f(1) }
    run.up(target)
    f(45)
  }
  return run
}

// --- собираем попытку главы из двух заходов ---------------------------------
const chain = new ChainRun({ kind: KIND.CHAPTER, targetId: 'ch-test' })
const live = []

const a = playLevel(level('lvl-tower'), 1111, [{ x: 745, y: 700 }])
chain.push(a.snapshot(), { levelId: 'lvl-tower', hash: 'h-tower' })
live.push(a)

const b = playLevel(level('lvl-tower'), 1111, [{ x: 700, y: 660 }, { x: 790, y: 660 }])
chain.push(b.snapshot(), { levelId: 'lvl-tower', hash: 'h-tower' })
live.push(b)

const rec = chain.snapshot()
console.log('попытка главы:', rec.segments.length, 'захода,', formatTime(rec.ticks))
console.log('сегменты:', rec.segments.map((g, i) => `#${i + 1} ${formatTime(g.ticks)}`).join(', '))

// --- смотрим её так, как это делает экран попыток ---------------------------
let allMatch = true
for (let i = 0; i < rec.segments.length; i++) {
  const sr = segmentRecord(rec, i)
  const lvl = level(sr.targetId)
  const rp = replayOf(lvl, sr)
  while (rp.tick < sr.ticks) rp.frame(1 / 60)
  const same = hash(rp) === hash(live[i])
  allMatch &&= same
  check(`заход #${i + 1} воспроизводится точно`, same, `тиков ${rp.tick}, расхождений ${rp.diverged ?? 'нет'}`)
}
check('вся попытка главы воспроизводится точно', allMatch)

// --- сегмент несёт свою версию ----------------------------------------------
console.log('\nу сегмента свой отпечаток версии:', segmentRecord(rec, 0).hash)
console.log('  (у главы он свой, но уровень мог измениться отдельно —')
console.log('   поэтому проверять надо версию уровня, а не главы)')

// --- второй заход отличается от первого -------------------------------------
// Тот же уровень, тот же сид, другой ввод: разница именно в игре, а не в мире.
console.log('\nтот же уровень и тот же сид, но играли иначе:')
console.log('  одинаковый сид:', rec.segments[0].seed === rec.segments[1].seed)
console.log('  разный ввод:', rec.segments[0].input.length !== rec.segments[1].input.length)
console.log('  разный итог:', hash(live[0]) !== hash(live[1]))
