// Несжимаемость среды как позиционное ограничение (Position Based Fluids,
// Macklin & Müller 2013), с когезией и смачиванием по Akinci 2013.
//
// В общем списке это ровно такое же ограничение, как связь, контакт или
// подгонка формы: считает Δx, применяет Δx. Отсюда и всё остальное — среда
// толкает тела и получает от них сдачи по обратным массам, ветер гонит её тем
// же законом, что и шар, тяжесть у каждой частицы своя. Ни одной строчки про
// «воду и шар» или «воду и ветер» здесь нет и быть не должно: их взаимодействие
// не описано, а получается.
//
// Среда регистрируется списком, как тело: phys.addMedium({points, ...}).
// Признака «жидкая» на частице нет — принадлежность выражает сам список.

import { makeKernels, cohSpline, adhSpline, calibrate, buildBoundaryTable } from '../../entities/liquid/kernels.js'

// Постоянные метода. Свойствами вещества они не являются: в жизни у жидкости
// нет ни числа итераций, ни релаксации Якоби.
const OMEGA = 0.8       // под-релаксация: решаем параллельно, значит ω < 1
// Регуляризация CFM. Нормирована на gradSum из калибровки — это типичная
// величина Σ|∇C|² на решётке. Голая константа здесь означала бы, что
// регуляризация зависит от масштаба мира: в пикселях она оказалась бы в сотни
// раз слабее, чем в метрах, и решатель качал бы энергию.
const RELAX = 0.5
const SCORR = 0.03      // искусственное давление против слипания
// Растягивающее давление у свободной поверхности. Давление в жидкости не
// бывает отрицательным: вода не тянет, она кавитирует. Но у самой поверхности
// небольшая тяга нужна, иначе верхний ряд «сдувает».
const TENSILE = 0.05
const FILM = 0.5        // жёсткость плёнки на свободной поверхности
const MAXN = 48         // потолок соседей на частицу
const BUOY = 1        // сила выталкивания: 1 — как в жизни
const SURF = 0.5        // порог |∇C|·h, за которым частица считается поверхностной

export class FluidDensity {
  constructor() {
    this.name = 'fluid'
    // После контакта: тот уже нашёл ближайшую стенку и положил её в store,
    // а нам она нужна готовой — у борта частица иначе выглядит разреженной.
    this.order = 40
    this.mediums = []
    this._cap = 0
  }

  // --- память ---------------------------------------------------------------
  _fit(n) {
    if (n <= this._cap) return
    const c = Math.max(n, 256)
    this.idx = new Int32Array(c)          // индексы частиц среды в store
    this.slot = new Int32Array(c)         // обратное отображение
    this.rho = new Float32Array(c)
    this.lam = new Float32Array(c)
    this.dx = new Float32Array(c)
    this.dy = new Float32Array(c)
    this.nbr = new Int32Array(c * MAXN)
    // Коэффициент градиента ядра и само ядро для КАЖДОЙ пары. Корень и
    // деление — самое дорогое в горячем цикле, и считать их дважды (в
    // плотности и в поправке) незачем: между этими проходами положения не
    // меняются. Плотность считает и запоминает, поправка читает готовое.
    this.nkc = new Float32Array(c * MAXN)
    this.nkw = new Float32Array(c * MAXN)
    this.nc = new Int32Array(c)
    this.surf = new Uint8Array(c)
    this.snx = new Float32Array(c)
    this.sny = new Float32Array(c)
    this.om = new Float32Array(c)
    this.buoy = new Float32Array(c)
    // Плотная копия того, что читает горячий цикл. Частицы среды разбросаны по
    // хранилищу мира вперемешку с шарами и вершинами тел, поэтому обращение к
    // соседу — случайный прыжок по большому массиву. Собранные подряд, они
    // ложатся в кэш строками, и внутренний цикл перестаёт ждать память.
    this.cx = new Float32Array(c); this.cy = new Float32Array(c)
    this.cm = new Float32Array(c); this.cw = new Float32Array(c)
    this.cvx = new Float32Array(c); this.cvy = new Float32Array(c)
    this.cbs = new Float32Array(c)
    this.cbnx = new Float32Array(c); this.cbny = new Float32Array(c)
    this._cap = c
  }

  // Сетка под поиск соседей: ячейка в радиус ядра, как в эталоне.
  _grid(s, m) {
    const n = this.count, cx = this.cx, cy = this.cy
    const cell = m.h
    // Рамку сетки ограничиваем миром. Одна улетевшая частица, падающая за
    // краем, иначе растягивает её на километры: ячеек становится в двадцать
    // раз больше, чем нужно, они пустеют, и поиск соседей просматривает
    // пустоту. Замерено: 7119 ячеек вместо ~600, по 0.4 частицы на ячейку.
    const B = this.bounds
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let a = 0; a < n; a++) {
      if (cx[a] < x0) x0 = cx[a]; if (cx[a] > x1) x1 = cx[a]
      if (cy[a] < y0) y0 = cy[a]; if (cy[a] > y1) y1 = cy[a]
    }
    if (B) {
      const lo = -cell, hx = B.x + B.w + cell, hy = B.y + B.h + cell
      if (x0 < B.x + lo) x0 = B.x + lo
      if (y0 < B.y + lo) y0 = B.y + lo
      if (x1 > hx) x1 = hx
      if (y1 > hy) y1 = hy
      if (x1 < x0) x1 = x0
      if (y1 < y0) y1 = y0
    }
    const gnx = Math.max(1, Math.ceil((x1 - x0) / cell) + 1)
    const gny = Math.max(1, Math.ceil((y1 - y0) / cell) + 1)
    const nc = gnx * gny
    // Сетка растёт вместе с лужей: растекаясь, вода занимает больше клеток,
    // чем в момент налива.
    if (!this.cStart || this.cStart.length < nc + 1) {
      this.cStart = new Int32Array(nc + 1)
      this._fill = new Int32Array(nc + 1)
    }
    if (!this.sorted || this.sorted.length < this._cap) this.sorted = new Int32Array(this._cap)
    const cStart = this.cStart.fill(0, 0, nc + 1)
    const cellOf = this._cellOf || (this._cellOf = new Int32Array(this._cap))
    const CX = this.cx, CY = this.cy
    for (let a = 0; a < n; a++) {
      let ix = ((CX[a] - x0) / cell) | 0, iy = ((CY[a] - y0) / cell) | 0
      if (ix < 0) ix = 0; else if (ix >= gnx) ix = gnx - 1
      if (iy < 0) iy = 0; else if (iy >= gny) iy = gny - 1
      const c = iy * gnx + ix
      cellOf[a] = c; cStart[c + 1]++
    }
    for (let c = 0; c < nc; c++) cStart[c + 1] += cStart[c]
    const fill = this._fill
    fill.set(cStart.subarray(0, nc + 1))
    for (let a = 0; a < n; a++) this.sorted[fill[cellOf[a]]++] = a
    this.gx0 = x0; this.gy0 = y0; this.gnx = gnx; this.gny = gny; this.gcell = cell
  }

  _neighbors(s, m) {
    const n = this.count, h2 = m.h2
    const { gx0, gy0, gnx, gny, gcell, cStart, sorted, nbr, nc, cx, cy } = this
    for (let a = 0; a < n; a++) {
      const xi = cx[a], yi = cy[a]
      let ix = ((xi - gx0) / gcell) | 0, iy = ((yi - gy0) / gcell) | 0
      if (ix < 0) ix = 0; else if (ix >= gnx) ix = gnx - 1
      if (iy < 0) iy = 0; else if (iy >= gny) iy = gny - 1
      let cnt = 0
      const base = a * MAXN            // выносим: иначе умножение на КАЖДОГО соседа
      const yA = iy > 0 ? iy - 1 : 0, yB = iy < gny - 1 ? iy + 1 : gny - 1
      const xA = ix > 0 ? ix - 1 : 0, xB = ix < gnx - 1 ? ix + 1 : gnx - 1
      for (let yy = yA; yy <= yB; yy++) {
        const row = yy * gnx
        for (let xx = xA; xx <= xB; xx++) {
          const c = row + xx, e = cStart[c + 1]
          for (let k = cStart[c]; k < e; k++) {
            const b = sorted[k]
            if (b === a) continue
            const dx = cx[b] - xi, dy = cy[b] - yi
            if (dx * dx + dy * dy >= h2) continue
            nbr[base + cnt] = b
            // список полон — дальше искать незачем
            if (++cnt >= MAXN) { yy = yB; xx = xB; break }
          }
        }
      }
      nc[a] = cnt
    }
  }

  // Занято ли место средой. Спрашивает тот, для кого лужа — такая же преграда,
  // как камень: поток воздуха не должен идти сквозь воду, будто её нет. Ответ
  // берётся из той же сетки, по которой ищутся соседи, поэтому стоит он почти
  // ничего.
  occupiedAt(x, y) {
    const n = this.count
    if (!n || !this.cStart) return false
    const { gx0, gy0, gnx, gny, gcell, cStart, sorted, idx, store } = this
    if (!store) return false
    let cx = ((x - gx0) / gcell) | 0, cy = ((y - gy0) / gcell) | 0
    if (cx < -1 || cy < -1 || cx > gnx || cy > gny) return false
    if (cx < 0) cx = 0; else if (cx >= gnx) cx = gnx - 1
    if (cy < 0) cy = 0; else if (cy >= gny) cy = gny - 1
    const m = this.mediums[0]
    const r2 = (m.spacing * 0.8) ** 2
    for (let yy = Math.max(0, cy - 1); yy <= Math.min(gny - 1, cy + 1); yy++) {
      for (let xx = Math.max(0, cx - 1); xx <= Math.min(gnx - 1, cx + 1); xx++) {
        const c = yy * gnx + xx, e = cStart[c + 1]
        for (let k = cStart[c]; k < e; k++) {
          const a = sorted[k]
          // Свободная поверхность воздух НЕ запирает. Иначе выходит замкнутый
          // круг: вода помечает свои клетки твёрдыми, поток в них обнуляется,
          // и ветру нечем толкать воду — она закрылась от него сама. Преграда
          // — толща, а обмен импульсом идёт по границе раздела, как в жизни.
          if (this.surf[a]) continue
          const i = idx[a]
          const dx = store.x[i] - x, dy = store.y[i] - y
          if (dx * dx + dy * dy < r2) return true
        }
      }
    }
    return false
  }

  // --- конвейер -------------------------------------------------------------
  prepare(phys, h) {
    const s = phys.store
    // Собираем частицы среды в плотный список: между подшагами их могло
    // прибавиться, убавиться или переставиться при удалении соседа.
    let n = 0
    for (const m of this.mediums) n += m.points.length
    if (!n) { this.count = 0; return }
    this._fit(n)
    let k = 0
    for (const m of this.mediums) {
      m._from = k
      for (const p of m.points) { if (!p.removed) this.idx[k++] = p._i }
      m._to = k
    }
    this.count = k
    this.store = s
    this.bounds = this.mediums[0].bounds || null
    this._gather(s)
    const m0 = this.mediums[0]
    this._grid(s, m0)
    // Укладываем частицы в порядке ячеек. Соседи по сетке становятся соседями
    // в памяти, и внутренний цикл перестаёт прыгать по всему массиву.
    //
    // Само по себе это ускорения не даёт — в изоляции наш поиск отставал от
    // эталонного всего на 17 %. Но в живой симуляции между вызовами по тем же
    // кэшам проходит весь остальной движок, а порядок частиц вдобавок
    // перемешивается, когда улетевшие удаляются обменом с последней. Тогда
    // отставание вырастало до 2.5 раз.
    this._reorder(s)
    this._neighbors(s, m0)
  }

  // Забрать положения из мира в плотные массивы и вернуть обратно. Между
  // итерациями положение меняет и контакт, поэтому забираем каждый раз заново.
  // Масса и обратная масса не меняются вовсе — их довольно собрать раз в
  // подшаг. А вот стенку сюда класть НЕЛЬЗЯ: подготовка идёт раньше, чем
  // контакт её найдёт, — он в своей подготовке только сбрасывает расстояние,
  // а пишет уже в проекции. Собранное здесь было бы «стенки нет».
  _gather(s) {
    const { idx, cx, cy, cm, cw, cbs, cbnx, cbny } = this
    const X = s.x, Y = s.y, M = s.mass, W = s.w
    for (let a = 0, n = this.count; a < n; a++) {
      const i = idx[a]
      cx[a] = X[i]; cy[a] = Y[i]; cm[a] = M[i]; cw[a] = W[i]
    }
  }

  // Ближайшая стенка. Забираем на первой итерации: к этому моменту контакт уже
  // прошёл и её нашёл, а дальше в пределах подшага она не меняется.
  _gatherWall(s) {
    const { idx, cbs, cbnx, cbny } = this
    const B = s.bs, NX = s.bnx, NY = s.bny
    for (let a = 0, n = this.count; a < n; a++) {
      const i = idx[a]
      cbs[a] = B[i]; cbnx[a] = NX[i]; cbny[a] = NY[i]
    }
  }

  // Между итерациями меняются только положения — их и забираем.
  _gatherPos(s) {
    const { idx, cx, cy } = this
    const X = s.x, Y = s.y
    for (let a = 0, n = this.count; a < n; a++) {
      const i = idx[a]
      cx[a] = X[i]; cy[a] = Y[i]
    }
  }

  _scatter(s) {
    const { idx, cx, cy, cw } = this
    const X = s.x, Y = s.y
    for (let a = 0, n = this.count; a < n; a++) {
      if (!cw[a]) continue
      const i = idx[a]
      X[i] = cx[a]; Y[i] = cy[a]
    }
  }

  // Переставить частицы так, чтобы соседи по сетке оказались соседями в памяти.
  //
  // Построчного порядка ячеек для этого НЕ ХВАТАЕТ: сосед справа ложится рядом,
  // а сосед сверху — через целый ряд ячеек. Замерено: средний разрыв 707 слотов,
  // 89 % обращений мимо кэш-строки. Поэтому обходим по кривой Мортона —
  // чередуя биты координат, — она сохраняет близость в обе стороны.
  _reorder(s) {
    const n = this.count
    if (!n) return
    const gnx = this.gnx, gny = this.gny
    let bits = 1
    while ((1 << bits) < gnx || (1 << bits) < gny) bits++
    const buckets = 1 << (2 * bits)
    if (!this._cnt || this._cnt.length < buckets + 1) this._cnt = new Int32Array(buckets + 1)
    if (!this._perm || this._perm.length < n) {
      this._perm = new Int32Array(Math.max(n, 256))
      this._key = new Int32Array(Math.max(n, 256))
    }
    const cnt = this._cnt.fill(0, 0, buckets + 1)
    const key = this._key, perm = this._perm, cellOf = this._cellOf

    for (let a = 0; a < n; a++) {
      const c = cellOf[a]
      const ix = c % gnx, iy = (c / gnx) | 0
      let m = 0
      for (let b = 0; b < bits; b++) m |= ((ix >> b) & 1) << (2 * b) | ((iy >> b) & 1) << (2 * b + 1)
      key[a] = m; cnt[m + 1]++
    }
    for (let c = 0; c < buckets; c++) cnt[c + 1] += cnt[c]
    for (let a = 0; a < n; a++) perm[cnt[key[a]]++] = a

    // Диапазоны сред обязаны остаться сплошными, иначе вещества перемешаются.
    if (this.mediums.length > 1) {
      let k = 0
      const tmp = this._key2 || (this._key2 = new Int32Array(perm.length))
      for (const m of this.mediums) {
        const from = m._from, to = m._to, start = k
        for (let q = 0; q < n; q++) { const a = perm[q]; if (a >= from && a < to) tmp[k++] = a }
        m._from = start; m._to = k
      }
      perm.set(tmp.subarray(0, k))
    }

    const { idx, cx, cy, cm, cw } = this
    const ti = this._tmpI || (this._tmpI = new Int32Array(idx.length))
    const tf = this._tmpF || (this._tmpF = new Float32Array(idx.length))
    const mvI = (arr) => { for (let a = 0; a < n; a++) ti[a] = arr[perm[a]]; arr.set(ti.subarray(0, n)) }
    const mvF = (arr) => { for (let a = 0; a < n; a++) tf[a] = arr[perm[a]]; arr.set(tf.subarray(0, n)) }
    mvI(idx); mvF(cx); mvF(cy); mvF(cm); mvF(cw)
    // Сетка построена по старому порядку — пересобираем, она дёшева.
    this._grid(s, this.mediums[0])
  }

  project(phys, h, it) {
    if (!this.count) return
    this._gatherPos(phys.store)
    if (it === 0) this._gatherWall(phys.store)
    for (const m of this.mediums) this._density(phys.store, m)
    for (const m of this.mediums) this._push(phys.store, m)
    for (const m of this.mediums) this._film(phys.store, m)
    this._scatter(phys.store)
  }

  // Плотность и множитель Лагранжа. Пополнение у стенки берём из того, что
  // контакт уже нашёл: часть ядра ушла в твёрдое тело, и без поправки частицу
  // у борта отжимает от берега.
  _density(s, m) {
    const { idx, nbr, nc, rho, lam, cx, cy, cm } = this
    const P6 = m.POLY6, SP = m.SPIKY, h = m.h, h2 = m.h2
    const bt = m.btab, bf = bt.f, bl = bt.l, binv = bt.inv, blast = bf.length - 1
    const EPS = RELAX * m.gradSum
    const invRest = 1 / m.rest0, rest0 = m.rest0, rhoU = m.rhoUnit
    const cbs = this.cbs, cbnx = this.cbnx, cbny = this.cbny
    const surf = this.surf, snx = this.snx, sny = this.sny
    const nkc = this.nkc, nkw = this.nkw
    // Границы цикла — в локальные: пока они свойства объекта, их приходится
    // перечитывать на каждой итерации.
    const from = m._from, to = m._to
    for (let a = from; a < to; a++) {
      const i = idx[a]
      const xi = cx[a], yi = cy[a]
      let r = P6 * h2 * h2 * h2 * cm[a]
      let wn = P6 * h2 * h2 * h2          // счётная плотность: без масс
      let gix = 0, giy = 0, sum = 0
      const base = a * MAXN, cnt = nc[a]
      for (let u = 0; u < cnt; u++) {
        const b = nbr[base + u]
        const dx = xi - cx[b], dy = yi - cy[b]
        const r2 = dx * dx + dy * dy
        if (r2 >= h2 || r2 < 1e-14) { nkc[base + u] = 0; continue }
        const t = h2 - r2, w = P6 * t * t * t
        r += cm[b] * w
        wn += w
        const rr = Math.sqrt(r2)
        const hr = h - rr
        const kc = SP * hr * hr / rr
        nkc[base + u] = kc; nkw[base + u] = w
        const c = kc * cm[b] * invRest
        const gx = c * dx, gy = c * dy
        gix += gx; giy += gy
        sum += gx * gx + gy * gy
      }
      // Стенка: часть ядра ушла в твёрдое тело. Без этой поправки частица у
      // борта считается разреженной, и её отжимает от берега.
      const sb = cbs[a]
      if (sb < h) {
        let k = (sb * binv) | 0
        if (k > blast) k = blast
        const fk = bf[k]
        r += rest0 * fk
        wn += rhoU * fk
        const g = -bl[k]
        gix += g * cbnx[a]; giy += g * cbny[a]
      }
      rho[a] = r
      // Признак свободной поверхности — модуль градиента ограничения, он уже
      // посчитан. По плотности порога нет вовсе: у верхнего ряда она гуляет и
      // перекрывается с толщей. Множитель h делает признак независимым от шага.
      // Счётная проверка отделяет свободную поверхность от границы фаз: там
      // градиент тоже велик, но пустоты нет.
      const gl = Math.sqrt(gix * gix + giy * giy)
      if (gl * h > SURF && wn < 0.95 * rhoU) {
        const ig = 1 / gl
        surf[a] = 1; snx[a] = -gix * ig; sny[a] = -giy * ig
      } else surf[a] = 0
      sum += gix * gix + giy * giy
      // Давление в жидкости со свободной поверхностью не бывает отрицательным:
      // вода не тянет, она кавитирует. Растягивающие напряжения — источник
      // вечного дрожания тонких слоёв, поэтому допускаем их только там, где
      // рядом действительно пусто.
      const C = r * invRest - 1
      const tens = wn < 0.95 * m.rhoUnit ? TENSILE : 0
      lam[a] = -(C < 0 ? C * tens : C) / (sum + EPS)
    }
  }

  // Поправка положения. Развесовка по обратной массе — та же, что у контакта:
  // лёгкую частицу сдвигает сильнее тяжёлой. Отсюда и расслоение фаз, и
  // всплытие тела — без единого слова про то и другое.
  _push(s, m) {
    const { idx, nbr, nc, lam, dx, dy, cx, cy, cm, cw, cbs, cbnx, cbny, nkc, nkw } = this
    // Всё, что нужно внутреннему циклу, — в локальные переменные, и ни одного
    // деления: обратные величины считаются один раз. Свойство объекта и
    // деление стоят в горячем цикле дороже всей остальной арифметики вместе.
    const P6 = m.POLY6, SP = m.SPIKY, h = m.h, h2 = m.h2
    const invWq = 1 / m.wq, invRest = 1 / m.rest0, K = m.K
    const bl = m.btab.l, binv = m.btab.inv, blast = bl.length - 1
    dx.fill(0, m._from, m._to); dy.fill(0, m._from, m._to)
    for (let a = m._from; a < m._to; a++) {
      const i = idx[a]
      const xi = cx[a], yi = cy[a], la = lam[a]
      let ax = 0, ay = 0
      const base = a * MAXN, cnt = nc[a]
      for (let u = 0; u < cnt; u++) {
        const kc = nkc[base + u]
        if (kc === 0) continue           // ядро уже посчитано в плотности
        const b = nbr[base + u]
        const ddx = xi - cx[b], ddy = yi - cy[b]
        const q = nkw[base + u] * invWq, q2 = q * q
        const sc = -K * q2 * q2
        // m_j/ρ₀ᵢ — развесовка по обратной массе: лёгкая частица сдвигается
        // сильнее тяжёлой, откуда и берётся всплытие и расслоение фаз.
        const c = kc * (cm[b] * invRest) * (la + lam[b] + sc)
        ax += c * ddx; ay += c * ddy
      }
      // Стенка отталкивает всегда, но тянуть к себе не вправе: смачивание —
      // отдельная сила, а не работа решателя.
      const sb = cbs[a]
      if (sb < h) {
        const lb = la < 0 ? la : 0
        let k = (sb * binv) | 0
        if (k > blast) k = blast
        const g = -bl[k] * lb
        ax += g * cbnx[a]; ay += g * cbny[a]
      }
      dx[a] = ax * OMEGA; dy[a] = ay * OMEGA
    }
    for (let a = m._from; a < m._to; a++) {
      if (!cw[a]) continue
      cx[a] += dx[a]; cy[a] += dy[a]
    }
  }

  // Плёнка: свободная поверхность подтягивается к средней по соседям, иначе
  // она вечно шершавая на масштабе частицы.
  _film(s, m) {
    const st = m.film
    if (st <= 0) return
    const { idx, nbr, nc, dx, dy, surf, snx, sny, cx, cy, cw } = this
    const h2 = m.h2
    const lim = 0.04 * m.spacing   // без клипа связь идёт вразнос при жёсткости выше 0.35
    dx.fill(0, m._from, m._to); dy.fill(0, m._from, m._to)
    for (let a = m._from; a < m._to; a++) {
      if (!surf[a]) continue
      const xi = cx[a], yi = cy[a]
      const nx = snx[a], ny = sny[a], tx = -ny, ty = nx
      // Соседей берём ПО ОДНОМУ С КАЖДОЙ СТОРОНЫ вдоль касательной. Просто
      // «двое ближайших» то и дело оказываются с одной стороны — там, где
      // плёнка локально в две частицы, — и кривизна выходит фиктивной.
      let p = -1, q = -1, r1 = 1e9, r2 = 1e9
      const base = a * MAXN, cnt = nc[a]
      for (let u = 0; u < cnt; u++) {
        const b = nbr[base + u]
        if (!surf[b]) continue
        const ddx = cx[b] - xi, ddy = cy[b] - yi
        const rr = ddx * ddx + ddy * ddy
        if (rr >= h2) continue
        const sgn = ddx * tx + ddy * ty
        if (sgn > 0) { if (rr < r1) { r1 = rr; p = b } } else if (sgn < 0) { if (rr < r2) { r2 = rr; q = b } }
      }
      if (p < 0 || q < 0) continue      // край плёнки — выпрямлять нечего
      const mx = 0.5 * (cx[p] + cx[q]), my = 0.5 * (cy[p] + cy[q])
      const C = (xi - mx) * nx + (yi - my) * ny
      let l = -st * C / 1.5            // Σ|∇C|² = 1 + ¼ + ¼
      if (l > lim) l = lim; else if (l < -lim) l = -lim
      // Соседям возвращается по половине: связь обязана сохранять импульс,
      // иначе она сама себя раскачивает.
      dx[a] += l * nx; dy[a] += l * ny
      const half = 0.5 * l
      dx[p] -= half * nx; dy[p] -= half * ny
      dx[q] -= half * nx; dy[q] -= half * ny
    }
    for (let a = m._from; a < m._to; a++) {
      if (!cw[a]) continue
      cx[a] += dx[a]; cy[a] += dy[a]
    }
  }

  // Вязкость, завихрение и натяжение — на скоростях, после проекции.
  // Ограничитель скорости. За подшаг частица не вправе уйти дальше радиуса
  // ядра: иначе список соседей, построенный в начале подшага, к его концу
  // описывает уже другую конфигурацию. На спокойной воде не срабатывает; нужен
  // там, где струя бьёт в дно.
  _clamp(s, h) {
    const { idx } = this
    for (const m of this.mediums) {
      const vmax = m.h / h, v2 = vmax * vmax
      for (let a = m._from; a < m._to; a++) {
        const i = idx[a]
        const sp = s.vx[i] * s.vx[i] + s.vy[i] * s.vy[i]
        if (sp <= v2) continue
        const k = vmax / Math.sqrt(sp)
        s.vx[i] *= k; s.vy[i] *= k
      }
    }
  }

  velocity(phys, h) {
    if (!this.count) return
    // Вязкость, натяжение и смачивание копятся по соседям — самая дорогая
    // часть после плотности. Прикладывать их каждый подшаг незачем: это силы,
    // а не ограничения, и от дробления они не становятся точнее. Раз за кадр,
    // как в эталоне.
    if (phys.lastSub === false) { this._clamp(phys.store, h); return }
    const s = phys.store
    for (const m of this.mediums) this._visc(s, m, h)
    // Тяжесть у каждой точки своя — этим и пользуемся.
    const ix = this.idx, bu = this.buoy
    for (let a = 0, n = this.count; a < n; a++) s.gscale[ix[a]] = 1 + bu[a] * BUOY
  }

  _visc(s, m, h) {
    const { idx, nbr, nc, rho, cx, cy, cm, cvx, cvy, buoy } = this
    const P6 = m.POLY6, h2 = m.h2, hh = m.h, SP = m.SPIKY
    const selfW = P6 * h2 * h2 * h2
    const rest0 = m.rest0, rhoU = m.rhoUnit, invRest = 1 / m.rest0
    const visc = m.viscosity, coh = m.cohesion, adh = m.adhesion
    for (let a = m._from; a < m._to; a++) {
      const i = idx[a]
      const xi = cx[a], yi = cy[a], ux = cvx[a], uy = cvy[a]
      const base = a * MAXN, cnt = nc[a]
      let vx = 0, vy = 0, hx = 0, hy = 0
      // Шепардовы суммы для выталкивания копим здесь же: отдельный проход по
      // тем же соседям — лишний обход всей памяти среды.
      let smw = selfW * cm[a], sw = selfW
      for (let u = 0; u < cnt; u++) {
        const b = nbr[base + u]
        const dx = xi - cx[b], dy = yi - cy[b]
        const r2 = dx * dx + dy * dy
        if (r2 >= h2 || r2 < 1e-14) continue
        const t = h2 - r2, w = P6 * t * t * t
        smw += cm[b] * w; sw += w
        const vol = cm[b] / (rho[b] || m.rest0)
        vx += (cvx[b] - ux) * w * vol; vy += (cvy[b] - uy) * w * vol
        if (coh > 0) {
          const r = Math.sqrt(r2)
          const Kij = 2 * m.rest0 / (rho[a] + rho[b] + 1e-9)
          const Cc = Kij * cohSpline(r, hh, m.COH) * (cm[b] / m.rest0) / r
          hx -= Cc * dx; hy -= Cc * dy
        }
      }
      // Смачивание — свойство пары «среда и эта стенка»: долю берёт шершавость,
      // которую мир уже меряет гладкостью. Второго такого числа не нужно.
      let tx = coh * hx, ty = coh * hy
      const sb = s.bs[i]
      if (adh > 0 && sb < hh) {
        const k = adh * s.brg[i] * adhSpline(sb, hh)
        tx -= k * s.bnx[i]; ty -= k * s.bny[i]
      }
      buoy[a] = sw > 1e-9 ? (rest0 - smw * rhoU / sw) * invRest : 0
      cvx[a] = ux + visc * vx + tx * h
      cvy[a] = uy + visc * vy + ty * h
    }
  }
}

// Описание среды. Числа вещества приходят снаружи; всё, что зависит от шага
// частиц, считается здесь один раз.
// Одно ли это вещество. Сравниваем то, что определяет поведение: шаг укладки,
// плотность покоя и силы. Имя вещества не спрашиваем — оно украшение, а вода с
// подкрученной вязкостью уже не вода.
export function sameSubstance(m, o) {
  const eq = (a, b) => Math.abs(a - b) < 1e-9
  return eq(m.spacing, o.spacing)
    && eq(m.rest0, (o.mass ?? 1) * m.rhoUnit)
    && eq(m.viscosity, o.viscosity ?? 0.05)
    && eq(m.cohesion, o.cohesion ?? 0)
    && eq(m.adhesion, o.adhesion ?? 0)
    && eq(m.film, o.film ?? 1)
}

export function makeMedium(o) {
  const spacing = o.spacing
  const h = spacing * 2.6
  const K = makeKernels(h)
  const cal = calibrate(h, spacing)

  // Плотность покоя НЕ задаётся числом — она следует из массы частицы и шага
  // укладки. В эталоне было наоборот: там масса выводилась из выбранной
  // плотности. Здесь частица — точка мира, её вес задан в единицах мира, и
  // подгонять надо то, что осталось. Ошибиться тут — значит получить среду,
  // которая либо не держит объём вовсе, либо взрывается.
  const mass = o.mass ?? 1
  const rest0 = cal.rhoUnit * mass

  // Нормировка сплайна когезии Akinci: ∫C dA = 1 по кругу радиуса h. Число
  // считается, а не подбирается.
  let acc = 0
  const M = 2048
  for (let m = 0; m < M; m++) {
    const r = h * (m + 0.5) / M
    acc += cohSpline(r, h, 1) * 2 * Math.PI * r * (h / M)
  }

  const dq = 0.2 * h
  const t = h * h - dq * dq
  return {
    id: o.id,
    points: o.points || [],
    bounds: o.bounds || null,
    spacing, h, h2: K.h2, POLY6: K.POLY6, SPIKY: K.SPIKY,
    rhoUnit: cal.rhoUnit, gradSum: cal.gradSum, mass, rest0,
    K: SCORR / cal.gradSum,   // искусственное давление тоже нормировано
    viscosity: o.viscosity ?? 0.05,
    cohesion: o.cohesion ?? 0,
    adhesion: o.adhesion ?? 0,
    film: o.film ?? 1,
    COH: 1 / acc,
    dq, wq: K.POLY6 * t * t * t,
    btab: buildBoundaryTable(h, K.POLY6),
    removed: false,
  }
}
