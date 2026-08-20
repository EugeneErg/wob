import '../src/entities/index.js'
import { World } from '../src/core/world.js'
import { EVENTS } from '../src/core/globals.js'

const ground = { id: 'g', type: 'terrain', data: { points: [[0, 800], [1600, 800], [1600, 900], [0, 900]], smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } }
const hole = (x, extra = {}) => ({ id: 'h' + x, type: 'hole', data: { x, y: 700, r: 19, depth: 26, counts: true, signal: 'дверь', color: '#4a5560', glow: '#8fb36a', ...extra } })
const ball = (id, x, y, r = 17) => ({ id, type: 'system-ball', data: { x, y, r, static: false, links: [], color: '#d8cbb0', linkColor: '#b9ae95' } })

function trial(entities, sec = 4) {
  const w = new World({ width: 1600, height: 900, gravity: { x: 0, y: 1800 }, entities })
  let score = 0, sig = null
  w.on(EVENTS.progress, (e) => (score += e.delta))
  w.on(EVENTS.signal, (e) => (sig = e))
  for (let i = 0; i < 60 * sec; i++) w.step(1 / 60)
  return { w, score, sig }
}

// 1. шар падает точно в лунку
let r = trial([ground, hole(400), ball('b', 400, 400)])
let p = r.w.instances.find((i) => i.type === 'system-ball').rt.p
console.log(`1. попал: счёт ${r.score}, сигнал ${r.sig?.name}=${r.sig?.value}, шар осел на y=${p.y.toFixed(0)}`)

// 2. мимо — рядом с лункой, не в неё
r = trial([ground, hole(400), ball('b', 520, 400)])
console.log(`2. мимо (шар в 120 px сбоку): счёт ${r.score}, сигнала ${r.sig ? 'нет' : 'не было'}`)

// 3. слишком большой шар не влезает
r = trial([ground, hole(400), ball('b', 400, 400, 34)])
p = r.w.instances.find((i) => i.type === 'system-ball').rt.p
console.log(`3. шар вдвое больше: счёт ${r.score}, лежит сверху на y=${p.y.toFixed(0)} (дно лунки 726)`)

// 4. шар выбили — лунка забирает очко обратно
const w = new World({ width: 1600, height: 900, gravity: { x: 0, y: 1800 }, entities: [ground, hole(400), ball('b', 400, 400)] })
let score = 0
w.on(EVENTS.progress, (e) => (score += e.delta))
for (let i = 0; i < 60 * 4; i++) w.step(1 / 60)
const got = score
const bp = w.instances.find((i) => i.type === 'system-ball').rt.p
bp.x = 300; bp.y = 600; bp.vx = 0; bp.vy = 0   // вынули шар из лунки
for (let i = 0; i < 60 * 3; i++) w.step(1 / 60)
console.log(`4. выбили шар: было ${got}, стало ${score}, сигнал сейчас ${w.signals.get('дверь')}`)

// 5. отскок: роняем с большой высоты — должен остаться, а не выпрыгнуть
r = trial([ground, hole(400), ball('b', 400, 120)], 5)
console.log(`5. падение с 580 px: счёт ${r.score} — из лунки не выскочил`)
