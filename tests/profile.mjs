import '../src/entities/index.js'
import { World } from '../src/core/world.js'
const ground = { id: 'g', type: 'terrain', data: { points: [[0, 780], [1600, 780], [1600, 900], [0, 900]], smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } }
const sb = (id, x, links) => ({ id, type: 'system-ball', data: { x, y: 763, r: 17, static: true, links, color: '#d8cbb0', linkColor: '#b9ae95' } })
const gb = { id: 'b', type: 'game-ball', data: { x: 300, y: 700, r: 13, builtR: 30, sleepR: 20, mass: 1, builtMass: -4, sleepMass: 9, opacity: 0.5, anchorable: true, asleep: true, minLinks: 1, maxLinks: 1, range: 165, jump: 470, speed: 95, dropMax: 190, color: '#e2704a', linkColor: '#f0b48c' } }
const w = new World({ width: 1600, height: 900, gravity: { x: 0, y: 1800 }, entities: [ground, sb('s1', 700, ['s2']), sb('s2', 790, ['s1']), gb] })
const b = w.instances.find((i) => i.type === 'game-ball')
const show = (t) => console.log(`${t}: вес ${b.rt.p.mass}, радиус ${b.rt.p.radius}, летает ${b.rt.p.lift}`)
for (let i = 0; i < 60; i++) w.step(1 / 60)
show('спящий  ')
b.rt.asleep = false
for (let i = 0; i < 30; i++) w.step(1 / 60)
show('активный')
b.def.pointer.down(b.rt, b.ctx, { x: b.rt.p.x, y: b.rt.p.y }, b.data)
for (let k = 0; k < 12; k++) { b.def.pointer.move(b.rt, b.ctx, { x: 745, y: 700 }, b.data); w.step(1 / 60) }
b.def.pointer.up(b.rt, b.ctx, { x: 745, y: 700 }, b.data)
for (let i = 0; i < 10; i++) w.step(1 / 60)
show('в связке')
const sh = b.def.shapes(b.data, b.rt)
console.log('прозрачность тела в фигурах:', sh.filter((x) => x.k === 'circle' && x.opacity).slice(-1)[0]?.opacity)
