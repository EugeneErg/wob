import '../src/entities/index.js'
import { World } from '../src/core/world.js'
const ground = { id: 'g', type: 'terrain', data: { points: [[0, 780], [1600, 780], [1600, 900], [0, 900]], smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } }
const gb = (id, x, y, asleep) => ({ id, type: 'game-ball', data: { x, y, r: 13, builtR: 13, mass: 1, builtMass: 1, anchorable: true, asleep, minLinks: 2, maxLinks: 3, range: 165, jump: 470, speed: 95, dropMax: 190, color: '#e2704a', linkColor: '#f0b48c' } })

// столбик из четырёх шаров, падающих в одну точку
function stack(asleep) {
  const w = new World({ width: 1600, height: 900, gravity: { x: 0, y: 1800 },
    entities: [ground, ...[0, 1, 2, 3].map((i) => gb('b' + i, 800, 600 - i * 40, asleep))] })
  for (let i = 0; i < 60 * 4; i++) w.step(1 / 60)
  const ys = w.instances.filter((i) => i.type === 'game-ball').map((i) => i.rt.p.y).sort((a, b) => a - b)
  return ys
}
const sleepy = stack(true)
const awake = stack(false)
console.log('спящие  :', sleepy.map((y) => y.toFixed(0)).join(', '), '— столбиком, друг на друге')
console.log('активные:', awake.map((y) => y.toFixed(0)).join(', '), '— в одной точке, проходят насквозь')
console.log('спящие сталкиваются:', sleepy[0] < sleepy[3] - 20, '| активные — нет:', awake[3] - awake[0] < 5)

// спящий не тормозит у обрыва
const cliff = { id: 'c', type: 'terrain', data: { points: [[0, 780], [600, 780], [600, 900], [0, 900]], smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } }
const w2 = new World({ width: 1600, height: 900, gravity: { x: 900, y: 1800 }, entities: [cliff, gb("s", 520, 700, true)] })
for (let i = 0; i < 60 * 6; i++) w2.step(1 / 60)
const left = w2.instances.find((i) => i.type === 'game-ball')
console.log('спящего снесло за край (обрыв на 600):', left ? `x=${left.rt.p.x.toFixed(0)} y=${left.rt.p.y.toFixed(0)}` : 'улетел вниз и исчез — у края не тормозил')
