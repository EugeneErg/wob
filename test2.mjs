import './src/entities/index.js'
import { World } from './src/core/world.js'
import { readFileSync } from 'fs'

const lvl = JSON.parse(readFileSync('./src/levels/tower.json', 'utf8'))
const w = new World(structuredClone(lvl))
const run = (n) => { for (let i = 0; i < n; i++) w.step(1 / 60) }
const balls = () => w.instances.filter((x) => x.type === 'game-ball')
function drag(from, to, hold = 12) {
  if (!w.pointerDown(from)) throw new Error('промах')
  for (let i = 1; i <= hold; i++) { w.pointerMove({ x: from.x + (to.x - from.x) * i / hold, y: from.y + (to.y - from.y) * i / hold }); w.step(1 / 60) }
  w.pointerUp(to)
}
run(60)
for (const y of [700, 650, 600, 550]) {
  // берём свободный шар подальше от кучи, чтобы не схватить соседа
  const b = balls().filter((x) => x.rt.state === 'free').sort((a, c) => a.rt.p.x - c.rt.p.x)[0]
  drag({ x: b.rt.p.x, y: b.rt.p.y }, { x: 745 + (Math.random() * 40 - 20), y })
  run(30)
}
run(60)
const built = balls().filter((b) => b.rt.state === 'built')
console.log('в конструкции:', built.length, '| связей всего:', w.physics.links.length)

// --- выдёргивание ---
// берём шар, рядом с которым нет других — иначе схватим соседа
const victim = built
  .map((b) => ({ b, near: Math.min(...w.instances.filter((o) => o !== b && o.rt?.p).map((o) => Math.hypot(o.rt.p.x - b.rt.p.x, o.rt.p.y - b.rt.p.y))) }))
  .sort((a, c) => c.near - a.near)[0].b
const p0 = { x: victim.rt.p.x, y: victim.rt.p.y }
const linksBefore = w.physics.links.length
w.pointerDown(p0)
console.log('состояние при захвате:', victim.rt.state, '| связей у шара:', victim.rt.p.links.length)
w.pointerMove({ x: 1100, y: 400 })
run(20)
console.log('во время тяги: связей в мире', w.physics.links.length, '(было', linksBefore + ')',
  '| настоящий шар сместился на', Math.hypot(victim.rt.p.x - p0.x, victim.rt.p.y - p0.y).toFixed(1),
  '| видимых связей у шара:', victim.rt.p.links.filter((l) => l.visible !== false).length,
  '| превью связей:', victim.rt.preview.length)
w.pointerUp({ x: 1100, y: 400 })
run(2)
console.log('после отпускания: состояние', victim.rt.state,
  '| позиция', victim.rt.p.x.toFixed(0) + ',' + victim.rt.p.y.toFixed(0),
  '| связей в мире', w.physics.links.length)
run(120)
console.log('через 2 c:', victim.rt.state, '| конструкция:', balls().filter((b) => b.rt.state === 'built').length)

// --- разрыв связей под нагрузкой ---
const w2 = new World(structuredClone(lvl))
const run2 = (n) => { for (let i = 0; i < n; i++) w2.step(1 / 60) }
run2(60)
const bs = () => w2.instances.filter((x) => x.type === 'game-ball')
for (const [i, x] of [830, 910, 990, 1070].entries()) {
  const b = bs().find((q) => q.rt.state === 'free' || q.rt.state === 'walk')
  b.data.mass = 8
  b.rt.p.mass = 8
  const from = { x: b.rt.p.x, y: b.rt.p.y }
  w2.pointerDown(from)
  w2.pointerMove({ x, y: 700 - i * 10 })
  w2.pointerUp({ x, y: 700 - i * 10 })
  run2(45)
}
const n1 = w2.physics.links.length
run2(300)
console.log('консоль из тяжёлых шаров: связей было', n1, '→ стало', w2.physics.links.length)
