// Баги, найденные в браузере. Headless-тесты их не ловили, потому что каждый
// сидел на стыке двух сущностей.

import '../src/entities/index.js'
import { World } from '../src/core/world.js'

const wall = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
const terr = (id, a, b, c, d) => ({ id, type: 'terrain', data: { points: wall(a, b, c, d), smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } })
const pond = (x0, y0, x1, y1, limit) => ({ id: 'w', type: 'liquid', data: { points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], polys: null, substance: 'water', grain: 11, limit } })
const drops = (w) => w.physics.points.filter((p) => p.owner === 'w' && !p.removed)

// --- вентилятор гонит волну -------------------------------------------------
{
  function run(power) {
    const e = [terr('floor', 0, 700, 1200, 800), terr('l', 200, 400, 240, 700), terr('r', 960, 400, 1000, 700), pond(245, 520, 955, 695, 900)]
    if (power) e.push({ id: 'f', type: 'fan', data: { x: 320, y: 430, angle: 35, power, nozzle: 60, cell: 22, push: 16, show: false, color: '#7fb6cc' } })
    const w = new World({ width: 1200, height: 800, gravity: { x: 0, y: 1800 }, entities: e })
    for (let i = 0; i < 60 * 5; i++) w.step(1 / 60)
    const d = drops(w)
    // рябь: разброс уреза по колонкам + средний снос
    const cols = new Map()
    for (const p of d) { const c = Math.floor(p.x / 60); cols.set(c, Math.min(cols.get(c) ?? 1e9, p.y)) }
    const hs = [...cols.values()]
    return { drift: d.reduce((s, p) => s + p.vx, 0) / d.length, wave: Math.max(...hs) - Math.min(...hs) }
  }
  const calm = run(0), blown = run(1400)
  console.log(`4. вентилятор: снос ${calm.drift.toFixed(1)} → ${blown.drift.toFixed(1)} px/с, рябь ${calm.wave.toFixed(1)} → ${blown.wave.toFixed(1)} px ⇒ ${blown.drift > calm.drift + 3 || blown.wave > calm.wave + 5 ? 'волны есть' : 'НЕ ВЛИЯЕТ'}`)
}

// --- игровой шар тонет ------------------------------------------------------
{
  const w = new World({
    width: 1200, height: 800, gravity: { x: 0, y: 1800 },
    entities: [
      terr('floor', 0, 700, 1200, 800), terr('l', 300, 400, 340, 700), terr('r', 860, 400, 900, 700),
      pond(345, 480, 855, 695, 900),
      { id: 'b', type: 'game-ball', data: { x: 600, y: 200, r: 22, mass: 1, asleep: false } },
    ],
  })
  for (let i = 0; i < 60 * 6; i++) w.step(1 / 60)
  const b = w.physics.points.find((p) => p.owner === 'b')
  console.log(`5. игровой шар: осел на ${b.y.toFixed(0)} (урез ~480, дно 700) ⇒ ${b.y < 640 ? 'плавает в воде' : 'ПРОВАЛИЛСЯ НА ДНО'}`)
}

// --- лунка наполняется до конца ---------------------------------------------
{
  const w = new World({
    width: 1200, height: 800, gravity: { x: 0, y: 1800 },
    entities: [
      terr('fl', 0, 700, 540, 800), terr('fr', 660, 700, 1200, 800),
      terr('l', 300, 400, 340, 700), terr('r', 860, 400, 900, 700),
      { id: 'h', type: 'hole', data: { x: 600, y: 700, r: 26, depth: 70, target: true, signal: '', color: '#2b2b2b' } },
      pond(345, 560, 855, 695, 700),
    ],
  })
  for (let i = 0; i < 60 * 10; i++) w.step(1 / 60)
  const inCup = drops(w).filter((p) => p.y > 705 && Math.abs(p.x - 600) < 26)
  const deepest = inCup.length ? Math.max(...inCup.map((p) => p.y)) : 0
  console.log(`3. лунка: ${inCup.length} частиц, самая нижняя на ${deepest.toFixed(0)} (дно стакана ~770) ⇒ ${deepest > 745 ? 'наполнилась' : 'ЗАСТРЯЛА'}`)
}
