import './src/entities/index.js'
import { World } from './src/core/world.js'

const ball = (x, y) => ({ type: 'game-ball', data: { x, y, r: 13, minLinks: 2, maxLinks: 3, range: 165, seek: 340, color: '#e2704a', linkColor: '#f0b48c' } })

const level = {
  width: 1600, height: 900, gravity: { x: 0, y: 1800 },
  entities: [
    { type: 'terrain', data: { points: [[0, 780], [1600, 780], [1600, 900], [0, 900]], smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } },
    { type: 'system-ball', data: { x: 700, y: 763, r: 17, static: true, color: '#d8cbb0' } },
    { type: 'system-ball', data: { x: 790, y: 763, r: 17, static: true, color: '#d8cbb0' } },
    { type: 'pipe', data: { points: [[745, 600], [745, 200]], radius: 30, power: 1, color: '#4c93c4', inner: '#0d1a24' } },
    ball(300, 700), ball(360, 700), ball(420, 700), ball(480, 700), ball(540, 700),
  ],
}

const w = new World(structuredClone(level))
let collected = 0
w.on('ball:collected', () => collected++)

const run = (sec) => { for (let i = 0; i < sec * 60; i++) w.step(1 / 60) }

run(1)
const ground = w.physics.points.find((p) => p.owner.startsWith('game-ball') && !p.pinned)
console.log('шар лежит на земле y =', ground.y.toFixed(1), '(ожидаем ~767)')

// игрок тащит шар между опорами
function drag(from, to) {
  if (!w.pointerDown(from)) throw new Error('не попали по шару в ' + JSON.stringify(from))
  for (let i = 1; i <= 12; i++) {
    w.pointerMove({ x: from.x + ((to.x - from.x) * i) / 12, y: from.y + ((to.y - from.y) * i) / 12 })
    w.step(1 / 60)
  }
  w.pointerUp(to)
}

const inst = (i) => w.instances.filter((x) => x.type === 'game-ball')[i]
for (const [i, y] of [[0, 690], [1, 640]].entries ? [[0, 690], [1, 640]] : []) {
  drag({ x: inst(i).rt.p.x, y: inst(i).rt.p.y }, { x: 745, y })
  run(0.6)
  console.log(`шар ${i}:`, inst(i).rt.state, '| связей:', inst(i).rt.p.links.length)
}

const pipeInst = w.instances.find((x) => x.type === 'pipe')
console.log('труба присосалась:', !!pipeInst.rt.link)

run(12)
const states = w.instances.filter((x) => x.type === 'game-ball').map((x) => x.rt.state)
console.log('состояния шаров:', states.join(', '))
console.log('всосано в трубу:', collected)
console.log('точек:', w.physics.points.length, 'связей:', w.physics.links.length)
