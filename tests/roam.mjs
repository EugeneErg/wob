import '../src/entities/index.js'
import { World } from '../src/core/world.js'
import { readFileSync } from 'fs'
const lvl = JSON.parse(readFileSync(new URL('../src/levels/tower.json', import.meta.url), 'utf8'))
const w = new World(structuredClone(lvl))
const balls = () => w.instances.filter((x) => x.type === 'game-ball')
for (let t = 0; t < 12; t++) {
  for (let i = 0; i < 60; i++) w.step(1 / 60)
  const b = balls()
  const st = {}
  for (const q of b) st[q.rt.state] = (st[q.rt.state] || 0) + 1
  const moving = b.filter((q) => Math.abs(q.rt.p.x - q.rt.p.px) * 120 > 3).length
  console.log(`t=${t + 1}c шаров ${b.length} ${JSON.stringify(st)} движутся ${moving}, x ${Math.min(...b.map(q=>q.rt.p.x)).toFixed(0)}..${Math.max(...b.map(q=>q.rt.p.x)).toFixed(0)}`)
}
