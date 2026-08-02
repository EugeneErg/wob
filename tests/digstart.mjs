import '../src/entities/index.js'
import { World } from '../src/core/world.js'

// два отдельных куска песка + шар: жест начинается в пустоте и копает оба,
// но если начать прямо на шаре — жест достаётся шару
const sand = (id, x) => ({ id, type: 'sand', data: { points: [[x, 400], [x + 150, 400], [x + 150, 700], [x, 700]], polys: null, dig: 20, smoothness: 0.25, fill: '#c9a86a', edge: '#8a6f3e' } })
const lvl = { width: 1600, height: 900, gravity: { x: 0, y: 1800 }, entities: [
  { id: 'g', type: 'terrain', data: { points: [[0, 700], [1600, 700], [1600, 900], [0, 900]], smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } },
  sand('s1', 300), sand('s2', 600),
  { id: 'b', type: 'game-ball', data: { x: 1200, y: 680, r: 13, builtR: 13, mass: 1, builtMass: 1, anchorable: true, asleep: false, minLinks: 2, maxLinks: 3, range: 165, jump: 470, speed: 95, dropMax: 190, color: '#e2704a', linkColor: '#f0b48c' } },
] }
const w = new World(structuredClone(lvl))
const sands = () => w.instances.filter((i) => i.type === 'sand')
const rings = () => sands().map((s) => s.rt.polys.flat().length).join('+')
console.log('до раскопок колец:', rings())

// жест начат в пустоте между кусками, вне любого песка
w.pointerDown({ x: 100, y: 550 })
for (let x = 100; x <= 900; x += 20) { w.pointerMove({ x, y: 550 }); w.step(1 / 60) }
w.pointerUp({ x: 900, y: 550 })
console.log('после сквозного жеста колец:', rings(), '— прокопаны оба куска:', sands().every((s) => s.rt.dug > 0))

// а теперь жест начат прямо на шаре — его должен забрать шар, а не песок
const ball = w.instances.find((i) => i.type === 'game-ball')
const dug = () => sands().map((s) => s.rt.dug || 0).reduce((a, b) => a + b, 0)
const before = dug()
w.pointerDown({ x: ball.rt.p.x, y: ball.rt.p.y })
for (let x = ball.rt.p.x; x >= 400; x -= 20) { w.pointerMove({ x, y: ball.rt.p.y }); w.step(1 / 60) }
w.pointerUp({ x: 400, y: ball.rt.p.y })
console.log('жест начат на шаре: песок не тронут:', dug() === before, '| шар в руке побывал:', ball.rt.state !== 'free' || ball.rt.p.x < 800)
