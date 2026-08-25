// Контакты: тело — тело и тело — область.
//
// Позиционная часть живёт внутри цикла проекции, скоростная — после него.
// Разделение принципиальное. Пока контакт с землёй «сохранял» скорость внутри
// цикла, треугольник из трёх шаров на земле разъезжался с 70 до 141 px и
// разваливался: любая позиционная поправка внутри цикла обязана оставаться
// позиционной, а скорость берётся из положений один раз, в конце.
//
// Нормальный импульс контакта здесь — накопленный множитель ограничения
// (store.lamN), а не служебная сумма выталкиваний. По нему считается кулоново
// трение: сила трения пропорциональна нормальному импульсу, и брать его из
// скоростного прохода нельзя — к тому моменту нормальная скорость уже погашена
// позиционной коррекцией, и трение считало бы нуль.

import { clamp, closestOnSegmentInto, insideRegion } from '../geom.js'
import { HashGrid, PAIRS_MIN } from '../nsearch.js'
import { F_POINTS, F_WORLD } from '../particles.js'

// Во сколько раз сопротивление качению меньше трения скольжения при той же
// шершавости. У катка по грунту это примерно одна десятая, у стального шара по
// стали — на два порядка меньше; берём середину и позволяем гладкости
// поверхности развести эти случаи.
const ROLL_RESIST = 0.08

// Глубже этого за подшаг не разлипаем: глубокое взаимопроникновение должно
// расходиться постепенно, а не выстреливать.
const MAX_DEPTH = 16

export class Contacts {
  constructor() {
    this.name = 'contacts'
    this.order = 40
    this.grid = new HashGrid()
    this.solid = new Int32Array(0)   // индексы не-среды, участвующей в парах
    this.solidCount = 0
    this._cand = []
    this._seg = { x: 0, y: 0, t: 0 }
    this._hit = { q: null, x: 0, y: 0, qx: 0, qy: 0, d: 0, edge: 0, t: 0 }
    this._out = { qx: 0, qy: 0, nx: 0, ny: 0, depth: 0, i: 0, t: 0 }
  }

  prepare(phys) {
    const s = phys.store
    if (this.solid.length < s.n) this.solid = new Int32Array(Math.max(s.n, 64))
    let k = 0
    for (let i = 0; i < s.n; i++) {
      if (!(s.flags[i] & F_POINTS)) continue
      this.solid[k++] = i
    }
    this.solidCount = k
    // Группу коллайдера интернируем один раз на подшаг: в горячем цикле
    // сравниваются числа, а не строки.
    for (const c of phys.colliders) c._gid = s.groups.id(c.group)
    // Сетку перекладываем раз на подшаг, а не на каждую итерацию: за итерацию
    // тела сдвигаются на доли пикселя, и запас в несколько пикселей
    // гарантирует, что в кандидатах окажется всё, что могло сойтись.
    if (k >= PAIRS_MIN) {
      let sum = 0
      for (let m = 0; m < k; m++) sum += s.radius[this.solid[m]]
      this.grid.build(s, this.solid.subarray(0, k), ((sum / k) + 6) * 2, null, 6)
    }
  }

  project(phys, h) {
    this._syncColliders(phys)
    this._pairs(phys)
    this._region(phys, h)
  }

  // --- тело против тела -----------------------------------------------------
  _pairs(phys) {
    const s = phys.store
    const ids = this.solid, n = this.solidCount
    if (n < PAIRS_MIN) {
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) this._push(s, ids[a], ids[b])
      }
      return
    }
    const cand = this._cand
    const X = s.x, Y = s.y, R = s.radius
    for (let a = 0; a < n; a++) {
      const i = ids[a]
      this.grid.gather(X[i], Y[i], R[i], cand, a)
      // Вставками, а не sort(): кандидатов единицы, и постоянные расходы
      // библиотечной сортировки тут дороже самой сортировки в разы. Порядок
      // обязан совпадать с полным перебором — проход последовательный.
      for (let u = 1; u < cand.length; u++) {
        const v = cand[u]
        let b = u - 1
        while (b >= 0 && cand[b] > v) { cand[b + 1] = cand[b]; b-- }
        cand[b + 1] = v
      }
      for (let u = 0; u < cand.length; u++) this._push(s, i, ids[cand[u]])
    }
  }

  _push(s, a, b) {
    const wa = s.w[a], wb = s.w[b]
    const sum = wa + wb
    if (!sum) return
    const dx = s.x[b] - s.x[a], dy = s.y[b] - s.y[a]
    const min = s.radius[a] + s.radius[b]
    if (dx > min || dx < -min || dy > min || dy < -min) return
    const d = Math.hypot(dx, dy)
    if (d >= min || d < 1e-9) return
    const push = (min - d) / d
    s.x[a] -= dx * push * (wa / sum); s.y[a] -= dy * push * (wa / sum)
    s.x[b] += dx * push * (wb / sum); s.y[b] += dy * push * (wb / sum)
  }

  _syncColliders(phys) {
    for (const c of phys.colliders) {
      if (!c.dynamic) continue
      for (let i = 0; i < c.verts.length; i++) {
        c.points[i][0] = c.verts[i].x
        c.points[i][1] = c.verts[i].y
      }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const ring of c.rings) {
        for (const p of ring) {
          if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]
          if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]
        }
      }
      c.bbox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
      if (c.index) c.index.build(c.polys)
      c.stamp++
    }
  }

  // --- тело против области --------------------------------------------------
  // Со статикой просто выталкиваем, с живым телом делим поправку по обратным
  // массам — тело получает отдачу: шар, упавший на край, разворачивает объект.
  _region(phys, h) {
    const s = phys.store
    const inv = 1 / h
    const X = s.x, Y = s.y, W = s.w, F = s.flags, R = s.radius
    for (let i = 0; i < s.n; i++) {
      if (!W[i] || !(F[i] & F_WORLD)) continue
      const gi = s.group[i]
      for (const c of phys.colliders) {
        if (gi && c._gid === gi) continue
        const ct = this._contact(s, i, c, 0)
        if (!ct) continue
        if (!c.dynamic) {
          const tx = ct.qx + ct.nx * R[i], ty = ct.qy + ct.ny * R[i]
          const dx = tx - X[i], dy = ty - Y[i]
          s.lamN[i] += Math.hypot(dx, dy) * inv
          X[i] = tx; Y[i] = ty
          continue
        }
        const a = c.verts[ct.i], b = c.verts[(ct.i + 1) % c.verts.length]
        const t = ct.t
        const ia = a._i, ib = b._i
        const wp = W[i]
        const wa = W[ia], wb = W[ib]
        const we = (1 - t) * (1 - t) * wa + t * t * wb
        const sum = wp + we
        if (!sum) continue
        const d = Math.min(ct.depth, MAX_DEPTH)
        s.lamN[i] += d * (wp / sum) * inv
        X[i] += ct.nx * d * (wp / sum); Y[i] += ct.ny * d * (wp / sum)
        if (wa) { X[ia] -= ct.nx * d * ((1 - t) * wa) / sum; Y[ia] -= ct.ny * d * ((1 - t) * wa) / sum }
        if (wb) { X[ib] -= ct.nx * d * (t * wb) / sum; Y[ib] -= ct.ny * d * (t * wb) / sum }
      }
    }
  }

  // --- скоростная часть -----------------------------------------------------
  velocity(phys) {
    const s = phys.store
    const VX = s.vx, VY = s.vy, W = s.w, F = s.flags, R = s.radius
    for (let i = 0; i < s.n; i++) {
      if (!W[i] || !(F[i] & F_WORLD)) continue
      const gi = s.group[i]
      for (const c of phys.colliders) {
        if (gi && c._gid === gi) continue
        const ct = this._contact(s, i, c, 0.5)
        if (!ct) continue
        const { nx, ny } = ct

        let sx = 0, sy = 0
        if (c.dynamic) { // скорость самой поверхности в точке касания
          const a = c.verts[ct.i], b = c.verts[(ct.i + 1) % c.verts.length]
          sx = VX[a._i] * (1 - ct.t) + VX[b._i] * ct.t
          sy = VY[a._i] * (1 - ct.t) + VY[b._i] * ct.t
        }
        const vx = VX[i] - sx, vy = VY[i] - sy
        const vn = vx * nx + vy * ny

        const rest = (s.rest[i] + c.restitution) * 0.5
        // Гладкость 0 — шершавая поверхность, 1 — лёд.
        const avg = clamp((s.smooth[i] + c.smoothness) * 0.5, 0, 1)
        const mu = 1 - avg
        const tx = -ny, ty = nx
        const vt = vx * tx + vy * ty
        const nvn = vn < 0 ? -vn * rest : vn
        const j = s.lamN[i] + (vn < 0 ? -vn * (1 + rest) : 0)

        let nvt
        if (!s.rigid[i] && R[i] > 1e-3) {
          // Свободный диск катится. Трение действует не на центр, а на точку
          // касания: проскальзывание там равно vt − ω·r. Импульс J меняет и
          // скорость (J/m), и вращение (−J·r/I); для диска I = ½mr², поэтому
          // проскальзывание убывает втрое быстрее скорости центра и быстро
          // обнуляется — дальше шар катится почти без потерь.
          const slip = vt - s.spin[i] * R[i]
          const sg = slip < 0 ? -1 : slip > 0 ? 1 : 0
          const dv = Math.min(Math.abs(slip) / 3, mu * j)
          nvt = vt - sg * dv
          s.spin[i] += (sg * dv * 2) / R[i]

          // Сопротивление качению: пятно контакта мнётся тем сильнее, чем мягче
          // и шершавее опора, то есть его задаёт та же гладкость. Считается
          // относительно самой опоры, поэтому на едущей платформе оно не
          // тормозит груз, а подтягивает его к её скорости.
          const brake = Math.min(Math.abs(nvt), mu * ROLL_RESIST * j)
          if (brake > 0) {
            const rs = nvt < 0 ? -1 : 1
            nvt -= rs * brake
            s.spin[i] -= (rs * brake) / R[i]
          }
        } else {
          const drop = Math.min(Math.abs(vt), mu * j)
          nvt = vt - Math.sign(vt) * drop
        }
        VX[i] = nvn * nx + nvt * tx + sx
        VY[i] = nvn * ny + nvt * ty + sy
      }
    }
  }

  // Граница области — это все её кольца, включая дырки. У крупных областей
  // спрашиваем индекс, у мелких перебираем: ответ обязан быть один и тот же.
  //
  // Раньше эти две функции создавались замыканиями внутри _contact — то есть
  // по два объекта на каждую проверку каждой частицы против каждой области.
  // На тысяче частиц среды это заметная доля кадра, поэтому они здесь.
  _inside(c, x, y) {
    return c.index ? c.index.inside(x, y) : insideRegion(x, y, c.polys)
  }

  // limit > 0 — «дальше не интересно»: тому, кто снаружи, граница дальше
  // собственного радиуса не нужна, он её не касается.
  _closest(c, x, y, limit) {
    if (c.index) return c.index.closest(x, y, limit)
    const seg = this._seg, out = this._hit
    let best = Infinity, edge = 0
    out.q = null
    for (const ring of c.rings) {
      for (let k = 0, n = ring.length; k < n; k++) {
        const a = ring[k], b = ring[(k + 1) % n]
        closestOnSegmentInto(seg, x, y, a[0], a[1], b[0], b[1])
        const d = Math.hypot(x - seg.x, y - seg.y)
        if (d < best) { best = d; out.qx = seg.x; out.qy = seg.y; out.q = out; edge = k; out.t = seg.t }
      }
    }
    out.x = out.qx; out.y = out.qy
    out.d = best; out.edge = edge
    return out
  }

  // Ближайшая точка границы и внешняя нормаль, если тело её касается.
  _contact(s, i, c, slack) {
    const rings = c.rings
    if (!rings || !rings.length) return null
    const bb = c.bbox
    const px = s.x[i], py = s.y[i], r = s.radius[i]
    if (px + r < bb.x || px - r > bb.x + bb.w) return null
    if (py + r < bb.y || py - r > bb.y + bb.h) return null

    // Снаружи граница интересна только в пределах своего радиуса — этим
    // ограничением индекс живёт одним просмотром вместо расширяющегося поиска.
    const inside = this._inside(c, px, py)
    const near = inside ? this._closest(c, px, py, 0) : this._closest(c, px, py, r + slack)
    if (!near || !near.q) return null
    let q = near.q, d = near.d, edge = near.edge, t = near.t
    if (!inside && d >= r + slack) return null

    let nx, ny
    if (inside && !this._inside(c, s.sx[i], s.sy[i])) {
      // влетел за один подшаг — выталкиваем туда, откуда пришёл
      const prev = this._closest(c, s.sx[i], s.sy[i], 0)
      q = prev.q; edge = prev.edge; t = prev.t
      const dx = s.sx[i] - q.x, dy = s.sy[i] - q.y
      const len = Math.hypot(dx, dy) || 1e-9
      nx = dx / len; ny = dy / len
    } else if (d < 1e-6) { nx = 0; ny = -1 } else {
      nx = (px - q.x) / d; ny = (py - q.y) / d
      if (inside) { nx = -nx; ny = -ny }
    }

    const o = this._out
    o.qx = q.x; o.qy = q.y; o.nx = nx; o.ny = ny
    o.depth = inside ? r + d : r - d
    o.i = edge; o.t = t
    return o
  }
}
