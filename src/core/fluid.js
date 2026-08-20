// Среда: вода и всё, у чего есть объём, но нет формы.
//
// Написано по каноническому APIC/FLIP на разнесённой (MAC) сетке — Bridson, «Fluid
// Simulation for Computer Graphics»; вариационные граничные условия — Batty, Bertails,
// Bridson (2007); аффинный перенос — Jiang et al. (2015). Порядок шага канонический:
//
//   1. частицы → сетка          (APIC: скорость плюс её локальный градиент)
//   2. пометить клетки          (метод маркеров: где лежит частица, там жидкость)
//   3. граничные условия камня  (доли граней, свободные от камня)
//   4. проекция давления        (несжимаемость)
//   5. продлить поле наружу     (чтобы у кромки не читались нули)
//   6. сетка → частицы          (APIC обратно)
//
// Отдельно, уже позиционно, частицы растаскиваются друг от друга (см. separate).
//
// ЧТО ЗДЕСЬ ВАЖНО ПОНЯТЬ ПРО ПЕРЕНОС
//
// Перенос частица → сетка → частица теряет всё, что мельче клетки. PIC теряет честно и
// потому вязок: струя гаснет, водоворот не заводится. FLIP не теряет, потому что
// возвращает частице только поправку к её же скорости, — но у поля частиц оказывается
// больше степеней свободы, чем у сетки, и лишние живут своей жизнью: это известный шум
// FLIP. APIC закрывает дыру: частица несёт ещё и аффинную часть поля вокруг себя —
// матрицу 2×2, то есть локальные сдвиг и вращение. Момент импульса сохраняется, вихрь не
// теряется, лишних степеней свободы не заводится. Вязкость перестаёт быть лекарством от
// шума и снова означает свойство вещества.
//
// Ядро — квадратичный B-сплайн (3×3), а не билинейное. Это не украшение: у APIC матрица
// D = Σ w·d·dᵀ должна быть обратима, а у билинейного ядра она вырождается ровно на линиях
// граней. У квадратичного D = ¼h²·I тождественно, и обратная берётся одним числом.
//
// ПРО СВОБОДНУЮ ПОВЕРХНОСТЬ
//
// Давление в клетке воздуха равно нулю. Это каноническое условие первого порядка, и
// поля расстояний до поверхности жидкости здесь нет вовсе: клетку водяной объявляют
// частицы, и больше ничего для давления не нужно. Метод фиктивной жидкости (второй
// порядок, давление обращается в ноль там, где проходит настоящая кромка) здесь стоял
// и был убран: он требует знакового расстояния до поверхности, а любая его приближённая
// замена начинает требовать подгонки. Поле поверхности нужно ОТРИСОВКЕ — там оно и
// живёт, в core/contour.js, и подгонки не требует.

import { regionDistance } from './grid.js'
import { clamp } from './geom.js'

const AIR = 0, FLUID = 1
const f64 = (n) => new Float64Array(n)

// Какая доля отрезка свободна от камня, если на его концах знаковое расстояние равно
// a и b. Линейная оценка — та самая доля клетки, ради которой поле расстояний и
// заводится: грань, наполовину перекрытая берегом, пропускает половину потока.
function openPart(a, b) {
  if (a >= 0 && b >= 0) return 1
  if (a < 0 && b < 0) return 0
  return a < 0 ? 1 - a / (a - b) : 1 - b / (b - a)
}

export class Fluid {
  constructor(physics) {
    this.ph = physics
    this.phases = [null]        // 0 — «не среда»
    this.list = []
    this.n = 0

    // Сетка
    this.cell = 24
    this.cellRatio = 2          // клетка = два шага частиц: в неё попадает несколько
    this.nx = 0; this.ny = 0; this.x0 = 0; this.y0 = 0

    // Поля на гранях (MAC)
    this.u = f64(0); this.v = f64(0)          // скорости, px/с
    this.pu = f64(0); this.pv = f64(0)        // они же до проекции — для доли FLIP
    this.wu = f64(0); this.wv = f64(0)        // веса раскладки
    this.ku = new Uint8Array(0); this.kv = new Uint8Array(0)   // где на грани есть данные
    this.au = f64(0); this.av = f64(0)        // доля грани, свободная от камня

    // Поля в клетках
    this.type = new Uint8Array(0)
    this.dens = f64(0); this.cnt = f64(0)     // масса и число частиц — для плотности
    this.pres = f64(0); this.div = f64(0); this.rho = f64(0)
    this.phi = f64(0)                         // расстояние до поверхности, у кромки
    this.lw = f64(0); this.lx = f64(0); this.ly = f64(0)

    // Камень
    this.phiS = f64(0)                        // знаковое расстояние, в узлах
    this.solidKey = ''

    // Решатель давления
    this.iterations = 30        // мало, потому что начинаем с прошлого решения
    this.over = 1.7             // релаксация Гаусса — Зейделя

    // Расталкивание частиц
    this.sep = 1                // не ближе шага; подгонять здесь нечего
    this.head = null; this.next = null

    // Рабочие буферы ядра: три веса и три смещения на составляющую
    this._wx = new Float64Array(3); this._wy = new Float64Array(3)
    this._dx = new Float64Array(3); this._dy = new Float64Array(3)
  }

  // ---- вещества -------------------------------------------------------------
  addPhase(o = {}) {
    if (o.key) {
      const had = this.phases.find((f) => f && f.key === o.key)
      if (had) return had
    }
    const ph = {
      id: this.phases.length,
      key: o.key || null,
      spacing: o.spacing ?? 11,
      mass: o.mass ?? 1,
      // Доля аффинной части, которую вещество ТЕРЯЕТ при переносе. 0 — чистый APIC:
      // вихрь и сдвиг сохраняются, вода живая. 1 — чистый PIC: внутри клетки не
      // остаётся ничего, кроме среднего, и всё вязнет, как мёд.
      viscosity: clamp(o.viscosity ?? 0.06, 0, 1),
      // Доля FLIP в ответе. APIC самодостаточен, по умолчанию её нет.
      flip: clamp(o.flip ?? 0, 0, 1),
    }
    this.phases.push(ph)
    return ph
  }

  // ---- подготовка сетки -----------------------------------------------------
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
    // Сетку прибиваем к мировым координатам: иначе она ползала бы вслед за рамкой воды и
    // поле расстояний до камня пришлось бы считать каждый кадр. Запас в три клетки —
    // чтобы ядро 3×3 нигде не упиралось в край.
    this.x0 = Math.floor(x0 / cell - 3) * cell
    this.y0 = Math.floor(y0 / cell - 3) * cell
    this.nx = Math.ceil((x1 - this.x0) / cell) + 4
    this.ny = Math.ceil((y1 - this.y0) / cell) + 4
    this._alloc()
    this._solid()
    return true
  }

  _alloc() {
    const { nx, ny } = this
    const nu = (nx + 1) * ny, nv = nx * (ny + 1), nc = nx * ny, nn = (nx + 1) * (ny + 1)
    if (this.u.length < nu) {
      this.u = f64(nu); this.pu = f64(nu); this.wu = f64(nu)
      this.ku = new Uint8Array(nu); this.au = f64(nu)
    }
    if (this.v.length < nv) {
      this.v = f64(nv); this.pv = f64(nv); this.wv = f64(nv)
      this.kv = new Uint8Array(nv); this.av = f64(nv)
    }
    if (this.type.length < nc) {
      this.type = new Uint8Array(nc); this.dens = f64(nc); this.cnt = f64(nc)
      this.pres = f64(nc); this.div = f64(nc); this.rho = f64(nc)
      this.phi = f64(nc); this.lw = f64(nc); this.lx = f64(nc); this.ly = f64(nc)
    }
    if (this.phiS.length < nn) this.phiS = f64(nn)
  }

  // Знаковое расстояние до камня в узлах и доли граней из него. Пересчитывается только
  // когда сдвинулась сетка или менялась геометрия: раскопка, поехавший объект.
  _solid() {
    let stamp = 0
    for (const c of this.ph.colliders) stamp = (stamp * 31 + (c.stamp || 0) + Math.round(c.bbox.x + c.bbox.y)) | 0
    const key = `${stamp}|${this.x0}|${this.y0}|${this.nx}|${this.ny}|${this.cell}`
    if (key === this.solidKey) return
    this.solidKey = key
    const { nx, ny, cell, x0, y0, phiS, au, av } = this
    const far = cell * 2
    const cols = this.ph.colliders
    for (let j = 0; j <= ny; j++) {
      const y = y0 + j * cell
      for (let i = 0; i <= nx; i++) {
        const x = x0 + i * cell
        let d = far
        for (const c of cols) {
          const bb = c.bbox
          if (!bb) continue
          if (x < bb.x - far || x > bb.x + bb.w + far || y < bb.y - far || y > bb.y + bb.h + far) continue
          const t = regionDistance(c, x, y, far)
          if (t < d) d = t
        }
        // Узел ровно на границе даёт ноль, а ноль двусмыслен: грань вдоль стенки из двух
        // таких узлов формально «свободна», и пол с обеими стенами начинают пропускать
        // воду на клетку вглубь. Считаем такой узел лежащим в камне на ничтожную
        // величину — тогда грань ПО стенке закрыта, а грань ВДОЛЬ неё открыта.
        const e = d - cell * 1e-4
        phiS[i + j * (nx + 1)] = e < -far ? -far : e
      }
    }
    // Грань u стоит вертикально между двумя узлами столбца, грань v — горизонтально
    // между двумя узлами строки.
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i <= nx; i++) {
        au[i + j * (nx + 1)] = openPart(phiS[i + j * (nx + 1)], phiS[i + (j + 1) * (nx + 1)])
      }
    }
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i < nx; i++) {
        av[i + j * nx] = openPart(phiS[i + j * (nx + 1)], phiS[i + 1 + j * (nx + 1)])
      }
    }
  }

  // ---- ядро -----------------------------------------------------------------
  // Квадратичный B-сплайн: три узла, сумма весов ровно единица, производная непрерывна.
  // Отсюда и D = ¼h²·I, из-за которой APIC вообще считается.
  _kernel(t, lo, hi, w) {
    let base = Math.floor(t - 0.5)
    if (base < lo) base = lo
    if (base > hi) base = hi
    const f = t - base            // в норме 0.5…1.5
    const a = 1.5 - f, b = f - 1, c = f - 0.5
    w[0] = 0.5 * a * a
    w[1] = 0.75 - b * b
    w[2] = 0.5 * c * c
    return base
  }

  // ---- главный шаг ----------------------------------------------------------
  // Вызывается ДО переноса, по скоростям в px/с, уже получившим тяжесть. Поэтому
  // давление уравновешивает вес в том же подшаге, а не догоняет с отставанием.
  project(h) {
    if (!this.n) return
    this._toGrid()
    this._levelSet()
    this._solve()
    this._extrapolate()
    this._constrain()
    this._toParticles()
  }

  // 1–3. Частицы → грани клеток, разметка клеток, граничные условия камня.
  //
  // APIC: узел получает не саму скорость частицы, а её значение В ЭТОМ УЗЛЕ,
  // восстановленное по аффинной части: v + C·d.
  _toGrid() {
    const { nx, ny, cell, x0, y0, u, v, wu, wv, pu, pv, dens, cnt, type, list, n, au, av, ku, kv } = this
    const wx = this._wx, wy = this._wy, dxs = this._dx, dys = this._dy
    const nu = (nx + 1) * ny, nv = nx * (ny + 1), nc = nx * ny
    u.fill(0, 0, nu); v.fill(0, 0, nv); wu.fill(0, 0, nu); wv.fill(0, 0, nv)
    dens.fill(0, 0, nc); cnt.fill(0, 0, nc); type.fill(AIR, 0, nc)

    for (let a = 0; a < n; a++) {
      const p = list[a]
      const m = this.phases[p.phase].mass
      const gx = (p.x - x0) / cell, gy = (p.y - y0) / cell

      // Метод маркеров: клетка водяная тогда и только тогда, когда в ней лежит частица.
      const ci = clamp(Math.floor(gx), 0, nx - 1), cj = clamp(Math.floor(gy), 0, ny - 1)
      type[ci + cj * nx] = FLUID

      // Плотность размазываем тем же ядром, что и скорость. Жёсткая разбивка «частица
      // целиком в своей клетке» даёт полосатое поле: сдвиг на пиксель через границу
      // клетки переносит целую единицу массы.
      let di = this._kernel(gx - 0.5, 0, nx - 3, wx)
      let dj = this._kernel(gy - 0.5, 0, ny - 3, wy)
      for (let jj = 0; jj < 3; jj++) {
        const row = (dj + jj) * nx
        for (let ii = 0; ii < 3; ii++) {
          const w = wx[ii] * wy[jj]
          if (w <= 0) continue
          const kk = di + ii + row
          dens[kk] += m * w; cnt[kk] += w
        }
      }

      // грань u: узлы по x на краях клеток, по y — в серединах
      let bi = this._kernel(gx, 0, nx - 2, wx)
      let bj = this._kernel(gy - 0.5, 0, ny - 3, wy)
      for (let k = 0; k < 3; k++) {
        dxs[k] = (bi + k - gx) * cell
        dys[k] = (bj + k + 0.5 - gy) * cell
      }
      for (let jj = 0; jj < 3; jj++) {
        const row = (bj + jj) * (nx + 1)
        const wj = wy[jj]
        for (let ii = 0; ii < 3; ii++) {
          const w = wx[ii] * wj
          if (w <= 0) continue
          const kk = bi + ii + row
          u[kk] += w * (p.vx + p.cux * dxs[ii] + p.cuy * dys[jj])
          wu[kk] += w
        }
      }

      // грань v: узлы по x в серединах клеток, по y — на краях
      bi = this._kernel(gx - 0.5, 0, nx - 3, wx)
      bj = this._kernel(gy, 0, ny - 2, wy)
      for (let k = 0; k < 3; k++) {
        dxs[k] = (bi + k + 0.5 - gx) * cell
        dys[k] = (bj + k - gy) * cell
      }
      for (let jj = 0; jj < 3; jj++) {
        const row = (bj + jj) * nx
        const wj = wy[jj]
        for (let ii = 0; ii < 3; ii++) {
          const w = wx[ii] * wj
          if (w <= 0) continue
          const kk = bi + ii + row
          v[kk] += w * (p.vy + p.cvx * dxs[ii] + p.cvy * dys[jj])
          wv[kk] += w
        }
      }
    }

    for (let k = 0; k < nu; k++) { u[k] = wu[k] > 0 ? u[k] / wu[k] : 0; ku[k] = wu[k] > 0 ? 1 : 0 }
    for (let k = 0; k < nv; k++) { v[k] = wv[k] > 0 ? v[k] / wv[k] : 0; kv[k] = wv[k] > 0 ? 1 : 0 }

    // Полностью перекрытая камнем грань не пропускает ничего. Наполовину перекрытая
    // пропускает половину — и это не обнуление, а вес в уравнении: скорость на ней
    // остаётся, поэтому вода вдоль берега свободно скользит. Данными такая грань не
    // считается: её заполнит продление поля после решения.
    for (let k = 0; k < nu; k++) if (au[k] <= 0) { u[k] = 0; ku[k] = 0 }
    for (let k = 0; k < nv; k++) if (av[k] <= 0) { v[k] = 0; kv[k] = 0 }
    pu.set(u.subarray(0, nu)); pv.set(v.subarray(0, nv))
  }

  // 3б. Расстояние до поверхности жидкости — по Чжу и Бридсону (2005):
  //
  //      phi = |x − xср| − r,   xср — взвешенное среднее положение соседних частиц
  //
  // Нужно оно ровно для одного: для доли theta в условии на свободной поверхности.
  // Пересчитывать его в настоящее знаковое расстояние НЕ НАДО, и это главное, чего я
  // здесь долго не понимал.
  //
  // Формула точна у самой кромки и насыщается в глубине: замер на ровной воде даёт
  // −4.10 там, где истинное расстояние −4, и упирается в −r (радиус частицы), сколько
  // ни отходи вниз. Выглядит это как изъян, и я трижды пробовал его «исправить» —
  // согласовать поле с разметкой клеток, продлить расстояние в воздух, пересчитать по
  // Эйконалу. Каждый раз выходило хуже, и по делу: theta считается ТОЛЬКО на гранях,
  // где по одну сторону воздух, то есть только у кромки. Глубина в неё не входит
  // никогда, а пересчёт затирал именно те приповерхностные значения, ради которых
  // поле и считается.
  //
  // Радиус в формуле — ПОЛКЛЕТКИ, а не полшага частиц, и это то место, которого я
  // долго не понимал.
  //
  // Формула точна не везде, а в полосе шириной примерно в этот радиус: глубже среднее
  // положение соседей совпадает с узлом, и phi упирается в −r, сколько ни отходи вниз.
  // Значит полоса обязана покрывать хотя бы клетку — иначе theta не различает, на сколько
  // именно поверхность утоплена внутри клетки, и вся выгода от условия второго порядка
  // пропадает. У Чжу и Бридсона клетка сравнима с шагом частиц, и радиус частицы это
  // требование выполняет сам собой. У нас клетка вдвое крупнее шага, и привязывать радиус
  // надо к клетке.
  //
  // Проверка со ступенькой в два ряда (перекос через 0.5 / 2 / 12 с):
  //   r = полшага частиц   12.1 → 21.2 → 19.6 px — стоит, полоса уже клетки
  //   r = 0.4 клетки       13.0 →  2.9 →  1.3 px
  //   r = 0.5 клетки       12.1 →  4.4 →  0.5 px
  //   r = 0.6 клетки — лучшее и по ступеньке, и по ровной воде; на нём и стоит
  //   r = 0.6 клетки       11.9 →  3.7 → −0.2 px
  //
  // Прежнее «зерно 1.3 шага» было тем же самым числом, только записанным через шаг
  // частиц и потому выглядевшим подгонкой: 1.3 шага ≈ 0.65 клетки.
  _levelSet() {
    const { nx, ny, cell, x0, y0, list, n, phi, lw, lx, ly } = this
    const nc = nx * ny
    lw.fill(0, 0, nc); lx.fill(0, 0, nc); ly.fill(0, 0, nc)
    let step = Infinity
    for (const f of this.phases) if (f && f.spacing < step) step = f.spacing
    const R = Math.max(1.5 * step, cell), R2 = R * R
    const r = cell * 0.6
    for (let a = 0; a < n; a++) {
      const p = list[a]
      const gx = (p.x - x0) / cell - 0.5, gy = (p.y - y0) / cell - 0.5
      const rad = R / cell
      const i0 = Math.max(0, Math.ceil(gx - rad)), i1 = Math.min(nx - 1, Math.floor(gx + rad))
      const j0 = Math.max(0, Math.ceil(gy - rad)), j1 = Math.min(ny - 1, Math.floor(gy + rad))
      for (let j = j0; j <= j1; j++) {
        const dy = y0 + (j + 0.5) * cell - p.y
        for (let i = i0; i <= i1; i++) {
          const dx = x0 + (i + 0.5) * cell - p.x
          const d2 = dx * dx + dy * dy
          if (d2 >= R2) continue
          const t = 1 - d2 / R2
          const w = t * t * t
          const k = i + j * nx
          lw[k] += w; lx[k] += w * p.x; ly[k] += w * p.y
        }
      }
    }
    for (let k = 0; k < nc; k++) {
      const w = lw[k]
      if (w <= 0) { phi[k] = cell; continue }   // ни одной частицы рядом: заведомо воздух
      const i = k % nx, j = (k - i) / nx
      const dx = x0 + (i + 0.5) * cell - lx[k] / w
      const dy = y0 + (j + 0.5) * cell - ly[k] / w
      phi[k] = Math.hypot(dx, dy) - r
    }
  }

  // 4. Проекция давления.
  //
  // Вариационная постановка: доля грани, свободная от камня, входит и в расхождение, и
  // в матрицу. Давление в клетке воздуха равно нулю.
  //
  // Давление считается явно, а не подменяется раздачей поправки по граням, и причина в
  // разных веществах. Тяжесть добавляется всем одинаково ещё до проекции, поэтому
  // разница плотностей обязана войти в само уравнение: скорость правится на ∇p/ρ, и
  // лёгкое от того же перепада давления получает больше. Отсюда и всплытие, и
  // расслоение — без единого слова про них.
  _solve() {
    const { nx, ny, u, v, type, dens, cnt, au, av } = this
    const nc = nx * ny
    const p = this.pres, div = this.div, rho = this.rho

    for (let k = 0; k < nc; k++) rho[k] = cnt[k] > 0 ? dens[k] / cnt[k] : 1
    // Давление НЕ обнуляем: за подшаг картина меняется мало, и прошлое решение —
    // отличное начальное приближение. Гаусс — Зейдель сходится к тому же ответу с
    // любого старта, но с тёплого старта хватает тридцати проходов вместо восьмидесяти.
    for (let k = 0; k < nc; k++) if (type[k] !== FLUID) p[k] = 0

    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const k = i + j * nx
        if (type[k] !== FLUID) { div[k] = 0; continue }
        const ku = i + j * (nx + 1)
        div[k] = au[ku + 1] * u[ku + 1] - au[ku] * u[ku] + av[k + nx] * v[k + nx] - av[k] * v[k]
      }
    }

    // Доля отрезка между центрами клеток, занятая жидкостью: давление обращается в
    // ноль там, где проходит настоящая кромка, а не на краю клетки.
    const phi = this.phi
    const theta = (kf, ka) => {
      const a = phi[kf], b = phi[ka]
      if (a >= 0 || b <= 0) return 1        // знаки не разошлись — кромка не здесь
      const t = a / (a - b)
      return t < 0.02 ? 0.02 : t > 1 ? 1 : t
    }
    const coef = (kc, kn, W) => {
      if (W <= 0) return 0
      return type[kn] === FLUID ? W * 2 / (rho[kc] + rho[kn]) : W / (rho[kc] * theta(kc, kn))
    }

    for (let it = 0; it < this.iterations; it++) {
      for (let j = 1; j < ny - 1; j++) {
        for (let i = 1; i < nx - 1; i++) {
          const k = i + j * nx
          if (type[k] !== FLUID) continue
          const ku = i + j * (nx + 1)
          const cl = coef(k, k - 1, au[ku]), cr = coef(k, k + 1, au[ku + 1])
          const ct = coef(k, k - nx, av[k]), cb = coef(k, k + nx, av[k + nx])
          const sum = cl + cr + ct + cb
          if (sum <= 0) continue
          let acc = 0
          if (type[k - 1] === FLUID) acc += cl * p[k - 1]
          if (type[k + 1] === FLUID) acc += cr * p[k + 1]
          if (type[k - nx] === FLUID) acc += ct * p[k - nx]
          if (type[k + nx] === FLUID) acc += cb * p[k + nx]
          p[k] += this.over * ((-div[k] + acc) / sum - p[k])
        }
      }
    }

    // Скорость правится на перепад давления, делённый на плотность грани. Доля
    // свободного места сюда НЕ входит — она уже вошла в расхождение и в матрицу;
    // вошла бы дважды, и вода у берега поехала бы медленнее, чем в середине.
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx; i++) {
        const k = i + j * nx, f = i + j * (nx + 1)
        if (au[f] <= 0) { u[f] = 0; continue }
        const a = type[k - 1], b = type[k]
        if (a === FLUID && b === FLUID) u[f] -= (p[k] - p[k - 1]) * 2 / (rho[k] + rho[k - 1])
        else if (a === FLUID) u[f] += p[k - 1] / (rho[k - 1] * theta(k - 1, k))
        else if (b === FLUID) u[f] -= p[k] / (rho[k] * theta(k, k - 1))
      }
    }
    for (let j = 1; j < ny; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const k = i + j * nx
        if (av[k] <= 0) { v[k] = 0; continue }
        const a = type[k - nx], b = type[k]
        if (a === FLUID && b === FLUID) v[k] -= (p[k] - p[k - nx]) * 2 / (rho[k] + rho[k - nx])
        else if (a === FLUID) v[k] += p[k - nx] / (rho[k - nx] * theta(k - nx, k))
        else if (b === FLUID) v[k] -= p[k] / (rho[k] * theta(k, k - nx))
      }
    }
  }

  // 5. Продлить поле скоростей на грани, где вещества нет: в воздух над водой и вглубь
  // камня. Иначе ядро 3×3, которое достаёт на полторы клетки, приносит частице у
  // поверхности и у берега честные нули — а это прилипание, которого у среды быть не
  // должно. Трёх проходов хватает на весь шаблон.
  _extrapolate() {
    const { nx, ny, u, v, pu, pv } = this
    const sweep = (a, pa, mark, w, hh) => {
      for (let pass = 0; pass < 3; pass++) {
        const add = []
        for (let j = 0; j < hh; j++) {
          for (let i = 0; i < w; i++) {
            const k = i + j * w
            if (mark[k]) continue
            let s = 0, sp = 0, cn = 0
            if (i > 0 && mark[k - 1]) { s += a[k - 1]; sp += pa[k - 1]; cn++ }
            if (i < w - 1 && mark[k + 1]) { s += a[k + 1]; sp += pa[k + 1]; cn++ }
            if (j > 0 && mark[k - w]) { s += a[k - w]; sp += pa[k - w]; cn++ }
            if (j < hh - 1 && mark[k + w]) { s += a[k + w]; sp += pa[k + w]; cn++ }
            if (!cn) continue
            a[k] = s / cn; pa[k] = sp / cn
            add.push(k)
          }
        }
        for (const k of add) mark[k] = 2
      }
    }
    sweep(u, pu, this.ku, nx + 1, ny)
    sweep(v, pv, this.kv, nx, ny + 1)
  }

  // 6. Восстановить условие непротекания у камня — уже по продлённому полю.
  //
  // Обнулить компоненту на грани нельзя по двум причинам. Во-первых, это разрыв поля, а
  // APIC несёт не только скорость, но и её градиент: частица у берега считывает разрыв
  // как огромный сдвиг и разносит его обратно на сетку. Во-вторых, ось сетки — не
  // нормаль берега: у наклонного склона обнуление горизонтальной составляющей запрещает
  // воде течь вдоль него. Правильно — вычесть из полного вектора его нормальную
  // составляющую, где нормаль берётся из градиента поля расстояний.
  _constrain() {
    const { nx, ny, u, v, au, av, phiS, cell } = this
    const w1 = nx + 1
    const phi = (gx, gy) => {
      const i = Math.min(Math.max(Math.floor(gx), 0), nx - 1)
      const j = Math.min(Math.max(Math.floor(gy), 0), ny - 1)
      const tx = gx - i, ty = gy - j
      return phiS[i + j * w1] * (1 - tx) * (1 - ty) + phiS[i + 1 + j * w1] * tx * (1 - ty)
           + phiS[i + (j + 1) * w1] * (1 - tx) * ty + phiS[i + 1 + (j + 1) * w1] * tx * ty
    }
    const n = [0, 0]
    const norm = (gx, gy) => {
      const e = 0.25
      const ax = phi(gx + e, gy) - phi(gx - e, gy)
      const ay = phi(gx, gy + e) - phi(gx, gy - e)
      const d = Math.hypot(ax, ay)
      if (d < 1e-9) return false
      n[0] = ax / d; n[1] = ay / d
      return true
    }
    const at = (a, i, j, w, h) => a[Math.min(Math.max(i, 0), w - 1) + Math.min(Math.max(j, 0), h - 1) * w]
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const f = i + j * w1
        if (au[f] >= 1) continue                       // грань целиком в воде
        if (!norm(i, j + 0.5)) continue
        const vv = (at(v, i - 1, j, nx, ny + 1) + at(v, i, j, nx, ny + 1)
                  + at(v, i - 1, j + 1, nx, ny + 1) + at(v, i, j + 1, nx, ny + 1)) * 0.25
        u[f] -= n[0] * (n[0] * u[f] + n[1] * vv)
      }
    }
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i < nx; i++) {
        const f = i + j * nx
        if (av[f] >= 1) continue
        if (!norm(i + 0.5, j)) continue
        const uu = (at(u, i, j - 1, w1, ny) + at(u, i + 1, j - 1, w1, ny)
                  + at(u, i, j, w1, ny) + at(u, i + 1, j, w1, ny)) * 0.25
        v[f] -= n[1] * (n[0] * uu + n[1] * v[f])
      }
    }
  }

  // 7. Обратно частицам. Забираем и скорость, и аффинную часть: C = 4/h²·Σ w·u·d.
  //    Множитель 4/h² — это D⁻¹ для квадратичного ядра (D = ¼h²·I).
  _toParticles() {
    const { nx, ny, cell, x0, y0, u, v, pu, pv, list, n } = this
    const wx = this._wx, wy = this._wy, dxs = this._dx, dys = this._dy
    const invD = 4 / (cell * cell)
    for (let a = 0; a < n; a++) {
      const p = list[a]
      if (p.pinned) continue
      const ph = this.phases[p.phase]
      const keep = 1 - ph.viscosity   // сколько аффинной части переживает перенос
      const flip = ph.flip
      const gx = (p.x - x0) / cell, gy = (p.y - y0) / cell

      // --- составляющая u
      let bi = this._kernel(gx, 0, nx - 2, wx)
      let bj = this._kernel(gy - 0.5, 0, ny - 3, wy)
      for (let k = 0; k < 3; k++) {
        dxs[k] = (bi + k - gx) * cell
        dys[k] = (bj + k + 0.5 - gy) * cell
      }
      let vel = 0, was = 0, bx = 0, by = 0
      for (let jj = 0; jj < 3; jj++) {
        const row = (bj + jj) * (nx + 1)
        const wj = wy[jj]
        for (let ii = 0; ii < 3; ii++) {
          const kk = bi + ii + row
          const w = wx[ii] * wj
          vel += w * u[kk]; was += w * pu[kk]
          bx += w * u[kk] * dxs[ii]; by += w * u[kk] * dys[jj]
        }
      }
      p.vx = vel + flip * (p.vx - was)
      p.cux = keep * invD * bx
      p.cuy = keep * invD * by

      // --- составляющая v
      bi = this._kernel(gx - 0.5, 0, nx - 3, wx)
      bj = this._kernel(gy, 0, ny - 2, wy)
      for (let k = 0; k < 3; k++) {
        dxs[k] = (bi + k + 0.5 - gx) * cell
        dys[k] = (bj + k - gy) * cell
      }
      vel = 0; was = 0; bx = 0; by = 0
      for (let jj = 0; jj < 3; jj++) {
        const row = (bj + jj) * nx
        const wj = wy[jj]
        for (let ii = 0; ii < 3; ii++) {
          const kk = bi + ii + row
          const w = wx[ii] * wj
          vel += w * v[kk]; was += w * pv[kk]
          bx += w * v[kk] * dxs[ii]; by += w * v[kk] * dys[jj]
        }
      }
      p.vy = vel + flip * (p.vy - was)
      p.cvx = keep * invD * bx
      p.cvy = keep * invD * by
    }
  }

  // ---- расталкивание частиц -------------------------------------------------
  // Обычное позиционное ограничение, как контакт двух шаров.
  //
  // Объём держит сетка, а не это. Расталкивание нужно лишь затем, чтобы частицы не
  // сбивались комками: бездивергентное поле само по себе равномерности раскладки не
  // гарантирует, и это известное свойство FLIP. Канон лечит его пересевом частиц; здесь
  // проще растащить попарно — стоит это доли миллисекунды, а результат тот же.
  //
  // Проходов несколько, а списки соседей строятся один раз: за проход частица сдвигается
  // на доли пикселя, и запас клетки это покрывает.
  separate(passes = 1) {
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
    for (let pass = 0; pass < passes; pass++)
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
