import '../src/entities/index.js'
import { World } from '../src/core/world.js'
const ents = [
  { id: 'g', type: 'terrain', data: { points: [[0, 860], [1600, 860], [1600, 900], [0, 900]], smoothness: 0.5, fill: '#2a3326', edge: '#66804f' } },
  { id: 'w', type: 'wind', data: { x: 100, y: 100, ax: 260, ay: 0, bx: -120, by: -60, period: 6, force: 0.55, show: true, color: '#9fc6d8' } },
]
for (const [i, x] of [500, 800, 1100].entries()) ents.push({ id: 'f' + i, type: 'fan', data: { x, y: 830, angle: -90, power: 520, nozzle: 46, cell: 22, push: 16, show: true, color: '#7fb6cc' } })
for (let i = 0; i < 12; i++) ents.push({ id: 'b' + i, type: 'game-ball', data: { x: 300 + i * 60, y: 700, r: 13, builtR: 13, sleepR: 13, mass: 1, builtMass: 1, sleepMass: 1, opacity: 1, anchorable: true, asleep: false, minLinks: 2, maxLinks: 3, range: 165, jump: 470, speed: 95, dropMax: 190, color: '#e2704a', linkColor: '#f0b48c' } })
const w = new World({ width: 1600, height: 900, gravity: { x: 0, y: 1800 }, entities: ents })
const t0 = performance.now()
for (let i = 0; i < 60 * 10; i++) w.step(1 / 60)
console.log(`ветер + 3 вентилятора + 12 шаров: ${((performance.now() - t0) / 600).toFixed(2)} мс/кадр`)
const f = w.instances.find((i) => i.type === 'fan').rt.air.field
console.log(`сетка ${f.nx}×${f.ny} = ${f.nx * f.ny} клеток`)
console.log(`фигур в сцене: ${w.scene().length}`)
