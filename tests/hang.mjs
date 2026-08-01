import '../src/entities/index.js'
import { World } from '../src/core/world.js'
const lvl = { width: 1600, height: 900, gravity: { x: 0, y: 1800 }, entities: [
  { id: 'g', type: 'terrain', data: { points: [[0, 800], [1600, 800], [1600, 900], [0, 900]], smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } },
  { id: 's1', type: 'system-ball', data: { x: 700, y: 500, r: 17, static: true, links: ['s2'], color: '#d8cbb0', linkColor: '#b9ae95' } },
  { id: 's2', type: 'system-ball', data: { x: 790, y: 500, r: 17, static: true, links: ['s1'], color: '#d8cbb0', linkColor: '#b9ae95' } },
  { id: 'p1', type: 'pipe', data: { points: [[745, 400], [745, 200]], radius: 30, power: 1, color: '#4c93c4', inner: '#0d1a24' } },
  { id: 'b1', type: 'game-ball', data: { x: 300, y: 780, r: 13, mass: 1, minLinks: 2, maxLinks: 3, range: 165, jump: 470, speed: 95, dropMax: 190, color: '#e2704a', linkColor: '#f0b48c' } },
] }
const w = new World(lvl)
const run = (n) => { for (let i = 0; i < n; i++) w.step(1 / 60) }
const ball = () => w.instances.find((x) => x.type === 'game-ball')
const pipe = () => w.instances.find((x) => x.type === 'pipe')
run(30)
// вешаем шар на конструкцию под трубой
w.pointerDown({ x: ball().rt.p.x, y: ball().rt.p.y })
for (let k = 0; k < 15; k++) { w.pointerMove({ x: 745, y: 450 }); w.step(1 / 60) }
w.pointerUp({ x: 745, y: 450 })
run(60)
console.log('шар:', ball().rt.state, '| его связей:', ball().rt.p.links.length, '| труба зацепилась:', !!pipe().rt.link)
// сносим его собственные связи — остаётся висеть только на трубе
for (const l of ball().rt.links) w.physics.removeLink(l)
run(6)
console.log('после сноса связей: связей у шара', ball().rt.p.links.length, '| труба держит:', !!pipe().rt.link)
run(60)
console.log('через секунду: y =', ball().rt.p.y.toFixed(0), '(бросали на 450, земля 787) состояние', ball().rt.state)
