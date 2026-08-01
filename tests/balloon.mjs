import '../src/entities/index.js'
import { World } from '../src/core/world.js'

const ground = { id: 'g', type: 'terrain', data: { points: [[0, 780], [1600, 780], [1600, 900], [0, 900]], smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } }
const sb = (id, x, links) => ({ id, type: 'system-ball', data: { x, y: 763, r: 17, static: true, links, color: '#d8cbb0', linkColor: '#b9ae95' } })
const balloon = (id, x) => ({ id, type: 'game-ball', data: { x, y: 700, r: 12, builtR: 26, mass: 1, builtMass: -5, anchorable: false, minLinks: 1, maxLinks: 1, range: 165, jump: 470, speed: 95, dropMax: 190, color: '#9ad0e8', linkColor: '#cfe9f5' } })
const goo = (id, x) => ({ id, type: 'game-ball', data: { x, y: 700, r: 13, builtR: 13, mass: 1, builtMass: 1, anchorable: true, minLinks: 2, maxLinks: 3, range: 165, jump: 470, speed: 95, dropMax: 190, color: '#e2704a', linkColor: '#f0b48c' } })

const w = new World({ width: 1600, height: 900, gravity: { x: 0, y: 1800 },
  entities: [ground, sb('s1', 700, ['s2']), sb('s2', 790, ['s1']), balloon('bal', 300), goo('g1', 1100), goo('g2', 1200)] })
const run = (n) => { for (let i = 0; i < n; i++) w.step(1 / 60) }
const bal = w.instances.find((i) => i.id === 'bal')

run(120)
console.log(`свободный шарик: вес ${bal.rt.p.mass}, радиус ${bal.rt.p.radius}, летает ${bal.rt.p.lift}, состояние ${bal.rt.state}`)
const yFree = bal.rt.p.y

// цепляем к конструкции
w.pointerDown({ x: bal.rt.p.x, y: bal.rt.p.y })
for (let k = 0; k < 12; k++) { w.pointerMove({ x: 745, y: 690 }); w.step(1 / 60) }
w.pointerUp({ x: 745, y: 690 })
run(10)
console.log(`в конструкции: вес ${bal.rt.p.mass}, радиус ${bal.rt.p.radius}, летает ${bal.rt.p.lift}, связей ${bal.rt.p.links.length}, цепляться можно: ${bal.rt.p.attachable}`)
run(180)
console.log(`шарик поднялся с ${yFree.toFixed(0)} до ${bal.rt.p.y.toFixed(0)}`)

// по связям шарика ползать нельзя — обычные шары идут только к опорам
run(60 * 10)
const others = w.instances.filter((i) => i.type === 'game-ball' && i.id !== 'bal')
console.log('обычные шары:', others.map((o) => `${o.id}:${o.rt.state}`).join(' '))
const onBalloon = others.filter((o) => o.rt.walk && (o.rt.walk.link.a === bal.rt.p || o.rt.walk.link.b === bal.rt.p)).length
console.log('ползут по связи шарика:', onBalloon, '(должно быть 0)')

// отцепим — вес должен вернуться
for (const l of [...bal.rt.p.links]) w.physics.removeLink(l)
run(20)
console.log(`после отцепления: вес ${bal.rt.p.mass}, радиус ${bal.rt.p.radius}, летает ${bal.rt.p.lift}, состояние ${bal.rt.state}`)
