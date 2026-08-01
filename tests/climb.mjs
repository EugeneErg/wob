import '../src/entities/index.js'
import { World } from '../src/core/world.js'
import { readFileSync } from 'fs'
const lvl = JSON.parse(readFileSync(new URL('../src/levels/tower.json', import.meta.url), 'utf8'))
const w = new World(structuredClone(lvl))
const balls = () => w.instances.filter((x) => x.type === 'game-ball')
const prev = new Map()
let worst = 0, worstWhen = ''
for (let i = 0; i < 60 * 14; i++) {
  w.step(1 / 60)
  for (const b of balls()) {
    const p = b.rt.p
    const was = prev.get(b.id)
    if (was && b.rt.state !== 'drag') {
      const d = Math.hypot(p.x - was.x, p.y - was.y)
      if (d > worst) { worst = d; worstWhen = `${was.st}→${b.rt.state}` }
    }
    prev.set(b.id, { x: p.x, y: p.y, st: b.rt.state })
  }
}
const st = {}
for (const b of balls()) st[b.rt.state] = (st[b.rt.state] || 0) + 1
console.log('состояния:', JSON.stringify(st))
console.log(`наибольший скачок позиции за кадр: ${worst.toFixed(1)} px (${worstWhen}) — телепорта быть не должно`)
