import './src/entities/index.js'
import { World } from './src/core/world.js'
import { readFileSync } from 'fs'
const lvl = JSON.parse(readFileSync('./src/levels/tower.json', 'utf8'))
const w = new World(structuredClone(lvl))
const run = (n) => { for (let i = 0; i < n; i++) w.step(1 / 60) }
const balls = () => w.instances.filter((x) => x.type === 'game-ball')
run(60)
for (const [i, y] of [700, 655, 610, 560].entries()) {
  const b = balls().filter((q) => q.rt.state === 'free').sort((a, c) => a.rt.p.x - c.rt.p.x)[0]
  w.pointerDown({ x: b.rt.p.x, y: b.rt.p.y })
  w.pointerMove({ x: 745 + (i % 2 ? 26 : -26), y }); w.pointerUp({ x: 745 + (i % 2 ? 26 : -26), y })
  run(35)
}
run(60)
const top = balls().filter((b) => b.rt.state === 'built').sort((a, c) => a.rt.p.y - c.rt.p.y)[0]
console.log('верхний шар pinned:', top.rt.p.pinned, '| масса:', top.rt.p.mass)
const y0 = top.rt.p.y, x0 = top.rt.p.x
run(120)
console.log('дрейф за 2 c без нагрузки:', Math.hypot(top.rt.p.x - x0, top.rt.p.y - y0).toFixed(2), 'px')

// подвешиваем груз на верхушку
const load = balls().filter((b) => b.rt.state !== 'built')[0]
load.data.mass = 6; load.rt.p.mass = 6
w.pointerDown({ x: load.rt.p.x, y: load.rt.p.y })
w.pointerMove({ x: top.rt.p.x + 40, y: top.rt.p.y - 10 })
w.pointerUp({ x: top.rt.p.x + 40, y: top.rt.p.y - 10 })
run(180)
console.log('после груза m=6: верхушка сместилась на', Math.hypot(top.rt.p.x - x0, top.rt.p.y - y0).toFixed(1), 'px | связей', w.physics.links.length)
console.log('натяжения:', w.physics.links.map((l) => l.tension.toFixed(2)).join(' '))
