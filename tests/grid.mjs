// Широкая фаза не имеет права менять ответ — только скорость. Поэтому
// проверяем не «похоже», а совпадение с честным перебором: тот же список пар
// в том же порядке и тот же ответ про границу в каждой пробе.
import { PointGrid, EdgeIndex } from '../src/core/grid.js'
import { insideRegion, closestOnSegment } from '../src/core/geom.js'

let seed = 20250805
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }

// ------------------------------------------------------------------ пары тел
{
  const pts = []
  for (let i = 0; i < 700; i++) {
    pts.push({ x: rnd() * 1600, y: rnd() * 900, radius: 3 + rnd() * 25, collision: { points: rnd() > 0.05 } })
  }
  const brute = []
  for (let i = 0; i < pts.length; i++) {
    if (!pts[i].collision.points) continue
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i], b = pts[j]
      const min = a.radius + b.radius
      if (Math.abs(b.x - a.x) > min || Math.abs(b.y - a.y) > min) continue
      brute.push(i + ':' + j)
    }
  }
  const g = new PointGrid()
  g.build(pts)
  const idx = new Map(pts.map((p, i) => [p, i]))
  const got = []
  g.pairs((a, b) => {
    const min = a.radius + b.radius
    if (Math.abs(b.x - a.x) > min || Math.abs(b.y - a.y) > min) return
    got.push(idx.get(a) + ':' + idx.get(b))
  })
  console.log('=== пары тел ===')
  console.log(`перебор нашёл ${brute.length} пар, сетка — ${got.length}`)
  console.log(`списки совпали, включая порядок: ${brute.join() === got.join()}`)
}

// ------------------------------------------------------------------- граница
{
  // кольцо с изрезанным краем и дыркой внутри — как песок после раскопки
  const outer = [], hole = []
  for (let i = 0; i < 360; i++) {
    const t = (i / 360) * Math.PI * 2
    const r = 300 + Math.sin(t * 13) * 45
    outer.push([800 + Math.cos(t) * r, 500 + Math.sin(t) * r * 0.6])
  }
  for (let i = 0; i < 40; i++) {
    const t = (i / 40) * Math.PI * 2
    hole.push([700 + Math.cos(t) * 70, 470 + Math.sin(t) * 50])
  }
  const polys = [[outer, hole]]
  const rings = [outer, hole]
  const ix = new EdgeIndex(polys)

  const bruteClosest = (x, y) => {
    let best = Infinity
    for (const ring of rings) {
      for (let i = 0, n = ring.length; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n]
        const s = closestOnSegment(x, y, a[0], a[1], b[0], b[1])
        const d = Math.hypot(x - s.x, y - s.y)
        if (d < best) best = d
      }
    }
    return best
  }

  let insideSame = 0, closestSame = 0, limitSame = 0, n = 3000
  for (let k = 0; k < n; k++) {
    const x = 400 + rnd() * 800, y = 150 + rnd() * 700
    if (ix.inside(x, y) === insideRegion(x, y, polys)) insideSame++
    const d = bruteClosest(x, y)
    if (Math.abs(ix.closest(x, y).d - d) < 1e-9) closestSame++
    // с ограничением ответ либо тот же, либо честное «дальше, чем просили»
    const lim = 12
    const near = ix.closest(x, y, lim)
    if (near ? Math.abs(near.d - d) < 1e-9 && d < lim : d >= lim) limitSame++
  }
  console.log('\n=== граница области (кольцо 360 вершин + дырка 40) ===')
  console.log(`«внутри ли» совпало с перебором: ${insideSame}/${n}`)
  console.log(`ближайшая точка границы совпала:  ${closestSame}/${n}`)
  console.log(`поиск с ограничением совпал:      ${limitSame}/${n}`)
}
