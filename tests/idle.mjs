import '../src/entities/index.js'
import { World } from '../src/core/world.js'
// конструкции нет вообще: опоры не связаны — шары должны просто бродить, без прыжков у стен
const lvl = { width: 1600, height: 900, gravity: { x: 0, y: 1800 }, entities: [
  { id: 'w1', type: 'terrain', data: { points: [[0, 0], [60, 0], [60, 900], [0, 900]], smoothness: 0.9, fill: '#232a20', edge: '#3f4b34' } },
  { id: 'g', type: 'terrain', data: { points: [[0, 780], [1600, 780], [1600, 900], [0, 900]], smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } },
  { id: 's1', type: 'system-ball', data: { x: 700, y: 763, r: 17, static: true, links: [], color: '#d8cbb0', linkColor: '#b9ae95' } },
  ...[200, 300, 400].map((x, i) => ({ id: 'b' + i, type: 'game-ball', data: { x, y: 760, r: 13, mass: 1, minLinks: 2, maxLinks: 3, range: 165, jump: 470, speed: 95, dropMax: 190, color: '#e2704a', linkColor: '#f0b48c' } })),
] }
const w = new World(lvl)
const balls = () => w.instances.filter((q) => q.type === 'game-ball')
let jumps = 0
const prev = balls().map((b) => b.rt.p.y)
for (let i = 0; i < 60 * 20; i++) {
  w.step(1 / 60)
  balls().forEach((b, k) => { if (prev[k] - b.rt.p.y > 18) jumps++; prev[k] = b.rt.p.y })
}
console.log('без конструкции: прыжков', jumps, '| x', balls().map((b) => b.rt.p.x.toFixed(0)).join(','))
