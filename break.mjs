import { Physics } from './src/core/verlet.js'
function hang(n, mass) {
  const ph = new Physics({ gravity: { x: 0, y: 1800 } })
  let prev = ph.addPoint({ x: 400, y: 100, pinned: true })
  for (let i = 1; i <= n; i++) {
    const p = ph.addPoint({ x: 400, y: 100 + i * 40, mass, collision: { world: false, points: false } })
    ph.addLink(prev, p, { spring: 2600, damping: 0.25, breakForce: 26000 })
    prev = p
  }
  const before = ph.links.length
  for (let i = 0; i < 60 * 6; i++) ph.step(1 / 60)
  return `${n} шаров (m=${mass}): связей ${before} → ${ph.links.length}`
}
for (const n of [4, 8, 10, 12, 16]) console.log(hang(n, 1))
console.log(hang(4, 3))
console.log(hang(2, 8))
