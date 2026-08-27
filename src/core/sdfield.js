// Поле знаковых расстояний до статической геометрии.
//
// Зачем. Спросить у полигона «внутри ли я и далеко ли до края» стоит дорого:
// проверка принадлежности плюс поиск ближайшего ребра. Частиц среды тысячи, и
// каждая спрашивает на каждой итерации — замерено 6.3 мс за кадр только на
// проверку «внутри ли». Между тем рельеф почти всегда неподвижен, и ответ для
// каждой точки пространства не меняется, пока его не выкопают.
//
// Поэтому считаем ответ заранее, по сетке, и потом читаем за две операции.
// Пересчитываем только когда геометрия изменилась — мир об этом сообщает сам,
// увеличивая метку коллайдера.
//
// Точность. Расстояние в узлах точное, между узлами — линейная прокладка.
// Ошибка при шаге 8 px держится доли пикселя всюду, кроме острых углов, где
// поле по природе своей изломано.

import { regionHas } from './grid.js'

const unite = (a, b) => ({
  x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
  w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x),
  h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y),
})
const countStatic = (cols) => {
  let n = 0
  for (const c of cols) if (!c.dynamic && !c.removed) n++
  return n
}
import { closestOnSegmentInto } from './geom.js'

const seg = { x: 0, y: 0, t: 0 }

export class StaticField {
  constructor(cell = 8) {
    this.cell = cell
    this.ready = false
    this.key = ''
  }

  // Строка-отпечаток статической геометрии: пока она та же, поле годится.
  static keyOf(colliders) {
    let k = ''
    for (const c of colliders) {
      if (c.dynamic || c.removed) continue
      k += c.id + ':' + (c.stamp || 0) + ';'
    }
    return k
  }

  // Пересобрать, если геометрия изменилась. Возвращает true, если полем можно
  // пользоваться.
  sync(colliders, bounds, maxDist) {
    const key = StaticField.keyOf(colliders)
    if (this.ready && key === this.key) return true

    // Копают пятачок под курсором, а не всё тело. Если каждый изменившийся
    // сказал, ГДЕ он изменился, пересчитываем только эту область — иначе при
    // копании поле собиралось бы заново каждый кадр, а это 40 мс.
    let patch = null, partial = this.ready
    if (partial) {
      for (const c of colliders) {
        if (c.dynamic || c.removed) continue
        if ((c.stamp || 0) === (this._stamps && this._stamps.get(c.id))) continue
        if (!c.dirty) { partial = false; break }
        patch = patch ? unite(patch, c.dirty) : { ...c.dirty }
      }
      // Тело могли и добавить, и убрать — тогда область неизвестна.
      if (partial && this._stamps && this._stamps.size !== countStatic(colliders)) partial = false
    }

    this.key = key
    if (partial && patch) this.rebuild(colliders, patch)
    else this.build(colliders, bounds, maxDist)

    this._stamps = new Map()
    for (const c of colliders) {
      if (c.dynamic || c.removed) continue
      this._stamps.set(c.id, c.stamp || 0)
      c.dirty = null
    }
    return this.ready
  }

  // Пересчитать поле в прямоугольнике. Расширяем его на far: дальше этого
  // расстояние измениться не могло — там оно и так упёрлось в потолок.
  rebuild(colliders, rect) {
    this.stat = colliders.filter((c) => !c.dynamic && !c.removed && c.rings && c.rings.length)
    if (!this.stat.length) { this.ready = false; return }
    const cell = this.cell, far = this.far
    const i0 = Math.max(0, Math.floor((rect.x - far - this.x0) / cell))
    const i1 = Math.min(this.nx - 1, Math.ceil((rect.x + rect.w + far - this.x0) / cell))
    const j0 = Math.max(0, Math.floor((rect.y - far - this.y0) / cell))
    const j1 = Math.min(this.ny - 1, Math.ceil((rect.y + rect.h + far - this.y0) / cell))
    const d = this.d, inside = this.in, nx = this.nx
    for (let j = j0; j <= j1; j++) {
      const y = this.y0 + j * cell
      for (let i = i0; i <= i1; i++) {
        const x = this.x0 + i * cell
        const k = j * nx + i
        let hit = 0
        for (const c of this.stat) { if (regionHas(c, x, y)) { hit = 1; break } }
        inside[k] = hit
        const dd = Math.min(far, this._exact(x, y))
        const c = this._hit
        this.sm[k] = c ? (c.smoothness ?? 0.5) : 0.5
        this.rs[k] = c ? (c.restitution ?? 0.2) : 0.2
        d[k] = hit ? -dd : dd
      }
    }
  }

  build(colliders, bounds, maxDist) {
    const stat = colliders.filter((c) => !c.dynamic && !c.removed && c.rings && c.rings.length)
    this.stat = stat
    if (!stat.length) { this.ready = false; return }

    let cell = this.cell
    const pad = cell * 2
    const x0 = bounds.x - pad, y0 = bounds.y - pad
    let nx = Math.ceil((bounds.w + pad * 2) / cell) + 1
    let ny = Math.ceil((bounds.h + pad * 2) / cell) + 1
    // Потолок на число клеток. Рамка приходит снаружи, и если она вдруг
    // окажется огромной — например, геометрия уехала за пределы мира, — сетка
    // без этого разрастётся до сотен мегабайт, и сборка встанет на секунды.
    // Лучше загрубить шаг, чем повесить кадр.
    const MAX = 200000
    if (nx * ny > MAX) {
      const k = Math.sqrt((nx * ny) / MAX)
      cell *= k
      nx = Math.ceil((bounds.w + pad * 2) / cell) + 1
      ny = Math.ceil((bounds.h + pad * 2) / cell) + 1
    }
    this.cell = cell
    this.x0 = x0; this.y0 = y0; this.nx = nx; this.ny = ny
    this.far = maxDist + cell * 2

    const n = nx * ny
    if (!this.d || this.d.length < n) {
      this.d = new Float32Array(n); this.in = new Uint8Array(n)
      // Свойства ближайшей поверхности: трение и упругость зависят от того, обо
      // что именно частица трётся, а поле иначе этого не знает.
      this.sm = new Float32Array(n); this.rs = new Float32Array(n)
    }
    const d = this.d, inside = this.in
    d.fill(this.far, 0, n)

    // 1. внутри или снаружи
    for (let j = 0; j < ny; j++) {
      const y = y0 + j * cell
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * cell
        let hit = 0
        for (const c of stat) { if (regionHas(c, x, y)) { hit = 1; break } }
        inside[j * nx + i] = hit
      }
    }

    // 2. точное расстояние в каждой клетке. Пробовал считать точно только у
    //    границы, а дальше разносить по сетке приближённо — средняя ошибка
    //    выходила 3.2 px при радиусе частицы 5.5, то есть негодная. Клеток
    //    немного, а пересобирается поле только когда рельеф изменился.
    for (let j = 0; j < ny; j++) {
      const y = y0 + j * cell
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i
        const dd = this._exact(x0 + i * cell, y)
        d[k] = Math.min(this.far, dd)
        const c = this._hit
        this.sm[k] = c ? (c.smoothness ?? 0.5) : 0.5
        this.rs[k] = c ? (c.restitution ?? 0.2) : 0.2
      }
    }

    // 3. знак
    for (let k = 0; k < n; k++) if (inside[k]) d[k] = -d[k]
    this.ready = true
  }

  // Точное расстояние до ближайшего ребра статической геометрии.
  _exact(x, y) {
    let best = Infinity
    this._hit = null
    for (const c of this.stat) {
      const b = c.bbox
      if (b) {
        const dx = Math.max(b.x - x, 0, x - (b.x + b.w))
        const dy = Math.max(b.y - y, 0, y - (b.y + b.h))
        if (dx * dx + dy * dy >= best * best) continue
      }
      if (c.index) {
        // Ограничиваем поиск: дальше far расстояние всё равно упрётся в
        // потолок. Без ограничения запрос обходит ВСЁ тело, и на исковерянном
        // копанием песке с сотнями дырок сборка поля растягивается на секунды.
        const near = c.index.closest(x, y, best < this.far ? best : this.far)
        if (near && near.d < best) { best = near.d; this._hit = c }
        continue
      }
      for (const ring of c.rings) {
        for (let k = 0, m = ring.length; k < m; k++) {
          const a = ring[k], bb = ring[(k + 1) % m]
          closestOnSegmentInto(seg, x, y, a[0], a[1], bb[0], bb[1])
          const dd = Math.hypot(x - seg.x, y - seg.y)
          if (dd < best) { best = dd; this._hit = c }
        }
      }
    }
    return best === Infinity ? this.far : best
  }

  // Знаковое расстояние и нормаль наружу. out = [d, nx, ny].
  sample(x, y, out) {
    const cell = this.cell, nx = this.nx, ny = this.ny, d = this.d
    const fx = (x - this.x0) / cell, fy = (y - this.y0) / cell
    let i = fx | 0, j = fy | 0
    if (i < 0) i = 0; else if (i > nx - 2) i = nx - 2
    if (j < 0) j = 0; else if (j > ny - 2) j = ny - 2
    const tx = fx - i, ty = fy - j
    const k = j * nx + i
    const d00 = d[k], d10 = d[k + 1], d01 = d[k + nx], d11 = d[k + nx + 1]
    const a = d00 + (d10 - d00) * tx
    const b = d01 + (d11 - d01) * tx
    out[0] = a + (b - a) * ty
    // Нормаль — направление роста расстояния, то есть прочь от тела.
    const gx = (d10 - d00) * (1 - ty) + (d11 - d01) * ty
    const gy = (d01 - d00) * (1 - tx) + (d11 - d10) * tx
    const l = Math.hypot(gx, gy)
    if (l < 1e-9) { out[1] = 0; out[2] = -1 } else { out[1] = gx / l; out[2] = gy / l }
    out[3] = this.sm[k]; out[4] = this.rs[k]
    return out[0]
  }
}
