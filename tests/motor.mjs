import '../src/entities/index.js'
import { World } from '../src/core/world.js'

const ground = { id: 'g', type: 'terrain', data: { points: [[0, 820], [1600, 820], [1600, 900], [0, 900]], smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } }
const bar = { id: 'b', parent: 'm', type: 'object', data: { points: [[660, 488], [940, 488], [940, 512], [660, 512]], mass: 6, smoothness: 0.4, restitution: 0.1, static: false, fill: '#5c5346', edge: '#8d7f68' } }
const motor = (hard, speed) => ({ id: 'm', type: 'motor', data: { x: 800, y: 500, r: 26, hard, speed, torque: 60, color: '#c58a4b' } })
// упор стоит так, чтобы перекладина упёрлась в него через четверть оборота
const wall = () => ({ id: 'w', type: 'terrain', data: { points: [[860, 545], [905, 545], [905, 780], [860, 780]], smoothness: 0.4, fill: '#2a3326', edge: '#66804f' } })

// угол разворачиваем, чтобы считать полные обороты
function tracker(w) {
  const v = () => w.instances.find((i) => i.type === 'object').rt.verts
  const raw = () => Math.atan2(v()[1].y - v()[0].y, v()[1].x - v()[0].x)
  let last = raw(), total = 0, peak = 0
  return {
    step() {
      const a = raw()
      let d = a - last
      while (d > Math.PI) d -= Math.PI * 2
      while (d < -Math.PI) d += Math.PI * 2
      total += d; last = a
      peak = Math.max(peak, Math.abs(total))
      return total
    },
    turns: () => total / (Math.PI * 2),
    peak: () => peak,
    center: () => { const p = v(); return { x: (p[0].x + p[2].x) / 2, y: (p[0].y + p[2].y) / 2 } },
  }
}
function trial(entities, sec) {
  const w = new World({ width: 1600, height: 900, gravity: { x: 0, y: 1800 }, entities })
  const t = tracker(w)
  for (let i = 0; i < 60 * sec; i++) { w.step(1 / 60); t.step() }
  return { w, t }
}

let r = trial([ground, motor(true, 0.5), bar], 4)
let c = r.t.center()
console.log(`1. жёсткий 0.5 об/с за 4 с: ${r.t.turns().toFixed(2)} оборота (ожидаем 2.00), ось на месте: ${Math.hypot(c.x - 800, c.y - 500).toFixed(1)} px`)

r = trial([ground, motor(true, 0.5), bar, wall()], 4)
console.log(`2. жёсткий сквозь стену: ${r.t.turns().toFixed(2)} оборота — преграда не мешает`)

r = trial([ground, motor(false, 0.5), bar], 4)
c = r.t.center()
console.log(`3. упругий 0.5 об/с за 4 с: ${r.t.turns().toFixed(2)} оборота, шарнир держит: ${Math.hypot(c.x - 800, c.y - 500).toFixed(1)} px`)

r = trial([ground, motor(false, 0.5), bar, wall()], 3)
const stopped = r.t.turns()
for (let i = 0; i < 60 * 3; i++) { r.w.step(1 / 60); r.t.step() }
console.log(`4. упругий против стены: за 3 с ${stopped.toFixed(2)} оборота, за следующие 3 с ещё ${(r.t.turns() - stopped).toFixed(2)} — упёрся`)

const hinge = { ...bar, data: { ...bar.data, points: [[800, 488], [1080, 488], [1080, 512], [800, 512]] } }
r = trial([ground, motor(false, 0), hinge], 3)
console.log(`5. шарнир без мотора: качается сам, размах ${(r.t.peak() * 360).toFixed(0)}°, сейчас ${(r.t.turns() * 360).toFixed(0)}° (мотор выключен)`)
