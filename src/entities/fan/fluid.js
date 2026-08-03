// Сетчатый решатель течения (схема Stable Fluids, только скорость).
// Живёт внутри сущности «вентилятор» и никому больше не нужен.
//
// Почему сетка, а не формулы: всё, что просили, получается само.
// Проекция делает поле бездивергентным — в узком месте тот же расход
// проходит через меньшее сечение, и скорость растёт. Несколько вентиляторов
// складываются, потому что вливают скорость в одно и то же поле.
// Преграды помечены в сетке, и поток их обтекает.

const idx = (f, i, j) => i + j * f.nx

export function createField(w, h, cell) {
  const nx = Math.max(4, Math.ceil(w / cell))
  const ny = Math.max(4, Math.ceil(h / cell))
  const n = nx * ny
  return {
    nx, ny, cell, w, h,
    u: new Float32Array(n), v: new Float32Array(n),
    u0: new Float32Array(n), v0: new Float32Array(n),
    p: new Float32Array(n), div: new Float32Array(n),
    solid: new Uint8Array(n),
  }
}

// Перечитать преграды: что твёрдо, там воздуха нет
export function markSolids(f, isSolid) {
  for (let j = 0; j < f.ny; j++) {
    for (let i = 0; i < f.nx; i++) {
      const k = idx(f, i, j)
      const s = isSolid((i + 0.5) * f.cell, (j + 0.5) * f.cell) ? 1 : 0
      f.solid[k] = s
      if (s) { f.u[k] = 0; f.v[k] = 0 }
    }
  }
}

// Вентилятор вливает импульс в горловину. Именно вливает, а не задаёт:
// иначе два вентилятора в одном месте давали бы ту же скорость, что один.
export function inject(f, x, y, dx, dy, radius, speed, blend) {
  const r = Math.max(1, radius / f.cell)
  const ci = x / f.cell, cj = y / f.cell
  const i0 = Math.max(0, Math.floor(ci - r)), i1 = Math.min(f.nx - 1, Math.ceil(ci + r))
  const j0 = Math.max(0, Math.floor(cj - r)), j1 = Math.min(f.ny - 1, Math.ceil(cj + r))
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const k = idx(f, i, j)
      if (f.solid[k]) continue
      const d = Math.hypot(i + 0.5 - ci, j + 0.5 - cj)
      if (d > r) continue
      const w = blend * (1 - (d / r) * 0.55)
      f.u[k] += dx * speed * w
      f.v[k] += dy * speed * w
    }
  }
}

function project(f, iters) {
  const { nx, ny, u, v, p, div, solid } = f
  p.fill(0)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = idx(f, i, j)
      if (solid[k]) { div[k] = 0; continue }
      const l = i > 0 ? idx(f, i - 1, j) : k
      const r = i < nx - 1 ? idx(f, i + 1, j) : k
      const t = j > 0 ? idx(f, i, j - 1) : k
      const b = j < ny - 1 ? idx(f, i, j + 1) : k
      // сквозь преграду потока нет: берём скорость самой клетки
      const ur = solid[r] ? 0 : u[r], ul = solid[l] ? 0 : u[l]
      const vb = solid[b] ? 0 : v[b], vt = solid[t] ? 0 : v[t]
      div[k] = -0.5 * (ur - ul + vb - vt)
    }
  }
  for (let n = 0; n < iters; n++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = idx(f, i, j)
        if (solid[k]) continue
        // Края уровня — открытая граница: давление за ней нулевое, воздух
        // может уйти. Если считать их глухой стеной, поле оказывается
        // в закрытом ящике и струя гаснет.
        let sum = 0, cnt = 0
        if (i > 0) { if (!solid[k - 1]) { sum += p[k - 1]; cnt++ } } else cnt++
        if (i < nx - 1) { if (!solid[k + 1]) { sum += p[k + 1]; cnt++ } } else cnt++
        if (j > 0) { if (!solid[k - nx]) { sum += p[k - nx]; cnt++ } } else cnt++
        if (j < ny - 1) { if (!solid[k + nx]) { sum += p[k + nx]; cnt++ } } else cnt++
        if (!cnt) continue
        p[k] = (div[k] + sum) / cnt
      }
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = idx(f, i, j)
      if (solid[k]) continue
      const l = i > 0 && !solid[k - 1] ? k - 1 : k
      const r = i < nx - 1 && !solid[k + 1] ? k + 1 : k
      const t = j > 0 && !solid[k - nx] ? k - nx : k
      const b = j < ny - 1 && !solid[k + nx] ? k + nx : k
      u[k] -= 0.5 * (p[r] - p[l])
      v[k] -= 0.5 * (p[b] - p[t])
    }
  }
}

function advect(f, dt) {
  const { nx, ny, u, v, u0, v0, solid, cell } = f
  u0.set(u); v0.set(v)
  const s = (dt * 1) / cell
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = idx(f, i, j)
      if (solid[k]) continue
      let x = i - u0[k] * s
      let y = j - v0[k] * s
      x = Math.max(0, Math.min(nx - 1.001, x))
      y = Math.max(0, Math.min(ny - 1.001, y))
      const i0 = Math.floor(x), j0 = Math.floor(y)
      const fx = x - i0, fy = y - j0
      const a = idx(f, i0, j0), b = idx(f, i0 + 1, j0), c = idx(f, i0, j0 + 1), d = idx(f, i0 + 1, j0 + 1)
      const mix = (arr) =>
        (arr[a] * (1 - fx) + arr[b] * fx) * (1 - fy) + (arr[c] * (1 - fx) + arr[d] * fx) * fy
      u[k] = mix(u0)
      v[k] = mix(v0)
    }
  }
}

export function step(f, dt, { iters = 24, damping = 0.997 } = {}) {
  project(f, iters)
  advect(f, dt)
  project(f, iters)
  for (let k = 0; k < f.u.length; k++) {
    if (f.solid[k]) { f.u[k] = 0; f.v[k] = 0; continue }
    f.u[k] *= damping
    f.v[k] *= damping
  }
}

// Скорость воздуха в точке мира
export function sample(f, x, y) {
  const cx = Math.max(0, Math.min(f.nx - 1.001, x / f.cell - 0.5))
  const cy = Math.max(0, Math.min(f.ny - 1.001, y / f.cell - 0.5))
  const i0 = Math.floor(cx), j0 = Math.floor(cy)
  const fx = cx - i0, fy = cy - j0
  const a = idx(f, i0, j0), b = idx(f, i0 + 1, j0), c = idx(f, i0, j0 + 1), d = idx(f, i0 + 1, j0 + 1)
  const mix = (arr) =>
    (arr[a] * (1 - fx) + arr[b] * fx) * (1 - fy) + (arr[c] * (1 - fx) + arr[d] * fx) * fy
  return { x: mix(f.u), y: mix(f.v) }
}
