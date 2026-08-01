import './src/entities/index.js'
import { World } from './src/core/world.js'
import { readFileSync } from 'fs'
const lvl = JSON.parse(readFileSync('./src/levels/tower.json', 'utf8'))
const w = new World(structuredClone(lvl))
const run = (n) => { for (let i = 0; i < n; i++) w.step(1 / 60) }
const balls = () => w.instances.filter((x) => x.type === 'game-ball')
run(60)
for (const [i, y] of [700, 655, 610, 560, 510, 460, 410, 360].entries()) {
  const b = balls().filter((q) => q.rt.state === 'free').sort((a, c) => a.rt.p.x - c.rt.p.x)[0]
  if (!b) break
  w.pointerDown({ x: b.rt.p.x, y: b.rt.p.y })
  const x = 745 + (i % 2 ? 28 : -28)
  w.pointerMove({ x, y }); w.pointerUp({ x, y })
  run(30)
}
const t0 = performance.now()
const n0 = w.physics.links.length
const top0 = Math.min(...balls().filter(b => b.rt.state === 'built').map(b => b.rt.p.y))
for (let t = 0; t < 30; t++) {
  run(60)
  const built = balls().filter((b) => b.rt.state === 'built')
  const tmax = Math.max(0, ...w.physics.links.map((l) => l.tension))
  if (t < 8 || w.physics.links.length !== n0) console.log(`  t=${t + 1}c связей ${w.physics.links.length}, в конструкции ${built.length}, макс натяжение ${tmax.toFixed(0)}`)
}
const top1 = Math.min(...balls().filter(b => b.rt.state === 'built').map(b => b.rt.p.y))
console.log(`башня из ${balls().filter(b=>b.rt.state==='built').length} шаров: связей ${n0} → ${w.physics.links.length}`)
console.log(`верхушка ${top0.toFixed(0)} → ${top1.toFixed(0)} (просадка ${(top1-top0).toFixed(1)} px за 30 c)`)
console.log(`производительность: ${((performance.now()-t0)/1800).toFixed(2)} мс/кадр при ${w.physics.points.length} точках`)
