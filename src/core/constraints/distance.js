// Связь как податливое ограничение (XPBD).
//
// C = |x_b − x_a| − rest, податливость α = 1/spring. Множитель λ копится за
// подшаг и даёт настоящую силу: f = −λ/h². По ней видно натяжение и по ней
// рвётся связь.
//
// Почему не пружина силой k·x + c·v: у шара три связи, суммарное гашение даёт
// c·h/m > 1, гасящая сила за шаг перелетает через ноль и накачивает энергию —
// на четвёртом шаре конструкция взрывается. XPBD устойчив при любой жёсткости,
// потому что коррекция позиционная.

export class DistanceConstraints {
  constructor() {
    this.name = 'distance'
    this.order = 10
  }

  prepare(phys) {
    for (const l of phys.links) l.lambda = 0
  }

  // Гаусс — Зейдель: каждая связь видит уже исправленные предыдущими положения.
  // Для конструкции это правильный выбор — так жёсткость расходится по цепочке
  // за одну итерацию, а не за одну связь на итерацию.
  project(phys, h) {
    const s = phys.store
    const X = s.x, Y = s.y, W = s.w
    const inv = 1 / (h * h)
    for (const l of phys.links) {
      const ia = l.a._i, ib = l.b._i
      const w1 = W[ia], w2 = W[ib]
      const w = w1 + w2
      if (!w) continue
      const dx = X[ib] - X[ia], dy = Y[ib] - Y[ia]
      const d = Math.hypot(dx, dy) || 1e-9
      const nx = dx / d, ny = dy / d
      const C = d - l.rest
      const alpha = inv / l.spring
      const dl = (-C - alpha * l.lambda) / (w + alpha)
      l.lambda += dl
      X[ia] -= nx * dl * w1; Y[ia] -= ny * dl * w1
      X[ib] += nx * dl * w2; Y[ib] += ny * dl * w2
    }
  }

  // Гашение — фильтр скорости, а не сила: оно может только отнять
  // относительную скорость вдоль связи, но не добавить.
  velocity(phys) {
    const s = phys.store
    const X = s.x, Y = s.y, VX = s.vx, VY = s.vy, W = s.w
    for (const l of phys.links) {
      if (!l.damping) continue
      const ia = l.a._i, ib = l.b._i
      const w1 = W[ia], w2 = W[ib]
      const w = w1 + w2
      if (!w) continue
      const dx = X[ib] - X[ia], dy = Y[ib] - Y[ia]
      const d = Math.hypot(dx, dy) || 1e-9
      const nx = dx / d, ny = dy / d
      const vrel = (VX[ib] - VX[ia]) * nx + (VY[ib] - VY[ia]) * ny
      const k = l.damping * vrel
      VX[ia] += (k * nx * w1) / w; VY[ia] += (k * ny * w1) / w
      VX[ib] -= (k * nx * w2) / w; VY[ib] -= (k * ny * w2) / w
    }
  }

  // Натяжение = сила в связи; сглаживаем, чтобы не рвать от случайного всплеска.
  finish(phys, h) {
    const k = 1 / (h * h)
    let broken = null
    for (const l of phys.links) {
      const f = Math.max(0, -l.lambda * k)
      l.tension += (f - l.tension) * 0.05
      if (l.tension > l.breakForce) (broken ||= []).push(l)
    }
    if (broken) for (const l of broken) phys.removeLink(l)
  }
}
