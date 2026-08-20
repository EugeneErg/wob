import { Physics } from '../src/core/solver.js'
// шар скатывается по склону 30°
function roll(smooth) {
  const ph = new Physics({ gravity: { x: 0, y: 1800 } })
  ph.addCollider({ points: [[0, 300], [1200, 993], [1200, 1400], [0, 1400]], smoothness: smooth, restitution: 0.05 })
  const p = ph.addPoint({ x: 100, y: 340, radius: 13, mass: 1, smoothness: 0.55, restitution: 0.12, collision: { world: true, points: false } })
  for (let i = 0; i < 120; i++) ph.step(1 / 60)
  return Math.hypot(p.vx, p.vy)
}
// склон 30°, tg = 0.577. Трение кулоново: µ = 1 − средняя гладкость,
// поэтому шершавый склон держит шар, а скользкий даёт разгон.
for (const s of [0.1, 0.35, 0.6, 0.9]) {
  const mu = 1 - (s + 0.55) / 2
  console.log(`гладкость ${s} (µ=${mu.toFixed(2)}): через 2 c = ${roll(s).toFixed(0)} px/с ${mu > 0.577 ? '— держит' : '— скатывается'}`)
}
