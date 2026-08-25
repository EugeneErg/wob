// Жёсткая форма как ограничение (подгонка формы, shape matching).
//
// Каждую итерацию ищем оптимальные поворот и сдвиг исходного контура и
// подтягиваем к ним вершины. Даёт настоящее твёрдое тело с вращением и не
// засоряет граф связей — в отличие от «сшить всё со всем палками», где число
// связей растёт квадратом, а жёсткость всё равно зависит от числа итераций.
//
// В общем списке ограничений это ровно такое же позиционное ограничение, как
// связь или плотность: считает Δx, применяет Δx.

export class ShapeMatching {
  constructor() {
    this.name = 'shape'
    this.order = 20
  }

  project(phys) {
    const s = phys.store
    const X = s.x, Y = s.y, M = s.mass, W = s.w
    for (const b of phys.bodies) {
      const verts = b.verts
      const n = verts.length
      if (n < 2) continue

      let cx = 0, cy = 0, m = 0
      for (let k = 0; k < n; k++) {
        const i = verts[k]._i
        cx += X[i] * M[i]; cy += Y[i] * M[i]; m += M[i]
      }
      if (!m) continue
      cx /= m; cy /= m

      // Оптимальный поворот: θ = atan2(Σ q×p, Σ q·p). Замкнутая форма, без
      // итераций и без разложений — в 2D матрица поворота однопараметрическая.
      let num = 0, den = 0
      for (let k = 0; k < n; k++) {
        const i = verts[k]._i
        const q = b.rest[k]
        const dx = X[i] - cx, dy = Y[i] - cy
        num += q.x * dy - q.y * dx
        den += q.x * dx + q.y * dy
      }
      const th = Math.atan2(num, den)
      const co = Math.cos(th), si = Math.sin(th)
      const k0 = b.stiffness
      for (let k = 0; k < n; k++) {
        const i = verts[k]._i
        if (!W[i]) continue
        const q = b.rest[k]
        const gx = cx + q.x * co - q.y * si
        const gy = cy + q.x * si + q.y * co
        X[i] += (gx - X[i]) * k0
        Y[i] += (gy - Y[i]) * k0
      }
    }
  }
}
