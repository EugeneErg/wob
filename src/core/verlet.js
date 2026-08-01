// core/verlet.js

export class VerletPoint {
  constructor(x, y, opts = {}) {
    this.x = x
    this.y = y
    this.oldX = x
    this.oldY = y
    this.pinned = !!opts.pinned
    this.radius = opts.radius ?? 10
    this.meta = opts.meta ?? {}
    this.neighbors = new Set() // id соседей (для collideBalls)
    this.degree = 0 // количество связей
  }

  update(dt, gravity, damping = 1.0, maxSpeed = 2600) {
    if (this.pinned) {
      this.oldX = this.x
      this.oldY = this.y
      return
    }
    const vx = (this.x - this.oldX) * damping
    const vy = (this.y - this.oldY) * damping
    const v = Math.hypot(vx, vy)
    const maxV = maxSpeed * dt
    let scale = 1
    if (v > maxV) scale = maxV / v
    this.oldX = this.x
    this.oldY = this.y
    this.x += vx * scale + gravity.x * dt * dt
    this.y += vy * scale + gravity.y * dt * dt
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

  get vx() { return this.x - this.oldX }
  get vy() { return this.y - this.oldY }
}

export class VerletStick {
  constructor(p1, p2, opts = {}) {
    this.p1 = p1
    this.p2 = p2
    this.length = opts.length ?? distance(p1, p2)
    this.stiffness = opts.stiffness ?? 1
    this.breakable = opts.breakable ?? false
    this.maxStretch = opts.maxStretch ?? 1.6
    this.broken = false
    this.dead = false
    this.stress = 0
    this.damage = 0
  }

  satisfy(tearOrigin = null, tearing = null) {
    if (this.broken || this.dead) return false

    let ax = this.p1.x, ay = this.p1.y
    let bx = this.p2.x, by = this.p2.y

    // Если шар в руке — связи тянутся к tearOrigin, не к курсору
    if (tearOrigin) {
      if (this.p1 === tearing) { ax = tearOrigin.x; ay = tearOrigin.y }
      else if (this.p2 === tearing) { bx = tearOrigin.x; by = tearOrigin.y }
    }

    const dx = bx - ax
    const dy = by - ay
    const dist = Math.hypot(dx, dy) || 0.0001

    const ma = this.p1.pinned ? 0 : 1
    const mb = this.p2.pinned ? 0 : 1
    const total = ma + mb
    if (total === 0) return false

    const k = Math.min(1, this.stiffness)
    const diff = ((dist - this.length) / dist) * k
    const wa = ma / total
    const wb = mb / total

    this.p1.x += dx * diff * wa
    this.p1.y += dy * diff * wa
    this.p2.x -= dx * diff * wb
    this.p2.y -= dy * diff * wb

    return false
  }
}

export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function closestPointOnSegment(px, py, a, b) {
  const ax = a.x, ay = a.y
  const bx = b.x, by = b.y
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return { x: ax, y: ay, dist: Math.hypot(px - ax, py - ay), nx: ax - px, ny: ay - py }
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx
  const cy = ay + t * dy
  const ddx = px - cx, ddy = py - cy
  const dist = Math.hypot(ddx, ddy)
  return { x: cx, y: cy, dist, nx: ddx, ny: ddy }
}

export function pointInPolygon(px, py, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y
    const xj = points[j].x, yj = points[j].y
    const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}
