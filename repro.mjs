import './src/entities/index.js'
import { World } from './src/core/world.js'
import { readFileSync } from 'fs'
const lvl = JSON.parse(readFileSync('./src/levels/tower.json', 'utf8'))
const w = new World(structuredClone(lvl))
const run = (n) => { for (let i = 0; i < n; i++) w.step(1 / 60) }
const balls = () => w.instances.filter((x) => x.type === 'game-ball')
const built = () => balls().filter((b) => b.rt.state === 'built')
// дрожь = максимальная скорость точек конструкции
const jitter = () => Math.max(0, ...built().map((b) => Math.hypot(b.rt.p.x - b.rt.p.px, b.rt.p.y - b.rt.p.py) * 120))

run(60)
for (const [i, y] of [700, 660, 620, 580, 540].entries()) {
  const b = balls().filter((q) => q.rt.state === 'free').sort((a, c) => a.rt.p.x - c.rt.p.x)[0]
  if (!b) break
  const x = 745 + (i % 2 ? 26 : -26)
  w.pointerDown({ x: b.rt.p.x, y: b.rt.p.y })
  for (let k = 0; k < 20; k++) { w.pointerMove({ x, y }); w.step(1 / 60) }
  w.pointerUp({ x, y })
  let peak = 0
  for (let k = 0; k < 90; k++) { w.step(1 / 60); peak = Math.max(peak, jitter()) }
  console.log(`шар ${i + 1}: в конструкции ${built().length}, связей ${w.physics.links.length}, пик дрожи ${peak.toFixed(0)} px/с, покой ${jitter().toFixed(1)} px/с`)
}
