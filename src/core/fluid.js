// Среда: вода и всё, у чего есть объём, но нет формы.
//
// Несжимаемость решается НЕ по соседям, а на сетке. Это принципиально, и вот
// почему. Давление в жидкости — вещь мгновенная и дальнодействующая: положишь
// каплю на край пруда — уровень поднимется по всей его длине сразу. Если решать
// это перебором соседей, давление ползёт по луже со скоростью одна частица за
// итерацию, и на трёх итерациях подшага дальний край не узнаёт о ближнем
// никогда. Отсюда росло всё сразу: остаточная дрожь, медленное выравнивание,
// незаполненные карманы и нужда в мелком шаге частиц, чтобы это скрыть.
//
// На сетке давление решается сразу везде: скорости раскладываются по клеткам,
// расхождение (сколько втекает минус сколько вытекает) гасится по всей связной
// области, результат возвращается частицам. Это FLIP — то же, чем считают воду
// в кино. Ни поиска соседей, ни ядер сглаживания, ни призраков границы: стенка
// это просто клетка, через грань которой не течёт.
//
// Частицы при этом остаются обычными точками физики, поэтому с остальным миром
// среда взаимодействует как раньше — расталкиванием по обратным массам.

import { regionHas } from './grid.js'
import { clamp } from './geom.js'

const AIR = 0, FLUID = 1, SOLID = 2
const f64 = (n) => new Float64Array(n)
export class Fluid {
  constructor(physics) {
    this.ph = physics
    this.phases = [null]        // 0 — «не среда»
    this.list = []
    this.n = 0
    this.cell = 24
    this.nx = 0; this.ny = 0; this.x0 = 0; this.y0 = 0
    this.u = f64(0); this.v = f64(0)          // скорости на гранях клеток
    this.pu = f64(0); this.pv = f64(0)        // они же до решения — для FLIP
    this.wu = f64(0); this.wv = f64(0)        // веса раскладки
    this.type = new Uint8Array(0)
    this.dens = f64(0)                        // сколько вещества в клетке
    this.cnt = f64(0)                         // и сколько в ней частиц
    this.solidMask = new Uint8Array(0)
    this.solidKey = ''
    // Клетку считаем твёрдой по её середине. Пробовал требовать, чтобы твёрдой
    // была вся клетка, — это лечило просадку у берега, пока расталкивание было
    // жёстким. С мягким расталкиванием лекарство стало вредным: вода получает
    // право занимать полклетки внутри камня и лезет вверх по стенке.
    this.wholeCells = false
    this.rest = 0
    this.iterations = 60
    this.pres = f64(0); this.div = f64(0); this.rho = f64(0)
    this.head = null; this.next = null
    // Насколько близко частицам разрешено сходиться, в долях шага.
    //
    // Это оказалось главным числом во всей среде. При единице частицы садятся
    // в правильную шестиугольную укладку, и она держит уступ: частице на краю
    // плато некуда съехать, все места заняты соседями вплотную. Поверхность
    // застывает лесенкой в один ряд, и никаким давлением её не разгладить —
    // обе ступеньки решателя одинаково устраивают. Жидкость же уступа держать
    // не должна вовсе: у неё нет трения покоя.
    //
    // Небольшой люфт ломает укладку, и частицы начинают съезжать. Проверено на
    // нарочной ступеньке в два ряда: при 1.0 она стоит вечно, при 0.9 уходит
    // в ноль за полсекунды. Меньше 0.9 — начинается толчея и рябь.
    this.sep = 0.9
    this.cellRatio = 2
  }

  // Вещество. spacing — шаг раскладки частиц; клетку берём крупнее, чтобы в неё
  // попадало несколько частиц: по одной на клетку сетка не видит, где жидкость.
  addPhase(o = {}) {
    if (o.key) {
      const had = this.phases.find((f) => f && f.key === o.key)
      if (had) return had
    }
    const spacing = o.spacing ?? 11
    const ph = {
      id: this.phases.length,
      key: o.key || null,
      spacing,
      mass: o.mass ?? 1,
      // Вязкость здесь — доля «сеточной» скорости в ответе. Ноль отдаёт частице
      // только поправку (FLIP: живо и вихрясто, но шумновато), единица — саму
      // сеточную скорость (PIC: гладко, но всё вязнет).
      viscosity: clamp(o.viscosity ?? 0.06, 0, 1),
      // Насколько сетка выдавливает лишнее из переполненной клетки. Без этого
      // частицы сбиваются комками; с перебором — наоборот, лужа раздувается и
      // назад уже не сожмётся, ведь несжимаемость работает в обе стороны.
      drift: o.drift ?? 0.1,
    }
    this.phases.push(ph)
    return ph
  }

  // ---- подготовка ----------------------------------------------------------
  prepare() {
    const list = this.list
    list.length = 0
    let step = Infinity
    for (const p of this.ph.points) {
      if (!p.phase) continue
      list.push(p)
      const s = this.phases[p.phase].spacing
      if (s < step) step = s
    }
    const n = this.n = list.length
    if (!n) return false

    const cell = this.cell = step * this.cellRatio
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const p of list) {
      if (p.x < x0) x0 = p.x
      if (p.x > x1) x1 = p.x
      if (p.y < y0) y0 = p.y
      if (p.y > y1) y1 = p.y
    }
    // Сетку прибиваем к мировым координатам: иначе она ползала бы вслед за
    // рамкой воды, и клетки твёрдого пришлось бы размечать каждый кадр.
    this.x0 = Math.floor(x0 / cell - 2) * cell
    this.y0 = Math.floor(y0 / cell - 2) * cell
    this.nx = Math.ceil((x1 - this.x0) / cell) + 3
    this.ny = Math.ceil((y1 - this.y0) / cell) + 3
    this._alloc()
    this._markSolid()
    return true
  }

  _alloc() {
    const { nx, ny } = this
    const nu = (nx + 1) * ny, nv = nx * (ny + 1), nc = nx * ny
    if (this.u.length < nu) { this.u = f64(nu); this.pu = f64(nu); this.wu = f64(nu) }
    if (this.v.length < nv) { this.v = f64(nv); this.pv = f64(nv); this.wv = f64(nv) }
    if (this.type.length < nc) {
      this.type = new Uint8Array(nc); this.dens = f64(nc); this.cnt = f64(nc); this.solidMask = new Uint8Array(nc)
    }
  }

  // Клетки твёрдого. Пересчитываем, только когда сдвинулась сетка или менялась
  // геометрия: раскопка, поехавший объект.
  _markSolid() {
    let stamp = 0
    for (const c of this.ph.colliders) stamp = (stamp * 31 + (c.stamp || 0) + Math.round(c.bbox.x + c.bbox.y)) | 0
    const key = `${stamp}|${this.x0}|${this.y0}|${this.nx}|${this.ny}|${this.cell}`
    if (key === this.solidKey) return
    this.solidKey = key
    const { nx, ny, cell, x0, y0, solidMask } = this
    solidMask.fill(0, 0, nx * ny)
    for (const c of this.ph.colliders) {
      const bb = c.bbox
      if (!bb) continue
      const i0 = Math.max(0, Math.floor((bb.x - x0) / cell - 1))
      const i1 = Math.min(nx - 1, Math.ceil((bb.x + bb.w - x0) / cell))
      const j0 = Math.max(0, Math.floor((bb.y - y0) / cell - 1))
      const j1 = Math.min(ny - 1, Math.ceil((bb.y + bb.h - y0) / cell))
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const k = i + j * nx
          if (solidMask[k]) continue
          // Клетка считается твёрдой, только если твёрдая ВСЯ. Иначе стенка,
          // разрезавшая клетку пополам, забирает у воды полоску вдоль себя:
          // частицы там оказываются в «камне», давления не получают и оседают.
          // Именно так у одного берега появлялась просадка, а у другого нет —
          // где как легла сетка. Ошибаться безопаснее в пользу воды: от стенки
          // частицу всё равно удержит обычное столкновение.
          const cx = x0 + i * cell, cy = y0 + j * cell
          if (!regionHas(c, cx + cell * 0.5, cy + cell * 0.5)) continue
          if (this.wholeCells &&
              !(regionHas(c, cx + 0.5, cy + 0.5) && regionHas(c, cx + cell - 0.5, cy + 0.5) &&
                regionHas(c, cx + 0.5, cy + cell - 0.5) && regionHas(c, cx + cell - 0.5, cy + cell - 0.5))) continue
          solidMask[k] = 1
        }
      }
    }
  }

  // ---- главный шаг ---------------------------------------------------------
  // Скорость точки здесь — смещение за подшаг, (x − px). Ни на что не делим:
  // несжимаемость к масштабу скорости безразлична.
  project() {
    if (!this.n) return
    this._toGrid()
    this._solve()
    this._toParticles()
  }

  // 0. Расталкивание своих.
  //
  // Объём держит сетка, а не это — но без равномерной раскладки частицы сбива-
  // ются комками, и поверхность становится рваной. Делаем это здесь, своей же
  // сеткой: общему расталкиванию мира пришлось бы искать соседей заново, и на
  // тысяче частиц это дороже всего остального решателя вместе взятого.
  separate() {
    if (!this.n) return
    const { nx, ny, cell, x0, y0, list, n } = this
    const nc = nx * ny
    let head = this.head, next = this.next
    if (!head || head.length < nc) this.head = head = new Int32Array(nc)
    if (!next || next.length < n) this.next = next = new Int32Array(n * 2)
    head.fill(-1, 0, nc)
    for (let a = 0; a < n; a++) {
      const p = list[a]
      const i = clamp(Math.floor((p.x - x0) / cell), 0, nx - 1)
      const j = clamp(Math.floor((p.y - y0) / cell), 0, ny - 1)
      const k = i + j * nx
      next[a] = head[k]; head[k] = a
    }
    for (let pass = 0; pass < 1; pass++) {
      for (let a = 0; a < n; a++) {
        const p = list[a]
        if (p.pinned) continue
        const min = this.phases[p.phase].spacing * this.sep
        const min2 = min * min
        const ci = clamp(Math.floor((p.x - x0) / cell), 0, nx - 1)
        const cj = clamp(Math.floor((p.y - y0) / cell), 0, ny - 1)
        for (let j = Math.max(0, cj - 1); j <= Math.min(ny - 1, cj + 1); j++) {
          for (let i = Math.max(0, ci - 1); i <= Math.min(nx - 1, ci + 1); i++) {
            for (let b = head[i + j * nx]; b >= 0; b = next[b]) {
              if (b <= a) continue
              const q = list[b]
              const dx = q.x - p.x, dy = q.y - p.y
              const d2 = dx * dx + dy * dy
              if (d2 >= min2 || d2 < 1e-12) continue
              const d = Math.sqrt(d2)
              const s = ((min - d) / d) * 0.5
              const mx = dx * s, my = dy * s
              if (!q.pinned) { q.x += mx; q.y += my }
              p.x -= mx; p.y -= my
            }
          }
        }
      }
    }
  }

  // 1. Скорости частиц — на грани клеток, билинейно.
  _toGrid() {
    const { nx, ny, cell, x0, y0, u, v, wu, wv, pu, pv, type, dens, solidMask, list, n } = this
    const nu = (nx + 1) * ny, nv = nx * (ny + 1), nc = nx * ny
    u.fill(0, 0, nu); v.fill(0, 0, nv); wu.fill(0, 0, nu); wv.fill(0, 0, nv)
    dens.fill(0, 0, nc); this.cnt.fill(0, 0, nc)
    for (let k = 0; k < nc; k++) type[k] = solidMask[k] ? SOLID : AIR

    for (let a = 0; a < n; a++) {
      const p = list[a]
      const m = this.phases[p.phase].mass
      const vx = p.x - p.px, vy = p.y - p.py
      const gx = (p.x - x0) / cell, gy = (p.y - y0) / cell
      const ci = clamp(Math.floor(gx), 0, nx - 1), cj = clamp(Math.floor(gy), 0, ny - 1)
      const kc = ci + cj * nx
      if (type[kc] !== SOLID) type[kc] = FLUID
      dens[kc] += m; this.cnt[kc] += 1

      // грань u стоит на левом краю клетки, по высоте — в её середине
      let fx = gx, fy = gy - 0.5
      let i = clamp(Math.floor(fx), 0, nx - 1), j = clamp(Math.floor(fy), 0, ny - 2)
      let tx = fx - i, ty = fy - j
      let a0 = i + j * (nx + 1), a1 = a0 + 1, a2 = a0 + nx + 1, a3 = a2 + 1
      let w = (1 - tx) * (1 - ty); u[a0] += vx * w; wu[a0] += w
      w = tx * (1 - ty); u[a1] += vx * w; wu[a1] += w
      w = (1 - tx) * ty; u[a2] += vx * w; wu[a2] += w
      w = tx * ty; u[a3] += vx * w; wu[a3] += w

      // грань v стоит на верхнем краю клетки, по ширине — в её середине
      fx = gx - 0.5; fy = gy
      i = clamp(Math.floor(fx), 0, nx - 2); j = clamp(Math.floor(fy), 0, ny - 1)
      tx = fx - i; ty = fy - j
      a0 = i + j * nx; a1 = a0 + 1; a2 = a0 + nx; a3 = a2 + 1
      w = (1 - tx) * (1 - ty); v[a0] += vy * w; wv[a0] += w
      w = tx * (1 - ty); v[a1] += vy * w; wv[a1] += w
      w = (1 - tx) * ty; v[a2] += vy * w; wv[a2] += w
      w = tx * ty; v[a3] += vy * w; wv[a3] += w
    }
    for (let k = 0; k < nu; k++) if (wu[k] > 0) u[k] /= wu[k]
    for (let k = 0; k < nv; k++) if (wv[k] > 0) v[k] /= wv[k]
    pu.set(u.subarray(0, nu)); pv.set(v.subarray(0, nv))

    // Плотность покоя не задаётся, а замеряется по первой полной картине: это
    // средняя заполненность клеток, окружённых своими.
    if (!this.rest) {
      let sum = 0, cnt = 0
      for (let j = 1; j < ny - 1; j++) {
        for (let i = 1; i < nx - 1; i++) {
          const k = i + j * nx
          if (type[k] !== FLUID) continue
          if (type[k - 1] !== FLUID || type[k + 1] !== FLUID || type[k - nx] !== FLUID || type[k + nx] !== FLUID) continue
          sum += dens[k]; cnt++
        }
      }
      if (cnt > 8) this.rest = sum / cnt
    }
  }

  // 2. Гасим расхождение сразу по всей области.
  //
  // Проход по клеткам повторяется десятки раз, но это не «сколько успеем»:
  // Гаусс — Зейдель разносит давление на клетку за проход, а клеток поперёк
  // лужи полсотни, не тысяча частиц. За шестьдесят проходов дальний край
  // узнаёт о ближнем — и вода стоит ровно.
  //
  // Давление считается явно, а не подменяется раздачей поправки по граням, и
  // причина в разных веществах. Тяжесть добавляется всем одинаково ещё до
  // проекции, поэтому разница плотностей обязана войти в само уравнение:
  // скорость правится на ∇p/ρ, и лёгкое от того же перепада давления получает
  // больше. Отсюда и всплытие, и расслоение — без единого слова про них.
  // При одинаковых массах всё сводится к прежнему счёту открытых граней.
  _solve() {
    const { nx, ny, u, v, type, dens, cnt } = this
    const rest = this.rest
    const drift = this.phases[1] ? this.phases[1].drift : 1
    const over = 1.7
    const nc = nx * ny
    if (this.pres.length < nc) { this.pres = f64(nc); this.div = f64(nc); this.rho = f64(nc) }
    const p = this.pres, div = this.div, rho = this.rho
    p.fill(0, 0, nc)

    for (let k = 0; k < nc; k++) rho[k] = cnt[k] > 0 ? dens[k] / cnt[k] : 1
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const k = i + j * nx
        if (type[k] !== FLUID) { div[k] = 0; continue }
        const ku = i + j * (nx + 1)
        let d = u[ku + 1] - u[ku] + v[k + nx] - v[k]
        // Клетка переполнена — выдавливаем лишнее. Недобор исправляем только в
        // толще, где соседи со всех сторон: у поверхности клетка недозаполнена
        // просто потому, что она наполовину воздух, и сжимать её нельзя.
        if (rest) {
          const ex = dens[k] - rest
          if (ex > 0) d -= drift * ex / rest
          else if (type[k - 1] === FLUID && type[k + 1] === FLUID &&
                   type[k - nx] === FLUID && type[k + nx] === FLUID) d -= drift * ex / rest
        }
        div[k] = d
      }
    }

    for (let it = 0; it < this.iterations; it++) {
      for (let j = 1; j < ny - 1; j++) {
        for (let i = 1; i < nx - 1; i++) {
          const k = i + j * nx
          if (type[k] !== FLUID) continue
          // Доля заполнения клетки: давление ноль там, где кончается вода, а не
          // там, где кончается клетка. Без этого поверхность может стоять
          // только на границах клеток.
          const th = rest ? clamp(dens[k] / rest, 0.2, 1) : 1
          const mi = rho[k]
          let sum = 0, acc = 0
          for (const kk of [k - 1, k + 1, k - nx, k + nx]) {
            const t = type[kk]
            if (t === SOLID) continue
            const w = t === AIR ? 1 / (mi * th) : 2 / (mi + rho[kk])
            sum += w
            if (t === FLUID) acc += w * p[kk]
          }
          if (!sum) continue
          p[k] += over * ((-div[k] + acc) / sum - p[k])
        }
      }
    }

    // Скорость правится на перепад давления, делённый на плотность грани.
    // Идём по граням, а не по клеткам: у грани две соседние клетки, и обход по
    // клеткам применил бы поправку дважды.
    const wface = (ka, kb) => {
      const ta = type[ka], tb = type[kb]
      if (ta === SOLID || tb === SOLID) return 0
      if (ta === FLUID && tb === FLUID) return 2 / (rho[ka] + rho[kb])
      const kf = ta === FLUID ? ka : kb
      if (type[kf] !== FLUID) return 0
      const th = rest ? clamp(dens[kf] / rest, 0.2, 1) : 1
      return 1 / (rho[kf] * th)
    }
    const pr = (k) => (type[k] === FLUID ? p[k] : 0)
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx; i++) {
        const k = i + j * nx
        const w = wface(k - 1, k)
        if (w) u[i + j * (nx + 1)] -= w * (pr(k) - pr(k - 1))
      }
    }
    for (let j = 1; j < ny; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const k = i + j * nx
        const w = wface(k - nx, k)
        if (w) v[k] -= w * (pr(k) - pr(k - nx))
      }
    }
  }

  // 3. Обратно частицам: поправка сетки плюс, по вкусу, сама сеточная скорость.
  _toParticles() {
    const { nx, ny, cell, x0, y0, u, v, pu, pv, wu, wv, list, n } = this
    for (let a = 0; a < n; a++) {
      const p = list[a]
      if (p.pinned) continue
      const pic = this.phases[p.phase].viscosity
      const gx = (p.x - x0) / cell, gy = (p.y - y0) / cell

      let fx = gx, fy = gy - 0.5
      let i = clamp(Math.floor(fx), 0, nx - 1), j = clamp(Math.floor(fy), 0, ny - 2)
      let tx = fx - i, ty = fy - j
      let k0 = i + j * (nx + 1), k1 = k0 + 1, k2 = k0 + nx + 1, k3 = k2 + 1
      let w0 = (1 - tx) * (1 - ty), w1 = tx * (1 - ty), w2 = (1 - tx) * ty, w3 = tx * ty
      let sw = (wu[k0] > 0 ? w0 : 0) + (wu[k1] > 0 ? w1 : 0) + (wu[k2] > 0 ? w2 : 0) + (wu[k3] > 0 ? w3 : 0)
      let nvx = p.x - p.px
      if (sw > 0) {
        const now = ((wu[k0] > 0 ? u[k0] * w0 : 0) + (wu[k1] > 0 ? u[k1] * w1 : 0) + (wu[k2] > 0 ? u[k2] * w2 : 0) + (wu[k3] > 0 ? u[k3] * w3 : 0)) / sw
        const was = ((wu[k0] > 0 ? pu[k0] * w0 : 0) + (wu[k1] > 0 ? pu[k1] * w1 : 0) + (wu[k2] > 0 ? pu[k2] * w2 : 0) + (wu[k3] > 0 ? pu[k3] * w3 : 0)) / sw
        nvx = (nvx + now - was) * (1 - pic) + now * pic
      }

      fx = gx - 0.5; fy = gy
      i = clamp(Math.floor(fx), 0, nx - 2); j = clamp(Math.floor(fy), 0, ny - 1)
      tx = fx - i; ty = fy - j
      k0 = i + j * nx; k1 = k0 + 1; k2 = k0 + nx; k3 = k2 + 1
      w0 = (1 - tx) * (1 - ty); w1 = tx * (1 - ty); w2 = (1 - tx) * ty; w3 = tx * ty
      sw = (wv[k0] > 0 ? w0 : 0) + (wv[k1] > 0 ? w1 : 0) + (wv[k2] > 0 ? w2 : 0) + (wv[k3] > 0 ? w3 : 0)
      let nvy = p.y - p.py
      if (sw > 0) {
        const now = ((wv[k0] > 0 ? v[k0] * w0 : 0) + (wv[k1] > 0 ? v[k1] * w1 : 0) + (wv[k2] > 0 ? v[k2] * w2 : 0) + (wv[k3] > 0 ? v[k3] * w3 : 0)) / sw
        const was = ((wv[k0] > 0 ? pv[k0] * w0 : 0) + (wv[k1] > 0 ? pv[k1] * w1 : 0) + (wv[k2] > 0 ? pv[k2] * w2 : 0) + (wv[k3] > 0 ? pv[k3] * w3 : 0)) / sw
        nvy = (nvy + now - was) * (1 - pic) + now * pic
      }

      p.px = p.x - nvx
      p.py = p.y - nvy
    }
  }
}
