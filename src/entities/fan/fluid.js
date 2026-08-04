// Сетчатый решатель течения на разнесённой (MAC) сетке.
// Живёт внутри сущности «вентилятор» и никому больше не нужен.
//
// Почему разнесённая, а не совмещённая: скорость хранится не в центре клетки,
// а на её гранях. Тогда «сквозь стену не течёт» — это ровно «нормальная грань
// равна нулю», и касательная составляющая у стены остаётся нетронутой.
// Поэтому поток скользит вдоль преграды и заворачивает за угол, а не гаснет
// в нём. На совмещённой сетке обнулять приходилось весь вектор соседа, и
// каждый поворот лабиринта съедал струю.
//
// Остальное выходит само: проекция делает поле бездивергентным — в узком месте
// тот же расход идёт через меньшее сечение, и скорость растёт; несколько
// вентиляторов складываются, потому что вливают в одно поле.

const CI = (f, i, j) => i + j * f.nx            // клетка
const UI = (f, i, j) => i + j * (f.nx + 1)      // вертикальная грань, i = 0..nx
const VI = (f, i, j) => i + j * f.nx            // горизонтальная грань, j = 0..ny

export function createField(w, h, cell) {
  const nx = Math.max(4, Math.ceil(w / cell))
  const ny = Math.max(4, Math.ceil(h / cell))
  const n = nx * ny
  return {
    nx, ny, cell, w, h,
    u: new Float32Array((nx + 1) * ny), v: new Float32Array(nx * (ny + 1)),
    u0: new Float32Array((nx + 1) * ny), v0: new Float32Array(nx * (ny + 1)),
    p: new Float32Array(n), div: new Float32Array(n),
    solid: new Uint8Array(n),
  }
}

// Обнулить грани твёрдой клетки: внутрь преграды воздух не течёт
function sealCell(f, i, j) {
  f.u[UI(f, i, j)] = 0
  f.u[UI(f, i + 1, j)] = 0
  f.v[VI(f, i, j)] = 0
  f.v[VI(f, i, j + 1)] = 0
}

// Перечитать преграды в полосе строк [j0, j1). Клетка считается твёрдой по
// большинству из пяти проб, а не по одной центральной: узкая траншея тогда
// остаётся проходимой, а тонкая стенка — непроницаемой.
export function markSolidsRows(f, isSolid, j0 = 0, j1 = f.ny) {
  const c = f.cell, q = c / 3
  for (let j = Math.max(0, j0); j < Math.min(f.ny, j1); j++) {
    for (let i = 0; i < f.nx; i++) {
      const x = (i + 0.5) * c, y = (j + 0.5) * c
      let hits = 0
      if (isSolid(x, y)) hits++
      if (isSolid(x - q, y)) hits++
      if (isSolid(x + q, y)) hits++
      if (isSolid(x, y - q)) hits++
      if (isSolid(x, y + q)) hits++
      const s = hits >= 3 ? 1 : 0
      f.solid[CI(f, i, j)] = s
      if (s) sealCell(f, i, j)
    }
  }
}

export const markSolids = (f, isSolid) => markSolidsRows(f, isSolid, 0, f.ny)

// Вентилятор вливает импульс в грани горловины. Именно вливает, а не задаёт:
// иначе два вентилятора в одном месте давали бы ту же скорость, что один.
export function inject(f, x, y, dx, dy, radius, speed, blend = 1) {
  const r = Math.max(1, radius / f.cell)
  const ci = x / f.cell, cj = y / f.cell
  const i0 = Math.max(0, Math.floor(ci - r - 1)), i1 = Math.min(f.nx - 1, Math.ceil(ci + r + 1))
  const j0 = Math.max(0, Math.floor(cj - r - 1)), j1 = Math.min(f.ny - 1, Math.ceil(cj + r + 1))
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      if (f.solid[CI(f, i, j)]) continue
      const d = Math.hypot(i + 0.5 - ci, j + 0.5 - cj)
      if (d > r) continue
      const w = blend * (1 - (d / r) * 0.55)
      // грань получает импульс, только если она не упирается в преграду
      if (i > 0 && !f.solid[CI(f, i - 1, j)]) f.u[UI(f, i, j)] += dx * speed * w * 0.5
      if (i < f.nx - 1 && !f.solid[CI(f, i + 1, j)]) f.u[UI(f, i + 1, j)] += dx * speed * w * 0.5
      if (j > 0 && !f.solid[CI(f, i, j - 1)]) f.v[VI(f, i, j)] += dy * speed * w * 0.5
      if (j < f.ny - 1 && !f.solid[CI(f, i, j + 1)]) f.v[VI(f, i, j + 1)] += dy * speed * w * 0.5
    }
  }
}

// Проекция: убираем из поля дивергенцию. Края уровня — открытая граница,
// давление за ней нулевое: воздух свободно уходит наружу и приходит снаружи,
// иначе поле оказывается в закрытом ящике и струя гаснет.
function project(f, iters) {
  const { nx, ny, u, v, p, div, solid } = f
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = CI(f, i, j)
      if (solid[k]) { div[k] = 0; p[k] = 0; continue }
      div[k] = u[UI(f, i + 1, j)] - u[UI(f, i, j)] + v[VI(f, i, j + 1)] - v[VI(f, i, j)]
    }
  }
  // Гаусс — Зейдель: свежие значения идут в дело сразу, сходится вдвое быстрее Якоби
  for (let n = 0; n < iters; n++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = CI(f, i, j)
        if (solid[k]) continue
        let sum = 0, cnt = 0
        if (i > 0) { if (!solid[k - 1]) { sum += p[k - 1]; cnt++ } } else cnt++
        if (i < nx - 1) { if (!solid[k + 1]) { sum += p[k + 1]; cnt++ } } else cnt++
        if (j > 0) { if (!solid[k - nx]) { sum += p[k - nx]; cnt++ } } else cnt++
        if (j < ny - 1) { if (!solid[k + nx]) { sum += p[k + nx]; cnt++ } } else cnt++
        if (!cnt) { p[k] = 0; continue }
        p[k] = (sum - div[k]) / cnt
      }
    }
  }
  // градиент давления снимаем только с граней между двумя жидкими клетками;
  // грань у стены остаётся нулевой — это и есть «сквозь стену не течёт»
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const kL = i > 0 ? CI(f, i - 1, j) : -1
      const kR = i < nx ? CI(f, i, j) : -1
      const sl = kL < 0 ? null : solid[kL], sr = kR < 0 ? null : solid[kR]
      const ui = UI(f, i, j)
      if (sl === 1 || sr === 1) { u[ui] = 0; continue }
      const pl = kL < 0 ? 0 : p[kL]
      const pr = kR < 0 ? 0 : p[kR]
      u[ui] -= pr - pl
    }
  }
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i < nx; i++) {
      const kT = j > 0 ? CI(f, i, j - 1) : -1
      const kB = j < ny ? CI(f, i, j) : -1
      const st = kT < 0 ? null : solid[kT], sb = kB < 0 ? null : solid[kB]
      const vi = VI(f, i, j)
      if (st === 1 || sb === 1) { v[vi] = 0; continue }
      const pt = kT < 0 ? 0 : p[kT]
      const pb = kB < 0 ? 0 : p[kB]
      v[vi] -= pb - pt
    }
  }
}

// скорость в произвольной точке сетки (координаты — в клетках)
function velAt(f, cx, cy) {
  return { x: lerpU(f, f.u, cx, cy), y: lerpV(f, f.v, cx, cy) }
}

function lerpU(f, U, cx, cy) {
  // u живёт в узлах (i, j+0.5)
  let x = Math.max(0, Math.min(f.nx, cx))
  let y = Math.max(0, Math.min(f.ny - 1e-3, cy - 0.5))
  if (y < 0) y = 0
  const i0 = Math.min(f.nx - 1, Math.floor(x)), j0 = Math.min(f.ny - 1, Math.floor(y))
  const fx = x - i0, fy = y - j0
  const j1 = Math.min(f.ny - 1, j0 + 1)
  const a = U[UI(f, i0, j0)], b = U[UI(f, i0 + 1, j0)]
  const c = U[UI(f, i0, j1)], d = U[UI(f, i0 + 1, j1)]
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
}

function lerpV(f, V, cx, cy) {
  // v живёт в узлах (i+0.5, j)
  let x = Math.max(0, Math.min(f.nx - 1e-3, cx - 0.5))
  if (x < 0) x = 0
  const y = Math.max(0, Math.min(f.ny, cy))
  const i0 = Math.min(f.nx - 1, Math.floor(x)), j0 = Math.min(f.ny - 1, Math.floor(y))
  const fx = x - i0, fy = y - j0
  const i1 = Math.min(f.nx - 1, i0 + 1)
  const a = V[VI(f, i0, j0)], b = V[VI(f, i1, j0)]
  const c = V[VI(f, i0, j0 + 1)], d = V[VI(f, i1, j0 + 1)]
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
}

const solidAtCell = (f, cx, cy) => {
  const i = Math.max(0, Math.min(f.nx - 1, Math.floor(cx)))
  const j = Math.max(0, Math.min(f.ny - 1, Math.floor(cy)))
  return f.solid[CI(f, i, j)] === 1
}

// Перенос поля самим полем. Если след уходит в преграду, грань оставляем как
// была: иначе стена «высасывала» бы касательную скорость, и струя вдоль
// коридора глохла бы у каждой стенки.
function advect(f, dt) {
  const { nx, ny, u, v, u0, v0, solid, cell } = f
  u0.set(u); v0.set(v)
  const s = dt / cell
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const ui = UI(f, i, j)
      if (i > 0 && i < nx && (solid[CI(f, i - 1, j)] || solid[CI(f, i, j)])) { u[ui] = 0; continue }
      const cx = i, cy = j + 0.5
      const px = cx - u0[ui] * s
      const py = cy - lerpV(f, v0, cx, cy) * s
      if (solidAtCell(f, px, py)) continue
      u[ui] = lerpU(f, u0, px, py)
    }
  }
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i < nx; i++) {
      const vi = VI(f, i, j)
      if (j > 0 && j < ny && (solid[CI(f, i, j - 1)] || solid[CI(f, i, j)])) { v[vi] = 0; continue }
      const cx = i + 0.5, cy = j
      const px = cx - lerpU(f, u0, cx, cy) * s
      const py = cy - v0[vi] * s
      if (solidAtCell(f, px, py)) continue
      v[vi] = lerpV(f, v0, px, py)
    }
  }
}

export function step(f, dt, { iters = 24, damping = 0.997 } = {}) {
  project(f, iters)
  advect(f, dt)
  project(f, iters)
  for (let k = 0; k < f.u.length; k++) f.u[k] *= damping
  for (let k = 0; k < f.v.length; k++) f.v[k] *= damping
}

// Скорость воздуха в точке мира
export function sample(f, x, y) {
  return velAt(f, x / f.cell, y / f.cell)
}

// Скорость в центре клетки — для отрисовки
export function cellVel(f, i, j) {
  return {
    x: (f.u[UI(f, i, j)] + f.u[UI(f, i + 1, j)]) * 0.5,
    y: (f.v[VI(f, i, j)] + f.v[VI(f, i, j + 1)]) * 0.5,
  }
}
