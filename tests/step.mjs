import '../src/entities/index.js'
import { World } from '../src/core/world.js'
// уступ: шары наверху, конструкция внизу справа — должны спрыгнуть
const lvl = { width: 1600, height: 900, gravity: { x: 0, y: 1800 }, entities: [
  { id: 'g1', type: 'terrain', data: { points: [[0, 600], [700, 600], [700, 900], [0, 900]], smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } },
  { id: 'g2', type: 'terrain', data: { points: [[700, 720], [1600, 720], [1600, 900], [700, 900]], smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } },
  { id: 's1', type: 'system-ball', data: { x: 1100, y: 703, r: 17, static: true, links: ['s2'], color: '#d8cbb0', linkColor: '#b9ae95' } },
  { id: 's2', type: 'system-ball', data: { x: 1180, y: 703, r: 17, static: true, links: ['s1'], color: '#d8cbb0', linkColor: '#b9ae95' } },
  ...[200, 260, 320, 380].map((x, i) => ({ id: 'b' + i, type: 'game-ball', data: { x, y: 570, r: 13, mass: 1, minLinks: 2, maxLinks: 3, range: 165, jump: 470, speed: 95, dropMax: 190, color: '#e2704a', linkColor: '#f0b48c' } })),
] }
const w = new World(lvl)
const balls = () => w.instances.filter((x) => x.type === 'game-ball')
for (let t = 0; t < 14; t++) {
  for (let i = 0; i < 60; i++) w.step(1 / 60)
  const b = balls()
  if (t % 3 === 2 || t === 13) console.log(`t=${t + 1}c состояния ${b.map((q) => q.rt.state).join(',')} | x ${b.map((q) => q.rt.p.x.toFixed(0)).join(',')} | спустились ${b.filter((q) => q.rt.p.y > 650).length}/4`)
}
