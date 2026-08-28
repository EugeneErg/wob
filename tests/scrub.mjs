// Перемотка повтора. Проверяем не кнопки, а то, ради чего они: что мир на
// тике N один и тот же, как бы зритель на него ни попал — доиграв подряд,
// перемотав вперёд или отмотав назад.

import '../src/entities/index.js'
import { Run, replayOf, PLAY } from '../src/core/run.js'
import { Scrubber } from '../src/core/scrub.js'
import { level } from './level.mjs'
import { formatTime } from '../src/core/replays.js'
import { check } from './assert.mjs'

const hashOf = (r) => {
  let h = 2166136261
  for (const p of r.world.physics.points) {
    const s = `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  }
  return (h >>> 0).toString(16)
}

const lvl = level('lvl-tower')
const hash = (w) => {
  let h = 2166136261
  for (const p of w.physics.points) {
    const s = `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  }
  return (h >>> 0).toString(16)
}

// Записываем настоящую игру
const live = new Run(lvl, { mode: PLAY, seed: 4242 })
const f = (n) => { for (let i = 0; i < n; i++) live.frame(1 / 60) }
f(60)
for (const [i, y] of [700, 660].entries()) {
  const b = live.world.instances.filter((x) => x.type === 'game-ball' && x.rt.state === 'free')
    .sort((a, c) => a.rt.p.x - c.rt.p.x)[0]
  if (!b) break
  const x = 745 + (i % 2 ? 26 : -26)
  live.down({ x: b.rt.p.x, y: b.rt.p.y })
  for (let k = 0; k < 20; k++) { live.move({ x, y }); f(1) }
  live.up({ x, y })
  f(60)
}
const rec = live.snapshot()
console.log(`запись: ${rec.ticks} тиков (${formatTime(rec.ticks)})`)

// Эталон: где мир оказывается на каждом из проверяемых тиков, если просто
// доигрывать подряд
const marks = [30, 90, 150, 200]
const want = {}
{
  const r = replayOf(lvl, rec)
  for (const m of marks) {
    while (r.tick < m) r.frame(1 / 60)
    want[m] = hash(r.world)
  }
}

// Догоняем перемотку до конца, считая, сколько работы это стоило
const settle = (sc) => { let n = 0; while (sc.pump(1000)) n++; return n }

const sc = new Scrubber(lvl, rec)

console.log('\nвперёд по одному:')
for (const m of marks) {
  const cost = sc.costOf(m)
  sc.seek(m); settle(sc)
  check(`вперёд на тик ${m} совпал с эталоном`, hash(sc.world) === want[m], `пересчитано ${cost}`)
}

console.log('\nназад:')
for (const m of [...marks].reverse()) {
  const cost = sc.costOf(m)
  sc.seek(m); settle(sc)
  check(`назад на тик ${m} совпал с эталоном`, hash(sc.world) === want[m], `пересчитано ${cost}`)
}

console.log('\nвперёд считается только разница, назад — всё с начала:')
sc.seek(30); settle(sc)
console.log('  с 30 на 150 вперёд:', sc.costOf(150), 'тиков')
sc.seek(150); settle(sc)
console.log('  с 150 на 30 назад:', sc.costOf(30), 'тиков')

console.log('\nпокадровый шаг:')
sc.seek(100); settle(sc)
const at100 = hash(sc.world)
sc.seek(101); settle(sc)
const at101 = hash(sc.world)
sc.seek(100); settle(sc)
check('кадр вперёд меняет мир', at100 !== at101)
check('кадр назад возвращает ровно тот же мир', hash(sc.world) === at100)

console.log('\nза конец записи не уезжаем:')
sc.seek(rec.ticks + 10000); settle(sc)
check('за конец записи не уезжаем', sc.tick === rec.ticks, `встали на ${sc.tick} из ${rec.ticks}`)

// Ради чего всё: перемотка не портит запись
check('перемотка не портит запись', sc.record.input.length === rec.input.length)


// --- разворачивание записи ---------------------------------------------------
// В хранилище лежат только действия. Чтобы по записи можно было быстро ходить
// вперёд и назад, она разворачивается на месте: проигрывается в фоне, и через
// равные промежутки снимается копия мира. Копии живут в памяти и никуда не
// сохраняются — из тех же действий их всегда можно построить заново.
const sc2 = new Scrubber(lvl, rec)
check('пока не развернули, готово только начало', sc2.ready === 0 && sc2.unpacked === 0)
check('но смотреть можно сразу', sc2.tick === 0 && !!sc2.world)

// разворачиваем порциями, как это делает кадр отрисовки
let passes = 0
while (sc2.unpack(5) && passes++ < 500) { /* фоновая работа */ }
check('запись развёрнута до конца', sc2.done && sc2.unpacked === 1)
// число порций не печатаем: оно зависит от скорости машины, а не от кода,
// и в эталонном выводе мигало бы у каждого по-своему
console.log(`развёрнуто: копий ${sc2.shots.length}, шаг ${sc2.step} тиков`)

// Теперь отмотка назад считается от ближайшей копии, а не от начала записи
const far = rec.ticks - 1
sc2.seek(far); settle(sc2)
const cost = sc2.costOf(far - 1)
check('шаг назад считается от копии, а не от начала', cost < far,
  `пересчитать ${cost} тиков вместо ${far}`)

// Дешевле — не значит иначе: сверяем с честным пересчётом с нуля
sc2.seek(far - 1); settle(sc2)
const honest = replayOf(lvl, rec)
while (honest.tick < far - 1) honest.frame(1 / 60)
check('мир из копии совпадает с пересчитанным с нуля',
  hashOf(sc2.run) === hashOf(honest), `${hashOf(sc2.run)} / ${hashOf(honest)}`)

// Память ограничена: копий не становится больше предела, промежуток растёт
const many = new Scrubber(lvl, { ...rec, ticks: rec.ticks })
let g = 0
while (many.unpack(5) && g++ < 500) { /* до конца */ }
check('число копий ограничено сверху', many.shots.length <= 16, `${many.shots.length} копий`)

// И главное: запись от разворачивания не меняется — на сервер уходит то же
check('разворачивание не трогает саму запись',
  sc2.record.input.length === rec.input.length && sc2.record.seed === rec.seed)
