import '../src/entities/index.js'
import { World } from '../src/core/world.js'

const box = (x, y, w, h, extra = {}) => ({
  id: 'o' + Math.random().toString(36).slice(2, 6), type: 'object',
  data: { points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], mass: 6, smoothness: 0.4, restitution: 0.1, static: false, fill: '#5c5346', edge: '#8d7f68', ...extra },
})
const ground = { id: 'g', type: 'terrain', data: { points: [[0, 780], [1600, 780], [1600, 900], [0, 900]], smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } }

// 1. ящик падает и ложится на землю
let w = new World({ width: 1600, height: 900, gravity: { x: 0, y: 1800 }, entities: [ground, box(400, 400, 120, 60)] })
for (let i = 0; i < 60 * 4; i++) w.step(1 / 60)
let v = w.instances.find((i) => i.type === 'object').rt.verts
console.log('ящик упал: низ y =', Math.max(...v.map((p) => p.y)).toFixed(1), '(земля 780) | ширина',
  (Math.max(...v.map((p) => p.x)) - Math.min(...v.map((p) => p.x))).toFixed(1), '(была 120)')

// 2. падает на угол — должен повернуться
w = new World({ width: 1600, height: 900, gravity: { x: 0, y: 1800 },
  entities: [ground, { ...box(400, 300, 140, 40), data: { ...box(0, 0, 140, 40).data, points: [[400, 300], [540, 340], [530, 380], [390, 340]] } }] })
for (let i = 0; i < 60 * 5; i++) w.step(1 / 60)
v = w.instances.find((i) => i.type === 'object').rt.verts
const ang = Math.atan2(v[1].y - v[0].y, v[1].x - v[0].x) * 180 / Math.PI
console.log('повернулся на', ang.toFixed(1), '° (стартовал с 15.9°)')

// 3. шар лежит на объекте, объект — на земле
w = new World({ width: 1600, height: 900, gravity: { x: 0, y: 1800 }, entities: [
  ground, box(400, 600, 200, 60),
  { id: 'b', type: 'system-ball', data: { x: 500, y: 400, r: 17, static: false, links: [], color: '#d8cbb0', linkColor: '#b9ae95' } },
] })
for (let i = 0; i < 60 * 4; i++) w.step(1 / 60)
const ball = w.instances.find((i) => i.type === 'system-ball').rt.p
v = w.instances.find((i) => i.type === 'object').rt.verts
console.log('шар на объекте: y шара', ball.y.toFixed(1), '| верх объекта', Math.min(...v.map((p) => p.y)).toFixed(1), '| зазор', (Math.min(...v.map((p) => p.y)) - ball.y).toFixed(1), '(радиус 17)')
