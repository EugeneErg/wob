import { Physics } from '../src/core/solver.js'
function hang(n, mass) {
  const ph = new Physics({ gravity: { x: 0, y: 1800 } })
  let prev = ph.addPoint({ x: 400, y: 100, pinned: true })
  const links = []
  for (let i = 1; i <= n; i++) {
    const p = ph.addPoint({ x: 400, y: 100 + i * 40, mass, collision: { world: false, points: false } })
    links.push(ph.addLink(prev, p, { spring: 2600, damping: 0.25, breakForce: 26000 }))
    prev = p
  }
  for (let i = 0; i < 60 * 6; i++) ph.step(1 / 60)
  const l = links[0]
  const d = Math.hypot(l.a.x - l.b.x, l.a.y - l.b.y)
  return { ext: d - 40, ten: l.tension, left: ph.links.length, n }
}
console.log('провисание верхней связи (ожидаем ~0.69 px на каждый вес):')
for (const n of [1, 2, 4, 6]) {
  const r = hang(n, 1)
  console.log(`  ${n} шаров (m=1): растяжение ${r.ext.toFixed(2)} px, натяжение ${r.ten.toFixed(0)} (вес = ${n * 1800})`)
}
const h = hang(2, 4)
console.log(`  2 шара (m=4): растяжение ${h.ext.toFixed(2)} px, натяжение ${h.ten.toFixed(0)}`)
console.log('разрыв:')
for (const [n, m] of [[8, 1], [16, 1], [20, 1], [4, 4], [2, 8]]) {
  const r = hang(n, m)
  console.log(`  ${n} шаров (m=${m}): связей ${n} → ${r.left}`)
}
