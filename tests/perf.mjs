import '../src/entities/index.js'
import { World } from '../src/core/world.js'
import { level } from './level.mjs'
for (const f of ['tower', 'bridge', 'lift', 'dig']) {
  const w = new World(level(`lvl-${f}`))
  const t0 = performance.now()
  for (let i = 0; i < 60 * 20; i++) w.step(1 / 60)
  console.log(`${f}: ${((performance.now() - t0) / 1200).toFixed(2)} мс/кадр, точек ${w.physics.points.length}`)
}
