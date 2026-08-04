import '../src/entities/index.js'
import { World } from '../src/core/world.js'

const ground = { id: 'g', type: 'terrain', data: { points: [[0, 860], [1600, 860], [1600, 900], [0, 900]], smoothness: 0.5, fill: '#2a3326', edge: '#66804f' } }
const rails = (pts, segs, closed = false) => ({ id: 'r', type: 'rails', data: { points: pts, closed, segs, color: '#8d93a1', show: true } })
const platform = { id: 'plat', parent: 'r', type: 'object', data: { points: [[340, 480], [460, 480], [460, 510], [340, 510]], mass: 8, smoothness: 0.4, restitution: 0.1, static: false, fill: '#5c5346', edge: '#8d7f68' } }

function sim(entities, sec, probe) {
  const w = new World({ width: 1600, height: 900, gravity: { x: 0, y: 1800 }, entities })
  const out = []
  for (let i = 0; i < 60 * sec; i++) { w.step(1 / 60); if (probe && i % 60 === 59) out.push(probe(w)) }
  return { w, out }
}
const cart = (w) => w.instances.find((i) => i.type === 'rails').rt
const plat = (w) => {
  const v = w.instances.find((i) => i.type === 'object').rt.verts
  return { x: (v[0].x + v[2].x) / 2, y: (v[0].y + v[2].y) / 2 }
}

// 1. каретка идёт с заданной скоростью и стоит заданную паузу
let r = sim([ground, rails([[400, 500], [900, 500]], [{ speed: 100, wait: 2 }])], 8,
  (w) => `${cart(w).p.x.toFixed(0)}${cart(w).wait > 0 ? ' (ждёт)' : ''}`)
console.log('прямой путь, 100 px/с, пауза 2 с в конце:')
console.log('  по секундам: ' + r.out.join(', '))

// 2. у каждого отрезка своя скорость
r = sim([ground, rails([[300, 500], [600, 500], [900, 500]], [{ speed: 300, wait: 0 }, { speed: 60, wait: 0 }])], 6,
  (w) => `${cart(w).p.x.toFixed(0)}`)
console.log('\nпервый отрезок 300 px/с, второй 60 px/с:')
console.log('  по секундам: ' + r.out.join(', '))

// 3. платформа-ребёнок едет вместе с рельсами и везёт груз
r = sim([ground,
  rails([[400, 495], [1100, 495]], [{ speed: 160, wait: 0 }]),
  platform,
  { id: 'b', type: 'system-ball', data: { x: 400, y: 450, r: 17, static: false, links: [], color: '#d8cbb0', linkColor: '#b9ae95' } },
], 5, (w) => `плита ${plat(w).x.toFixed(0)}, шар ${w.instances.find((i) => i.type === 'system-ball').rt.p.x.toFixed(0)}`)
console.log('\nплатформа на рельсах с шаром сверху:')
for (const line of r.out) console.log('  ' + line)

// 4. замкнутый путь: едет по кругу, не разворачиваясь
r = sim([ground, rails([[500, 400], [900, 400], [900, 700], [500, 700]],
  [{ speed: 400, wait: 0 }, { speed: 400, wait: 0 }, { speed: 400, wait: 0 }, { speed: 400, wait: 0 }], true)], 6,
  (w) => `(${cart(w).p.x.toFixed(0)},${cart(w).p.y.toFixed(0)}) отрезок ${cart(w).i}`)
console.log('\nзамкнутый прямоугольник, 400 px/с:')
console.log('  ' + r.out.join(' → '))

// 5. рельсы ничем не задевают
const { w } = sim([ground, rails([[400, 820], [1200, 820]], [{ speed: 200, wait: 0 }]),
  { id: 'b', type: 'system-ball', data: { x: 800, y: 700, r: 17, static: false, links: [], color: '#d8cbb0', linkColor: '#b9ae95' } }], 3)
const p = w.instances.find((i) => i.type === 'system-ball').rt.p
console.log(`\nшар падает сквозь рельсы: y=${p.y.toFixed(0)} (пол 843) — коллизии нет: ${p.y > 840}`)
