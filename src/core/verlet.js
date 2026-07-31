// core/verlet.js
//
// Минимальные примитивы Verlet-интеграции. Сущности используют их
// для построения своей физики (шар — одна точка, связь — стик между
// точками двух шаров), но сам движок ничего не знает про типы сущностей.

export class VerletPoint {
  /**
   * @param {number} x
   * @param {number} y
   * @param {object} [opts]
   * @param {boolean} [opts.pinned] - зафиксирована ли точка (не двигается)
   * @param {number} [opts.radius]
   */
  constructor(x, y, opts = {}) {
    this.x = x
    this.y = y
    this.oldX = x
    this.oldY = y
    this.pinned = !!opts.pinned
    this.radius = opts.radius ?? 10
    // произвольные пользовательские данные сущности (id родителя и т.п.)
    this.meta = opts.meta ?? {}
  }

  update(dt, gravity, damping = 0.995) {
    if (this.pinned) return
    const vx = (this.x - this.oldX) * damping
    const vy = (this.y - this.oldY) * damping
    this.oldX = this.x
    this.oldY = this.y
    this.x += vx + gravity.x * dt * dt
    this.y += vy + gravity.y * dt * dt
  }

  applyImpulse(ix, iy) {
    if (this.pinned) return
    this.oldX -= ix
    this.oldY -= iy
  }

  setPosition(x, y) {
    this.x = x
    this.y = y
    this.oldX = x
    this.oldY = y
  }
}

export class VerletStick {
  /**
   * @param {VerletPoint} p1
   * @param {VerletPoint} p2
   * @param {object} [opts]
   * @param {number} [opts.length] - длина покоя (по умолчанию — текущее расстояние)
   * @param {number} [opts.stiffness] - 0..1
   * @param {number} [opts.maxStretch] - при каком растяжении связь рвётся (1 = никогда, если breakable=false)
   * @param {boolean} [opts.breakable]
   */
  constructor(p1, p2, opts = {}) {
    this.p1 = p1
    this.p2 = p2
    this.length = opts.length ?? distance(p1, p2)
    this.stiffness = opts.stiffness ?? 1
    this.breakable = opts.breakable ?? false
    this.maxStretch = opts.maxStretch ?? 1.6
    this.broken = false
  }

  /** @returns {boolean} true если связь порвалась в этом шаге */
  satisfy() {
    if (this.broken) return false
    const dx = this.p2.x - this.p1.x
    const dy = this.p2.y - this.p1.y
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001
    if (this.breakable && dist > this.length * this.maxStretch) {
      this.broken = true
      return true
    }
    const diff = (this.length - dist) / dist
    const offsetX = dx * diff * 0.5 * this.stiffness
    const offsetY = dy * diff * 0.5 * this.stiffness
    if (!this.p1.pinned) {
      this.p1.x -= offsetX
      this.p1.y -= offsetY
    }
    if (!this.p2.pinned) {
      this.p2.x += offsetX
      this.p2.y += offsetY
    }
    return false
  }
}

export function distance(a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

/** Точка внутри выпуклого/невыпуклого полигона (ray casting) — нужно для коллизий с породой */
export function pointInPolygon(px, py, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y
    const xj = points[j].x, yj = points[j].y
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/** Ближайшая точка на отрезке ab к точке p, плюс дистанция и нормаль */
export function closestPointOnSegment(p, a, b) {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const lenSq = abx * abx + aby * aby || 0.0001
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq
  t = Math.max(0, Math.min(1, t))
  const cx = a.x + abx * t
  const cy = a.y + aby * t
  const dx = p.x - cx
  const dy = p.y - cy
  return { x: cx, y: cy, dist: Math.sqrt(dx * dx + dy * dy), nx: dx, ny: dy }
}
