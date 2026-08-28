// Копия мира: снимок посреди прогона обязан продолжаться так же, как оригинал.
//
// Это не «примерно похоже»: расхождение в одну сотую через двадцать тиков
// превращается в другой финал. Поэтому сверяются полные отпечатки, и не на
// одном уровне, а на всех, что есть, — у каждой сущности своя связь с физикой,
// и сломаться копия может ровно в одной из них.
import '../src/entities/index.js'
import { World } from '../src/core/world.js'
import { forkWorld } from '../src/core/fork.js'
import { level } from './level.mjs'
import { check } from './assert.mjs'

const hash = (w) => {
  let h = 2166136261
  const put = (s) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } }
  for (const p of w.physics.points) {
    put(`${Math.round(p.x * 100)},${Math.round(p.y * 100)},${Math.round(p.vx)},${Math.round(p.vy)},${Math.round(p.angle * 100)}`)
  }
  put(`l${w.physics.links.length}b${w.physics.bodies.length}c${w.physics.colliders.length}`)
  for (const i of w.instances) {
    const polys = i.rt?.polys
    if (polys) for (const poly of polys) for (const ring of poly) for (const [x, y] of ring) put(`${Math.round(x)},${Math.round(y)}`)
    if (i.rt?.state) put(i.rt.state)
  }
  return (h >>> 0).toString(16)
}

const ids = ['lvl-tower', 'lvl-bridge', 'lvl-lift', 'lvl-dig', 'lvl-hole', 'lvl-orbit']

for (const id of ids) {
  const lvl = level(id)
  if (!lvl) continue
  const w = new World(structuredClone(lvl), { seed: 4242 })
  const step = (world, n) => { for (let i = 0; i < n; i++) world.step(1 / 60) }

  step(w, 90)
  // Снимок посреди прогона
  const copy = forkWorld(w)
  check(`${id}: снимок совпадает с оригиналом сразу после копии`, hash(copy) === hash(w))

  // Дальше обе идут сами по себе
  step(w, 120)
  step(copy, 120)
  check(`${id}: копия продолжается так же, как оригинал`, hash(copy) === hash(w),
    `${hash(w)} против ${hash(copy)}`)
}

// --- копия не связана с оригиналом -------------------------------------------
// Если ссылки остались общими, движение в одном мире будет видно в другом.
{
  const w = new World(structuredClone(level('lvl-tower')), { seed: 7 })
  for (let i = 0; i < 90; i++) w.step(1 / 60)
  const copy = forkWorld(w)
  const before = hash(w)
  for (let i = 0; i < 60; i++) copy.step(1 / 60)
  check('шаги в копии не трогают оригинал', hash(w) === before)
  check('и миры разошлись, потому что копия ушла вперёд', hash(copy) !== before)
}

// --- ссылки внутри копии указывают на копию, а не на оригинал ----------------
{
  const w = new World(structuredClone(level('lvl-tower')), { seed: 7 })
  for (let i = 0; i < 60; i++) w.step(1 / 60)
  const copy = forkWorld(w)

  const origPoints = new Set(w.physics.points)
  let shared = 0
  for (const inst of copy.instances) {
    for (const v of Object.values(inst.rt || {})) {
      if (v && typeof v === 'object' && origPoints.has(v)) shared++
    }
  }
  check('ни одна сущность копии не держит точку оригинала', shared === 0, `общих ссылок: ${shared}`)

  const copyPoints = new Set(copy.physics.points)
  const linksOk = copy.physics.links.every((l) => copyPoints.has(l.a) && copyPoints.has(l.b))
  check('связи копии соединяют точки копии', linksOk)

  // Та же точка, а не просто похожая: сущность и решатель обязаны двигать одну
  const ball = copy.instances.find((i) => i.type === 'game-ball' && i.rt?.p)
  check('точка сущности лежит в хранилище копии', !!ball && copyPoints.has(ball.rt.p))
}

// --- события копии не летят в слушателей оригинала ---------------------------
{
  const w = new World(structuredClone(level('lvl-tower')), { seed: 7 })
  let heard = 0
  w.on('progress', () => heard++)
  for (let i = 0; i < 30; i++) w.step(1 / 60)
  const copy = forkWorld(w)
  const was = heard
  for (let i = 0; i < 120; i++) copy.step(1 / 60)
  check('слушатели оригинала не слышат копию', heard === was)
}
