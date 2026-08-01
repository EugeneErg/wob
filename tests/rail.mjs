import '../src/entities/index.js'
import { World } from '../src/core/world.js'
import { closestOnSegment } from '../src/core/geom.js'

const ground = { id: 'g', type: 'terrain', data: { points: [[0, 780], [1600, 780], [1600, 900], [0, 900]], smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } }
const sb = (id, x, links) => ({ id, type: 'system-ball', data: { x, y: 720, r: 17, static: true, links, color: '#d8cbb0', linkColor: '#b9ae95' } })
const gb = (id, x) => ({ id, type: 'game-ball', data: { x, y: 700, r: 13, builtR: 13, mass: 1, builtMass: 1, anchorable: true, asleep: false, minLinks: 2, maxLinks: 3, range: 165, jump: 470, speed: 95, dropMax: 190, color: '#e2704a', linkColor: '#f0b48c' } })

// длинная связь между двумя закреплёнными опорами — на неё залезают шары
function run(nBalls) {
  const ents = [ground, sb('s1', 620, ['s2']), sb('s2', 900, ['s1']), gb('hang', 400)]
  for (let i = 0; i < nBalls; i++) ents.push(gb('b' + i, 200 + i * 45))
  const w = new World({ width: 1600, height: 900, gravity: { x: 0, y: 1800 }, entities: ents })
  const step = (n) => { for (let i = 0; i < n; i++) w.step(1 / 60) }
  step(60)
  // подвешиваем шар между опорами — вот он и будет проседать под ходоками
  const hang = w.instances.find((i) => i.id === 'hang')
  const P = hang.def.pointer, drop = { x: 760, y: 752 }
  P.down(hang.rt, hang.ctx, { x: hang.rt.p.x, y: hang.rt.p.y }, hang.data)
  for (let k = 0; k < 12; k++) { P.move(hang.rt, hang.ctx, drop, hang.data); w.step(1 / 60) }
  P.up(hang.rt, hang.ctx, drop, hang.data)
  step(60 * 24)
  const balls = w.instances.filter((i) => i.type === 'game-ball' && i.id !== 'hang')
  const link = hang.rt.links[0]
  // насколько ходок отклоняется от оси связи, по которой идёт
  const off = balls.filter((b) => b.rt.state === 'walk' && b.rt.walk?.link).map((b) => {
    const l = b.rt.walk.link
    const q = closestOnSegment(b.rt.p.x, b.rt.p.y, l.a.x, l.a.y, l.b.x, l.b.y)
    return Math.hypot(b.rt.p.x - q.x, b.rt.p.y - q.y)
  })
  return { walkers: off.length, off: off.length ? Math.max(...off) : 0, tension: link ? link.tension : 0, y: hang.rt.p.y }
}
const a = run(0), b = run(6)
console.log(`без ходоков:  подвешенный шар y=${a.y.toFixed(1)}, натяжение связи ${a.tension.toFixed(0)}`)
console.log(`с ходоками:   на связях ${b.walkers}, шар y=${b.y.toFixed(1)}, натяжение ${b.tension.toFixed(0)}`)
console.log(`просадка от ходоков ${(b.y - a.y).toFixed(1)} px | отклонение от оси связи ${b.off.toFixed(2)} px (должно быть ~0)`)
