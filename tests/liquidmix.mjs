// Вода и остальной мир. Проверяем не воду саму по себе, а утверждение, ради
// которого всё затевалось: сущность, ничего не знающая про жидкость, действует
// на неё сама — потому что жидкость это частицы мира.
//
// Ни в одной из проверяемых сущностей нет ни строчки про воду, и в воде нет ни
// строчки про них.

import '../src/entities/index.js'
import { World } from '../src/core/world.js'

const wall = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
const terr = (id, a, b, c, d) => ({ id, type: 'terrain', data: { points: wall(a, b, c, d), smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } })
const water = (id, x0, y0, x1, y1, limit = 500) => ({
  id, type: 'liquid',
  data: { points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], polys: null, substance: 'water', grain: 11, limit },
})
const drops = (w, id = 'w') => w.physics.points.filter((p) => p.owner === id && !p.removed)

// --- 1. притяжение: у каждой частицы свой «низ» ------------------------------
{
  // Мир без тяжести, посреди — источник притяжения. Вода обязана собраться
  // вокруг него шаром, а не лежать плоско.
  const w = new World({
    width: 1200, height: 800, gravity: { x: 0, y: 0 },
    entities: [
      { id: 'g', type: 'gravity-well', data: { x: 600, y: 400, pull: 2000, radius: 60, falloff: 2, range: 0, solid: true, movable: false, signal: '', invert: false, lines: 0, smoothness: 0.4 } },
      water('w', 450, 150, 750, 260, 400),
    ],
  })
  w.step(1 / 60)
  const spread = () => {
    const d = drops(w)
    const cx = d.reduce((s, p) => s + p.x, 0) / d.length
    const cy = d.reduce((s, p) => s + p.y, 0) / d.length
    const r = d.map((p) => Math.hypot(p.x - 600, p.y - 400))
    return { cy, rmin: Math.min(...r), rmax: Math.max(...r) }
  }
  const a = spread()
  for (let i = 0; i < 60 * 8; i++) w.step(1 / 60)
  const b = spread()
  console.log(`1. притяжение: центр воды по вертикали ${a.cy.toFixed(0)} → ${b.cy.toFixed(0)} (источник на 400)`)
  console.log(`   расстояние до источника было ${a.rmin.toFixed(0)}–${a.rmax.toFixed(0)}, стало ${b.rmin.toFixed(0)}–${b.rmax.toFixed(0)} ⇒ ${b.rmax < a.rmax ? 'вода притянулась' : 'НЕ ПРИТЯНУЛАСЬ'}`)
}

// --- 2. дыра: настоящий стакан в геометрии ----------------------------------
{
  const w = new World({
    width: 1200, height: 800, gravity: { x: 0, y: 1800 },
    entities: [
      // Пол с проёмом: стакан лунки должен стоять в пустоте, а не внутри
      // рельефа — иначе его внутренность и есть сплошной камень.
      terr('fl', 0, 700, 540, 800), terr('fr', 660, 700, 1200, 800),
      terr('l', 300, 400, 340, 700), terr('r', 860, 400, 900, 700),
      { id: 'h', type: 'hole', data: { x: 600, y: 700, r: 26, depth: 70, target: true, signal: '', color: '#2b2b2b' } },
      water('w', 345, 560, 855, 695, 700),
    ],
  })
  w.step(1 / 60)
  for (let i = 0; i < 60 * 6; i++) w.step(1 / 60)
  const inCup = drops(w).filter((p) => p.y > 705 && Math.abs(p.x - 600) < 26).length
  console.log(`2. лунка: в стакане оказалось ${inCup} частиц ⇒ ${inCup > 5 ? 'вода натекла' : 'НЕ НАТЕКЛА'}`)
}

// --- 3. труба: всасывание -----------------------------------------------------
{
  const w = new World({
    width: 1200, height: 800, gravity: { x: 0, y: 1800 },
    entities: [
      terr('floor', 0, 700, 1200, 800),
      terr('l', 300, 400, 340, 700), terr('r', 860, 400, 900, 700),
      { id: 'p', type: 'pipe', data: { points: [[600, 620], [600, 300], [1100, 300]], suction: 900, radius: 40, color: '#7a6a55' } },
      water('w', 345, 600, 855, 695, 600),
    ],
  })
  w.step(1 / 60)
  const above = () => drops(w).filter((p) => p.y < 560).length
  const a = above()
  for (let i = 0; i < 60 * 6; i++) w.step(1 / 60)
  // Труба воду НЕ тянет, и это ограничение трубы, а не воды: её всасывание
  // устроено не силой, а связью — она ищет тело, к которому можно прилепиться
  // (`attachable` и уже имеющее связи или закреплённое), и тянет его к себе.
  // Частица среды ни к чему не крепится и связей не имеет, поэтому труба её не
  // видит. Захочется поить трубы водой — менять надо трубу: всасывание должно
  // стать полем силы, а не связью. Тогда оно заодно заработает и для песка, и
  // для всего, что появится позже.
  console.log(`3. труба: выше устья было ${a}, стало ${above()} ⇒ ${above() > a + 3 ? 'тянет' : 'не тянет — всасывание трубы устроено связью, а не силой'}`)
}
