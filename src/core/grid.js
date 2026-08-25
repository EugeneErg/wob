// Индекс границы области: «какое ребро ближе всего» и «внутри ли точка».
// У песка после раскопки колец бывает на сотни вершин, и перебирать их для
// каждой точки нельзя.
//
// Индекс честно возвращает надмножество кандидатов: может отдать лишнее (хеш
// допускает совпадение ячеек), но не может потерять нужное. Поэтому проверку
// расстояния делает вызывающий.
//
// Сетка тел живёт отдельно, в core/nsearch.js: у неё другой вопрос и другой
// срок жизни.

import { closestOnSegmentInto, insideRegion } from './geom.js'

const hash = (cx, cy) => (((cx * 92837111) ^ (cy * 689287499)) >>> 0)

// Ниже этого числа вершин индекс не окупается: у рельефа из восьми вершин
// перебор быстрее и, что важнее, буквально тот же.
export const EDGES_MIN = 24

// Индекс границы области. Рёбра разложены по ячейкам своей рамкой, кольца
// пронумерованы — поэтому и «внутри ли» считается тем же самым правилом
// чётности пересечений, только по рёбрам одной строки, а не по всем.
export class EdgeIndex {
  constructor(polys) { this.build(polys) }

  build(polys) {
    const rings = []
    const ringPoly = []
    const ringHole = []
    for (let pi = 0; pi < polys.length; pi++) {
      for (let ri = 0; ri < polys[pi].length; ri++) {
        rings.push(polys[pi][ri]); ringPoly.push(pi); ringHole.push(ri > 0)
      }
    }
    let n = 0
    for (const r of rings) n += r.length
    const sx = new Float64Array(n), sy = new Float64Array(n)
    const ex = new Float64Array(n), ey = new Float64Array(n)
    const ring = new Int32Array(n), idx = new Int32Array(n)
    let k = 0
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let g = 0; g < rings.length; g++) {
      const r = rings[g]
      for (let i = 0; i < r.length; i++) {
        const a = r[i], b = r[(i + 1) % r.length]
        sx[k] = a[0]; sy[k] = a[1]; ex[k] = b[0]; ey[k] = b[1]
        ring[k] = g; idx[k] = i
        if (a[0] < minX) minX = a[0]; if (a[0] > maxX) maxX = a[0]
        if (a[1] < minY) minY = a[1]; if (a[1] > maxY) maxY = a[1]
        k++
      }
    }
    this.sx = sx; this.sy = sy; this.ex = ex; this.ey = ey
    this.ring = ring; this.idx = idx
    this.rings = rings; this.ringPoly = ringPoly; this.ringHole = ringHole
    this.n = n
    this.span = Math.max(maxX - minX, maxY - minY) || 1
    this.cell = Math.max(8, this.span / 64)
    this.cx0 = Math.floor(minX / this.cell) - 1
    this.cx1 = Math.floor(maxX / this.cell) + 1
    this.buckets = new Map()
    this.mark = new Int32Array(n).fill(-1)
    this.q = 0
    this.cross = new Int32Array(rings.length)
    this._seg = { x: 0, y: 0, t: 0 }
    this._out = { q: { x: 0, y: 0, t: 0 }, d: 0, edge: 0, t: 0 }
    const c = this.cell
    for (let e = 0; e < n; e++) {
      const x0 = Math.floor(Math.min(sx[e], ex[e]) / c), x1 = Math.floor(Math.max(sx[e], ex[e]) / c)
      const y0 = Math.floor(Math.min(sy[e], ey[e]) / c), y1 = Math.floor(Math.max(sy[e], ey[e]) / c)
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const key = hash(cx, cy)
          let arr = this.buckets.get(key)
          if (!arr) { arr = []; this.buckets.set(key, arr) }
          arr.push(e)
        }
      }
    }
  }

  // Ближайшая точка границы.
  //
  // limit — до какого расстояния ответ вообще интересен. Тому, кто снаружи,
  // граница дальше собственного радиуса не нужна: он её не касается. Тогда
  // хватает одного просмотра ближних клеток, и это подавляющее большинство
  // вызовов. Расширяться приходится только ради того, кто оказался внутри
  // области: ему нужна настоящая ближайшая граница, чтобы знать глубину.
  closest(x, y, limit = 0) {
    if (limit > 0) {
      const near = this._scan(x, y, limit)
      return near && near.d < limit ? near : null
    }
    let r = this.cell
    for (let t = 0; t < 14; t++) {
      const best = this._scan(x, y, r)
      if (best && best.d <= r) return best
      if (r > this.span * 2) return best || this._all(x, y)
      r *= 2
    }
    return this._all(x, y)
  }

  _scan(x, y, r) {
    const c = this.cell
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c)
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c)
    const q = ++this.q
    const mark = this.mark
    let best = Infinity, bestE = -1, bx = 0, by = 0, bt = 0
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const a = this.buckets.get(hash(cx, cy))
        if (!a) continue
        for (let k = 0; k < a.length; k++) {
          const e = a[k]
          if (mark[e] === q) continue
          mark[e] = q
          const s = closestOnSegmentInto(this._seg, x, y, this.sx[e], this.sy[e], this.ex[e], this.ey[e])
          const d = Math.hypot(x - s.x, y - s.y)
          // при равенстве побеждает ребро с меньшим номером — как при переборе
          if (d < best || (d === best && e < bestE)) { best = d; bestE = e; bx = s.x; by = s.y; bt = s.t }
        }
      }
    }
    if (bestE < 0) return null
    const o = this._out
    o.q.x = bx; o.q.y = by; o.q.t = bt
    o.d = best; o.edge = this.idx[bestE]; o.t = bt
    return o
  }

  _all(x, y) {
    let best = Infinity, bestE = -1, bx = 0, by = 0, bt = 0
    for (let e = 0; e < this.n; e++) {
      const s = closestOnSegmentInto(this._seg, x, y, this.sx[e], this.sy[e], this.ex[e], this.ey[e])
      const d = Math.hypot(x - s.x, y - s.y)
      if (d < best) { best = d; bestE = e; bx = s.x; by = s.y; bt = s.t }
    }
    if (bestE < 0) return null
    return { q: { x: bx, y: by, t: bt }, d: best, edge: this.idx[bestE], t: bt }
  }

  // Внутри ли области: то же правило чётности, что и в geom.insideRegion,
  // но луч встречает только рёбра своей строки ячеек.
  inside(x, y) {
    const c = this.cell
    const cy = Math.floor(y / c)
    const q = ++this.q
    const mark = this.mark
    const cross = this.cross
    cross.fill(0)
    // Луч пускаем вправо — значит и колонки нужны только правее точки.
    // Слева от неё пересечений не считает и сам тест чётности.
    const from = Math.max(this.cx0, Math.floor(x / c))
    for (let cx = from; cx <= this.cx1; cx++) {
      const a = this.buckets.get(hash(cx, cy))
      if (!a) continue
      for (let k = 0; k < a.length; k++) {
        const e = a[k]
        if (mark[e] === q) continue
        mark[e] = q
        const yi = this.sy[e], yj = this.ey[e]
        if ((yi > y) === (yj > y)) continue
        const xi = this.sx[e], xj = this.ex[e]
        if (x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) cross[this.ring[e]]++
      }
    }
    for (let g = 0; g < this.rings.length; g++) {
      if (this.ringHole[g] || !(cross[g] & 1)) continue
      const pi = this.ringPoly[g]
      let hole = false
      for (let h = 0; h < this.rings.length; h++) {
        if (this.ringHole[h] && this.ringPoly[h] === pi && (cross[h] & 1)) { hole = true; break }
      }
      if (!hole) return true
    }
    return false
  }
}

// Одна дверь для всех, кто спрашивает «твёрдо ли здесь»: с индексом или без,
// ответ обязан быть один и тот же.
export const regionHas = (c, x, y) => (c.index ? c.index.inside(x, y) : insideRegion(x, y, c.polys))
