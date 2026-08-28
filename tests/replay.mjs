// Фундамент спидранов: одна и та же запись обязана давать один и тот же мир,
// сколько бы кадров в секунду ни было у того, кто её проигрывает.
import '../src/entities/index.js'
import { Run, replayOf, PLAY } from '../src/core/run.js'
import { level } from './level.mjs'
import { check } from './assert.mjs'

const lvl = level('lvl-tower')

// Отпечаток мира: положения и скорости всех точек. Если хоть один тик прошёл
// иначе, числа разъедутся и отпечаток не совпадёт.
function hash(run) {
  let h = 2166136261
  const put = (v) => {
    // округление до сотой: сравниваем состояние, а не шум последнего бита
    const s = String(Math.round(v * 100))
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  }
  for (const p of run.world.physics.points) { put(p.x); put(p.y); put(p.vx); put(p.vy) }
  put(run.world.physics.links.length)
  return (h >>> 0).toString(16)
}

// Живая попытка: тащим шар и ставим его в конструкцию. Кадры приходят
// «как на 60 Гц»: ровно по одному тику за кадр.
function record() {
  const run = new Run(lvl, { mode: PLAY, seed: 12345 })
  const frame = (n) => { for (let i = 0; i < n; i++) run.frame(1 / 60) }
  frame(60)
  for (const [i, y] of [700, 660, 620].entries()) {
    const b = run.world.instances.filter((x) => x.type === 'game-ball' && x.rt.state === 'free')
      .sort((a, c) => a.rt.p.x - c.rt.p.x)[0]
    if (!b) break
    const x = 745 + (i % 2 ? 26 : -26)
    run.down({ x: b.rt.p.x, y: b.rt.p.y })
    for (let k = 0; k < 20; k++) { run.move({ x, y }); frame(1) }
    run.up({ x, y })
    frame(90)
  }
  return run
}

const live = record()
const rec = live.snapshot()
console.log(`запись: ${rec.ticks} тиков (${(rec.ticks / 60).toFixed(2)} c), событий ${rec.input.length / 4}, seed ${rec.seed}`)
const liveHash = hash(live)
console.log('отпечаток живого прогона:', liveHash)

// Повтор той же записи при разной частоте кадров. Кадр 1/30 даёт по два тика,
// кадр 1/144 — по одному через раз, рваный кадр — как повезёт.
const pacings = {
  '60 Гц (ровно)': () => 1 / 60,
  '30 Гц (медленно)': () => 1 / 30,
  '144 Гц (быстро)': () => 1 / 144,
  'рваные кадры': (() => { let i = 0; return () => [1 / 20, 1 / 144, 1 / 45, 1 / 60, 1 / 90][i++ % 5] })(),
}

let ok = true
for (const [name, next] of Object.entries(pacings)) {
  const r = replayOf(lvl, rec)
  let guard = 0
  while (r.tick < rec.ticks && guard++ < 100000) r.frame(next())
  // добираем хвост, если частота кадров не легла в тик ровно
  while (r.tick < rec.ticks) r.frame(1 / 60)
  const h = hash(r)
  const same = h === liveHash
  ok &&= same
  check(`повтор совпал при «${name}»`, same, `тиков ${r.tick}, отпечаток ${h}`)
}

// Тот же ввод, но другой seed — мир обязан отличаться, иначе seed не работает
const other = replayOf(lvl, { ...rec, seed: 999 })
while (other.tick < rec.ticks) other.frame(1 / 60)
check('другой seed даёт другой мир', hash(other) !== liveHash)

check('ИТОГ: повтор детерминирован на любой частоте кадров', ok)

// --- расхождение находится и называется тиком -------------------------------
// Подделываем контрольные отметки: как будто запись снята на другой физике.
// Повтор обязан не молчать, а сказать, с какого тика он разошёлся.
const broken = { ...rec, checks: rec.checks.map((c, i) => (i >= 2 ? (c ^ 0xdeadbeef) >>> 0 : c)) }
const r2 = replayOf(lvl, broken)
while (r2.tick < rec.ticks) r2.frame(1 / 60)
check('расхождение найдено и названо точным тиком', r2.diverged === 120, `тик ${r2.diverged}`)

// А целая запись расхождений давать не должна
const r3 = replayOf(lvl, rec)
while (r3.tick < rec.ticks) r3.frame(1 / 60)
check('целая запись расхождений не даёт', r3.diverged === null)
