// Откат в живой игре и перемотка в повторе — один и тот же пересчёт.
// Разница в том, что бывает после: в повторе запись читают, в игре — дописывают.
import '../src/entities/index.js'
import { Run, replayOf, PLAY } from '../src/core/run.js'
import { Scrubber } from '../src/core/scrub.js'
import { level } from './level.mjs'
import { formatTime } from '../src/core/replays.js'
import { check } from './assert.mjs'

const lvl = level('lvl-tower')
const hash = (r) => {
  let h = 2166136261
  for (const p of r.world.physics.points) {
    const s = `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  }
  return (h >>> 0).toString(16)
}

// Играем, тащим шар, потом откатываемся и играем иначе
function played() {
  const r = new Run(lvl, { mode: PLAY, seed: 5 })
  const f = (n) => { for (let i = 0; i < n; i++) r.frame(1 / 60) }
  f(60)
  const b = r.world.instances.filter((x) => x.type === 'game-ball' && x.rt.state === 'free')[0]
  r.down({ x: b.rt.p.x, y: b.rt.p.y })
  for (let k = 0; k < 20; k++) { r.move({ x: 745, y: 700 }); f(1) }
  r.up({ x: 745, y: 700 })
  f(60)
  return r
}

const r = played()
console.log('сыграно подряд: тик', r.tick, ', начисто:', r.clean)

// --- откат -------------------------------------------------------------------
r.rollback(90)
console.log('\nоткат на 90-й тик:')
console.log('  мир вернулся на тик', r.tick)
console.log('  отметка в записи:', JSON.stringify(r.branches))
for (let i = 0; i < 60; i++) r.frame(1 / 60)   // переигрываем иначе

const snap = r.snapshot()
console.log('\nчто в записи:')
console.log('  путь, который остался:', snap.ticks, 'тиков =', formatTime(snap.ticks))
console.log('  на самом деле потрачено:', snap.spentTicks, 'тиков =', formatTime(snap.spentTicks))
check('откат оставил след в записи', snap.clean === false && snap.branches.length === 1)
check('потрачено больше, чем осталось в пути', snap.spentTicks > snap.ticks)

// --- вот в чём опасность -----------------------------------------------------
// Обрезанная запись не противоречива: она проигрывается точно. Если бы отметки
// об откате не осталось, прогон, собранный из кусков, был бы неотличим от
// сыгранного подряд — и время показывало бы только удачные куски.
const rp = replayOf(lvl, snap)
while (rp.tick < snap.ticks) rp.frame(1 / 60)
check('обрезанная запись проигрывается точно (потому отметка и обязательна)', hash(rp) === hash(r))
console.log('по самой записи откат не виден, виден только по отметке:',
  snap.input.length / 4, 'событий подряд, без разрывов')

// --- в повторе то же действие безобидно --------------------------------------
// Scrubber делает тот же пересчёт, но лог у него только для чтения: сколько
// ни мотай, запись не меняется и время не переписывается.
const sc = new Scrubber(lvl, snap)
sc.seek(120); while (sc.pump(50)) { /* считаем */ }
const at120 = sc.tick
sc.seek(40); while (sc.pump(50)) { /* считаем */ }
console.log('\nперемотка в повторе: 120 →', sc.tick, ', запись не тронута:', sc.record.input.length === snap.input.length)
console.log('  цена перемотки назад, тиков пересчёта:', sc.costOf(0) === 0 ? 0 : 40, '(на этом уровне мгновенно)')
console.log('  вперёд считается только разница:', sc.costOf(100), 'тиков')


// --- в спидране откатов нет --------------------------------------------------
// Запрет стоит в самом Run, а не в кнопках интерфейса: правило, которое живёт
// только в разметке, действует до первого, кто откроет консоль.
const sr = new Run(lvl, { mode: PLAY, seed: 5, speedrun: true })
for (let i = 0; i < 140; i++) sr.frame(1 / 60)
const refused = sr.rollback(90) === false
console.log('\nспидран:')
check('в спидране откат отклонён', refused)
check('тик не сдвинулся', sr.tick === 140)
check('запись осталась чистой', sr.clean && sr.branches.length === 0)
