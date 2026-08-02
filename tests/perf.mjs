import '../src/entities/index.js'
import { World } from '../src/core/world.js'
import { readFileSync } from 'fs'
for (const f of ['tower', 'bridge', 'lift', 'dig']) {
  const level = JSON.parse(readFileSync(new URL(`../src/levels/${f}.json`, import.meta.url), 'utf8'))
  const w = new World(structuredClone(level))
  const t0 = performance.now()
  for (let i = 0; i < 60 * 20; i++) w.step(1 / 60)
  console.log(`${f}: ${((performance.now() - t0) / 1200).toFixed(2)} мс/кадр, точек ${w.physics.points.length}`)
}
