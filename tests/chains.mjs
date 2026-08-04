import '../src/entities/index.js'
import { World } from '../src/core/world.js'

const ground = { id: 'g', type: 'terrain', data: { points: [[0, 880], [1600, 880], [1600, 900], [0, 900]], smoothness: 0.5, fill: '#2a3326', edge: '#66804f' } }
const motor = (id, x, y, speed, parent) => ({ id, parent, type: 'motor', data: { x, y, r: 60, hard: true, speed, torque: 60, color: '#c58a4b' } })
const rails = (id, pts, speed, parent, closed = false) => ({
  id, parent, type: 'rails',
  data: { points: pts, closed, segs: pts.map(() => ({ speed, wait: 0 })), color: '#8d93a1', show: true },
})
const box = (id, cx, cy, parent) => ({
  id, parent, type: 'object',
  data: { points: [[cx - 40, cy - 20], [cx + 40, cy - 20], [cx + 40, cy + 20], [cx - 40, cy + 20]], mass: 4, smoothness: 0.4, restitution: 0.1, static: false, fill: '#5c5346', edge: '#8d7f68' },
})

const sim = (ents, sec) => {
  const w = new World({ width: 1600, height: 900, gravity: { x: 0, y: 0 }, entities: ents })
  for (let i = 0; i < 60 * sec; i++) w.step(1 / 60)
  return w
}
const cart = (w, id) => { const p = w.instances.find((i) => i.id === id).rt.p; return `(${p.x.toFixed(0)},${p.y.toFixed(0)})` }
const boxAt = (w, id) => {
  const v = w.instances.find((i) => i.id === id).rt.verts
  const cx = v.reduce((a, p) => a + p.x, 0) / v.length, cy = v.reduce((a, p) => a + p.y, 0) / v.length
  const ang = Math.atan2(v[1].y - v[0].y, v[1].x - v[0].x) * 180 / Math.PI
  return `(${cx.toFixed(0)},${cy.toFixed(0)}) под ${ang.toFixed(0)}°`
}

console.log('1. рельсы на двигателе — путь вращается вместе с ним')
let w = sim([ground, motor('m', 800, 450, 0.25), rails('r', [[700, 450], [900, 450]], 0, 'm')], 0)
console.log('   каретка в начале: ' + cart(w, 'r'))
for (const t of [1, 2, 4]) {
  w = sim([ground, motor('m', 800, 450, 0.25), rails('r', [[700, 450], [900, 450]], 0, 'm')], t)
  console.log(`   через ${t} с: ${cart(w, 'r')} — обошла ось`)
}

console.log('\n2. двигатель на рельсах — вращается и едет')
for (const t of [0.6, 1.8, 3]) {
  w = sim([ground, rails('r', [[300, 400], [1300, 400]], 200), motor('m', 300, 400, 0.3, 'r'), box('b', 360, 400, 'm')], t)
  console.log(`   через ${t} с: ящик ${boxAt(w, 'b')} (ожидаем поворот ${(t * 0.3 * 360) % 360 | 0}° и сдвиг ${(t * 200) | 0} px)`)
}

console.log('\n3. двигатель на двигателе — углы складываются')
for (const t of [0.5, 1, 1.5]) {
  w = sim([ground, motor('m1', 800, 450, 0.2), motor('m2', 1000, 450, 0.55, 'm1'), box('b', 1080, 450, 'm2')], t)
  console.log(`   через ${t} с: ящик ${boxAt(w, 'b')} (ожидаем ${((t * (0.2 + 0.55) * 360) % 360) | 0}°)`)
}

console.log('\n4. рельсы на рельсах')
for (const t of [1, 2]) {
  w = sim([ground, rails('r1', [[200, 300], [1200, 300]], 300), rails('r2', [[0, 0], [0, 300]], 150, 'r1'), box('b', 0, 0, 'r2')], t)
  console.log(`   через ${t} с: каретка второй ${cart(w, 'r2')}, ящик ${boxAt(w, 'b')}`)
}
