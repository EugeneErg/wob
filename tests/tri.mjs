import { Physics } from '../src/core/verlet.js'
// треугольник из трёх динамических шаров стоит на земле
const ph = new Physics({ gravity: { x: 0, y: 1800 } })
ph.addCollider({ points: [[0, 700], [1200, 700], [1200, 900], [0, 900]], smoothness: 0.35, restitution: 0.05 })
const mk = (x, y) => ph.addPoint({ x, y, radius: 13, mass: 1, smoothness: 0.55, restitution: 0.12, collision: { world: true, points: false } })
const a = mk(500, 687), b = mk(570, 687), c = mk(535, 626)
const L = (p, q) => ph.addLink(p, q, { spring: 1600, damping: 0.25, breakForce: 26000 })
const ls = [L(a, b), L(b, c), L(a, c)]
const base = () => Math.hypot(a.x - b.x, a.y - b.y)
const top = () => c.y
console.log(`старт: основание ${base().toFixed(1)}, верхушка ${top().toFixed(1)}`)
for (let t = 0; t < 6; t++) {
  for (let i = 0; i < 60; i++) ph.step(1 / 60)
  console.log(`t=${t + 1}c основание ${base().toFixed(1)} (было 70), верхушка ${top().toFixed(1)} (было 626), связей ${ph.links.length}`)
}
