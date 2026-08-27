// Жидкость как частицы мира. Проверяем не «работает ли модуль», а то, ради
// чего всё затевалось: ведёт ли себя вода как вода и взаимодействует ли она с
// остальным миром сама, без единой строчки про это.

import '../src/entities/index.js'
import { World } from '../src/core/world.js'

const wall = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
const terr = (id, x0, y0, x1, y1) => ({ id, type: 'terrain', data: { points: wall(x0, y0, x1, y1), smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } })

const level = {
  width: 1200, height: 800, gravity: { x: 0, y: 1800 },
  entities: [
    terr('floor', 0, 700, 1200, 800),
    terr('left', 300, 400, 340, 700),
    terr('right', 860, 400, 900, 700),
    { id: 'w', type: 'liquid', data: { points: [[345, 480], [855, 480], [855, 695], [345, 695]], polys: null, substance: 'water', density: 1, viscosity: 0.05, tension: 3.06, grain: 11, limit: 2000 } },
  ],
}

const w = new World(structuredClone(level))
w.step(1 / 60)
const drops = () => w.physics.points.filter((p) => p.owner === 'w' && !p.removed)
console.log('1. частиц налито:', drops().length, '| сред зарегистрировано:', w.physics.mediums.length)

const stats = () => {
  const d = drops()
  let ke = 0, top = Infinity
  for (const p of d) { ke += p.vx ** 2 + p.vy ** 2; if (p.y < top) top = p.y }
  return { v: Math.sqrt(ke / d.length), top }
}

for (let i = 0; i < 60 * 6; i++) w.step(1 / 60)
const a = stats()
console.log('2. через 6 с: скорость', a.v.toFixed(1), 'px/с, уровень', a.top.toFixed(1))
for (let i = 0; i < 60 * 4; i++) w.step(1 / 60)
const b = stats()
console.log('3. ещё 4 с: скорость', b.v.toFixed(1), 'px/с, уровень гулял на', Math.abs(b.top - a.top).toFixed(1), 'px')

const cols = new Map()
for (const p of drops()) {
  if (p.x < 380 || p.x > 820) continue
  const c = Math.floor(p.x / 40)
  cols.set(c, Math.min(cols.get(c) ?? Infinity, p.y))
}
const hs = [...cols.values()]
console.log('4. перепад поверхности', (Math.max(...hs) - Math.min(...hs)).toFixed(1), 'px при шаге частиц 11')

const paths = w.scene().filter((s) => s.k === 'path' && s.d && s.d.length > 40)
console.log('5. контур построен:', paths.length > 0, '| длина пути', paths[0]?.d.length ?? 0)

function drop(mass) {
  const w2 = new World(structuredClone(level))
  for (let i = 0; i < 60 * 5; i++) w2.step(1 / 60)
  w2.spawn('object', { points: wall(560, 300, 640, 380), mass, smoothness: 0.4, restitution: 0.1, static: false, fill: '#5c5346', edge: '#8d7f68' }, 'box')
  for (let i = 0; i < 60 * 6; i++) w2.step(1 / 60)
  const pts = w2.physics.points.filter((p) => p.owner === 'box')
  return pts.reduce((s, p) => s + p.y, 0) / pts.length
}
const light = drop(1), heavy = drop(40)
console.log('6. лёгкий ящик осел на', light.toFixed(0), '| тяжёлый на', heavy.toFixed(0), '⇒ тяжёлый ниже:', heavy > light + 20)

function wind(force) {
  const ents = structuredClone(level.entities)
  if (force) ents.push({ id: 'air', type: 'wind', data: { ax: force, ay: 0, bx: force, by: 0, period: 999, force: 1 } })
  const w3 = new World({ ...level, entities: ents })
  for (let i = 0; i < 60 * 4; i++) w3.step(1 / 60)
  const d = w3.physics.points.filter((p) => p.owner === 'w' && !p.removed)
  return d.reduce((s, p) => s + p.vx, 0) / d.length
}
console.log('7. скорость воды: без ветра', wind(0).toFixed(1), '| под ветром', wind(600).toFixed(1), 'px/с')
