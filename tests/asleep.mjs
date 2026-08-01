import '../src/entities/index.js'
import { World } from '../src/core/world.js'
const ground = { id: 'g', type: 'terrain', data: { points: [[0, 780], [1600, 780], [1600, 900], [0, 900]], smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } }
const sb = (id, x, links) => ({ id, type: 'system-ball', data: { x, y: 763, r: 17, static: true, links, color: '#d8cbb0', linkColor: '#b9ae95' } })
const gb = (id, x, y, extra = {}) => ({ id, type: 'game-ball', data: { x, y, r: 13, builtR: 13, mass: 1, builtMass: 1, anchorable: true, asleep: false, minLinks: 2, maxLinks: 3, range: 165, jump: 470, speed: 95, dropMax: 190, color: '#e2704a', linkColor: '#f0b48c', ...extra } })

const w = new World({ width: 1600, height: 900, gravity: { x: 0, y: 1800 },
  entities: [ground, sb('s1', 700, ['s2']), sb('s2', 790, ['s1']), gb('sleep', 1000, 700, { asleep: true }), gb('act', 300, 700)] })
const run = (n) => { for (let i = 0; i < n; i++) w.step(1 / 60) }
const sleeper = w.instances.find((i) => i.id === 'sleep')
run(180)
console.log('спящий: спит', sleeper.rt.asleep, '| x', sleeper.rt.p.x.toFixed(0), '(старт 1000, конструкция на 700..790 — не пошёл)')
console.log('схватить спящего:', w.pointerDown({ x: sleeper.rt.p.x, y: sleeper.rt.p.y }), '(должно быть false)')

// тянем конструкцию к нему: строим шар рядом со спящим
const act = w.instances.find((i) => i.id === 'act')
w.pointerDown({ x: act.rt.p.x, y: act.rt.p.y })
for (let k = 0; k < 12; k++) { w.pointerMove({ x: 745, y: 700 }); w.step(1 / 60) }
w.pointerUp({ x: 745, y: 700 })
run(30)
console.log('спящий всё ещё спит:', sleeper.rt.asleq === undefined ? sleeper.rt.asleep : '')

// подносим конструкцию вплотную: двигаем спящего к опоре руками нельзя, поэтому двигаем опору
const s2 = w.instances.find((i) => i.id === 's2')
for (let k = 0; k < 200; k++) { s2.rt.p.x += 1.3; w.step(1 / 60) }
console.log('после того как конструкция дошла: спит', sleeper.rt.asleep, '| состояние', sleeper.rt.state)
