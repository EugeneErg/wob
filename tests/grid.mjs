// Широкая фаза не имеет права менять ответ — только скорость. Поэтому
// проверяем не «похоже», а совпадение с честным перебором: тот же список пар
// в том же порядке и тот же ответ про границу в каждой пробе.
import { EdgeIndex } from '../src/core/grid.js'
import { HashGrid } from '../src/core/nsearch.js'
import { insideRegion, closestOnSegment } from '../src/core/geom.js'

let seed = 20250805
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }

// ------------------------------------------------------------------ пары тел
// Сетка не имеет права менять ответ — только скорость. Проход по парам
// последовательный (Гаусс — Зейдель), поэтому важен и сам список, и порядок.
{
  const N = 700
  const store = {
    n: N,
    x: new Float32Array(N),
    y: new Float32Array(N),
    radius: new Float32Array(N),
  }
  for (let i = 0; i < N; i++) {
    store.x[i] = rnd() * 1600
    store.y[i] = rnd() * 900
    store.radius[i] = 3 + rnd() * 25
  }
  const ids = new Int32Array(N)
  for (let i = 0; i < N; i++) ids[i] = i

  const hit = (i, j) => {
    const min = store.radius[i] + store.radius[j]
    return !(Math.abs(store.x[j] - store.x[i]) > min || Math.abs(store.y[j] - store.y[i]) > min)
  }

  const brute = []
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) if (hit(i, j)) brute.push(i + ':' + j)
  }

  let sum = 0
  for (let i = 0; i < N; i++) sum += store.radius[i]
  const g = new HashGrid()
  g.build(store, ids, ((sum / N) + 6) * 2, null, 6)

  const got = []
  const cand = []
  for (let a = 0; a < N; a++) {
    g.gather(store.x[a], store.y[a], store.radius[a], cand, a)
    for (let u = 1; u < cand.length; u++) {
      const v = cand[u]
      let b = u - 1
      while (b >= 0 && cand[b] > v) { cand[b + 1] = cand[b]; b-- }
      cand[b + 1] = v
    }
    for (let u = 0; u < cand.length; u++) if (hit(a, cand[u])) got.push(a + ':' + cand[u])
  }

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
