import '../src/entities/index.js'
import { World } from '../src/core/world.js'
const ground = { id: 'g', type: 'terrain', data: { points: [[0, 780], [1600, 780], [1600, 900], [0, 900]], smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } }
const gb = (id, x, y, mass) => ({ id, type: 'game-ball', data: { x, y, r: 13, mass, minLinks: 2, maxLinks: 3, range: 165, jump: 470, speed: 95, dropMax: 190, color: '#e2704a', linkColor: '#f0b48c' } })

// 1. отрицательный вес поднимает шар и он не улетает за границу
let w = new World({ width: 1600, height: 900, gravity: { x: 0, y: 1800 }, entities: [ground, gb('b', 400, 700, -1)] })
for (let i = 0; i < 60 * 6; i++) w.step(1 / 60)
let p = w.instances.find((i) => i.type === 'game-ball').rt.p
console.log('летающий шар: y =', p.y.toFixed(1), '(старт 700, потолок 0) | вес в физике', p.mass, '| lift', p.lift)

// 2. объект на двух опорах взлетает, когда к нему прицепили летающие шары
const objData = { points: [[600, 600], [900, 600], [900, 660], [600, 660]], mass: 4, smoothness: 0.4, restitution: 0.1, static: false, fill: '#5c5346', edge: '#8d7f68' }
const lvl = { width: 1600, height: 900, gravity: { x: 0, y: 1800 }, entities: [
  ground,
  { id: 'obj', type: 'object', data: objData },
  { id: 's1', type: 'system-ball', parent: 'obj', data: { x: 680, y: 583, r: 17, static: true, links: ['s2'], color: '#d8cbb0', linkColor: '#b9ae95' } },
  { id: 's2', type: 'system-ball', parent: 'obj', data: { x: 820, y: 583, r: 17, static: true, links: ['s1'], color: '#d8cbb0', linkColor: '#b9ae95' } },
] }
w = new World(structuredClone(lvl))
const obj = () => w.instances.find((i) => i.type === 'object').rt.verts
const anchors = () => w.instances.filter((i) => i.type === 'system-ball').map((i) => i.rt.p)
for (let i = 0; i < 60 * 2; i++) w.step(1 / 60)
const y0 = Math.min(...obj().map((p) => p.y))
console.log('объект лёг: верх', y0.toFixed(1), '| опоры едут вместе с ним:', anchors().map((a) => a.y.toFixed(1)).join(','))

// цепляем летающие шары к конструкции опор
const attached = []
for (const [i, x] of [700, 750, 800, 850].entries()) {
  const inst = w.spawn('game-ball', gb('f' + i, x, 620, -5).data)
  const b = inst.rt.p
  const drop = { x, y: 640 }
  w.pointerDown({ x: b.x, y: b.y })
  for (let k = 0; k < 10; k++) { w.pointerMove(drop); w.step(1 / 60) }
  w.pointerUp(drop)
  for (let k = 0; k < 30; k++) w.step(1 / 60)
  attached.push(inst.rt.state)
}
console.log('состояния прицепленных:', attached.join(','))
const weight = (4 + 3 + 3) * 1800, lift = 4 * 5 * 1800
console.log(`вес сборки ${weight}, подъёмная сила ${lift}`)
for (let i = 0; i < 60 * 5; i++) w.step(1 / 60)
const y1 = Math.min(...obj().map((p) => p.y))
console.log('верх объекта', y1.toFixed(1), '| поднялся на', (y0 - y1).toFixed(1), 'px | опоры', anchors().map((a) => a.y.toFixed(0)).join(','))
