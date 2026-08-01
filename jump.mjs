import './src/entities/index.js'
import { World } from './src/core/world.js'

const lvl = {
  width: 1600, height: 900, gravity: { x: 0, y: 1800 },
  entities: [
    { type: 'terrain', data: { points: [[0, 780], [1600, 780], [1600, 900], [0, 900]], smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } },
    // конструкция висит над землёй
    { type: 'system-ball', data: { x: 760, y: 640, r: 17, static: true, color: '#d8cbb0' } },
    { type: 'system-ball', data: { x: 840, y: 640, r: 17, static: true, color: '#d8cbb0' } },
    { type: 'game-ball', data: { x: 300, y: 700, r: 13, mass: 1, minLinks: 2, maxLinks: 3, range: 165, jump: 470, color: '#e2704a', linkColor: '#f0b48c' } },
  ],
}
const w = new World(lvl)
const b = w.instances.find((x) => x.type === 'game-ball')
let maxUp = 0, minY = 1e9
for (let i = 0; i < 60 * 12; i++) {
  w.step(1 / 60)
  minY = Math.min(minY, b.rt.p.y)
  maxUp = Math.max(maxUp, 767 - b.rt.p.y)
}
console.log('доехал по земле до x =', b.rt.p.x.toFixed(0), '(старт 300, конструкция на 760..840)')
console.log('максимальная высота прыжка:', maxUp.toFixed(1), 'px | состояние:', b.rt.state)
