// Широкая фаза: две сетки, чтобы солвер перестал перебирать всё со всем.
//
// Обе устроены одинаково — равномерная сетка ячеек, в каждую сложено то, что
// её задевает своей рамкой. Отвечают они на разные вопросы:
//
//   PointGrid — «кто рядом с этой точкой»: пары для столкновений, а потом
//               и соседи для ядра сглаживания у жидкости;
//   EdgeIndex — «какое ребро области ближе всего» и «внутри ли области точка»:
//               у песка после раскопки колец бывает на сотни вершин, и
//               перебирать их для каждой точки нельзя.
//
// Обе честно возвращают надмножество кандидатов: сетка может отдать лишнее
// (ячейки крупнее тел, хеш допускает совпадения), но не может потерять нужное.
// Поэтому проверку расстояния делает вызывающий — как и делал раньше.

import { closestOnSegmentInto, insideRegion } from './geom.js'

const hash = (cx, cy) => (((cx * 92837111) ^ (cy * 689287499)) >>> 0)

// Ниже этого числа тел перебор всех пар дешевле сетки, и главное — он в
// точности тот же, что был. Мелкие уровни ничего не замечают.
export const PAIRS_MIN = 64
// То же для области: у рельефа из восьми вершин индекс не окупается.
export const EDGES_MIN = 24

export class PointGrid {
  constructor() {
    this.points = []
    this.cell = 16
    this.mask = 0
    this.start = new Int32Array(0)   // начало корзины в items (схема CSR)
    this.items = new Int32Array(0)
    this.cursor = new Int32Array(0)
    this.mark = new Int32Array(0)
    this.q = 0
    this._cand = []
  }

  // Ячейку берём по среднему радиусу: крупное тело просто ляжет в несколько
  // ячеек, а мелкая крошка не заставит перебирать полсцены в одной.
  //
  // Корзины — не словарь, а два целочисленных массива: сначала считаем, сколько
  // в какую попадёт, потом раскладываем. Ни одного объекта за кадр, а кадров с
  // перекладыванием шесть. Хеш допускает совпадение ячеек — от этого в корзине
  // окажется лишнее, но никогда не потеряется нужное, а расстояние всё равно
  // проверяет тот, кто спросил.
  // size — задать размер ячейки прямо. Жидкости нужна ячейка в радиус
  // сглаживания, а не в радиус тела: соседей она ищет заметно дальше.
  build(points, margin = 0, size = 0) {
    this.points = points
    const n = points.length
    let sum = 0
    for (let i = 0; i < n; i++) sum += points[i].radius
    const c = this.cell = size > 0 ? size : Math.max(4, ((n ? sum / n : 8) + margin) * 2)

    let slots = 64
    while (slots < n * 2) slots <<= 1
    if (this.start.length !== slots + 1) {
      this.start = new Int32Array(slots + 1)
      this.cursor = new Int32Array(slots)
    } else this.start.fill(0)
    if (this.mark.length < n) this.mark = new Int32Array(Math.max(n, 64)).fill(-1)
    const mask = this.mask = slots - 1
    const start = this.start

    let total = 0
    for (let i = 0; i < n; i++) {
      const p = points[i]
      const r = p.radius + margin
      const x0 = Math.floor((p.x - r) / c), x1 = Math.floor((p.x + r) / c)
      const y0 = Math.floor((p.y - r) / c), y1 = Math.floor((p.y + r) / c)
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) { start[(hash(cx, cy) & mask) + 1]++; total++ }
      }
    }
    for (let k = 0; k < slots; k++) start[k + 1] += start[k]
    this.cursor.set(start.subarray(0, slots))
    if (this.items.length < total) this.items = new Int32Array(Math.max(total, 256))
    const items = this.items, cursor = this.cursor
    for (let i = 0; i < n; i++) {
      const p = points[i]
      const r = p.radius + margin
      const x0 = Math.floor((p.x - r) / c), x1 = Math.floor((p.x + r) / c)
      const y0 = Math.floor((p.y - r) / c), y1 = Math.floor((p.y + r) / c)
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) items[cursor[hash(cx, cy) & mask]++] = i
      }
    }
  }

  // Индексы тел, чьи рамки задевают круг (x, y, r). Дубли снимаются меткой:
  // одно тело лежит в нескольких ячейках, но кандидатом станет один раз.
  _gather(x, y, r, out, skipUpTo = -1) {
    const c = this.cell, mask = this.mask
    const start = this.start, items = this.items, mark = this.mark
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c)
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c)
    const q = ++this.q
    out.length = 0
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const h = hash(cx, cy) & mask
        for (let k = start[h], e = start[h + 1]; k < e; k++) {
          const j = items[k]
          if (j <= skipUpTo || mark[j] === q) continue
          mark[j] = q
          out.push(j)
        }
      }
    }
    return out
  }

  // Каждая пара ровно один раз. Порядок восстанавливаем сортировкой:
  // проход по парам последовательный (Гаусс — Зейдель), и от порядка зависит
  // результат — а он обязан остаться тем же, что при переборе всех пар.
  pairs(fn, want = null) {
    const pts = this.points
    const cand = this._cand
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      if (!a.collision.points && !a.collision.fluid) continue
      if (want && !want(a)) continue
      this._gather(a.x, a.y, a.radius, cand, i)
      // Вставками, а не sort(): кандидатов единицы, и постоянные расходы
      // библиотечной сортировки тут дороже самой сортировки в разы.
      for (let a2 = 1; a2 < cand.length; a2++) {
        const v = cand[a2]
        let b = a2 - 1
        while (b >= 0 && cand[b] > v) { cand[b + 1] = cand[b]; b-- }
        cand[b + 1] = v
      }
      for (let k = 0; k < cand.length; k++) fn(a, pts[cand[k]])
    }
  }

  // Соседи в радиусе — этим будет пользоваться ядро сглаживания у жидкости
  around(x, y, r, fn) {
    const cand = this._cand
    this._gather(x, y, r, cand)
    const pts = this.points
    const r2 = r * r
    for (let k = 0; k < cand.length; k++) {
      const p = pts[cand[k]]
      const dx = p.x - x, dy = p.y - y
      const d2 = dx * dx + dy * dy
      if (d2 <= r2) fn(p, d2, cand[k])
    }
  }
}

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

// Знаковое расстояние до границы области: внутри отрицательное, снаружи
// положительное. Тем, кто считает доли клеток и граней, нужна не просто
// принадлежность, а расстояние: по нему доля получается точной, и — главное —
// СОГЛАСОВАННОЙ между гранью и клеткой. Пробы такой согласованности не дают:
// грань вдоль самого края камня легко насчитывает «открыта на треть», хотя за
// ней сплошной камень, и решатель видит там свободную поверхность внутри берега.
export function regionDistance(c, x, y, far = 1e6) {
  let d = far
  if (c.index) {
    const near = c.index.closest(x, y)
    if (near) d = near.d
  } else {
    for (const ring of c.rings || []) {
      for (let i = 0, n = ring.length; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n]
        const q = closestOnSegmentInto({ x: 0, y: 0, t: 0 }, x, y, a[0], a[1], b[0], b[1])
        const t = Math.hypot(x - q.x, y - q.y)
        if (t < d) d = t
      }
    }
  }
  return regionHas(c, x, y) ? -d : d
}
