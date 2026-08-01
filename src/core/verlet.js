// Собственный верле-солвер.
// Знает только о глобальных свойствах (см. core/globals.js) и ничего — о сущностях.

import { clamp, closestOnSegment, pointInPoly, bboxOfPoints } from './geom.js'

let UID = 1
const nid = (p) => p + UID++

export class Physics {
  constructor(opts = {}) {
    this.gravity = { x: 0, y: 1800, ...(opts.gravity || {}) }
    this.damping = opts.damping ?? 0.998
    this.iterations = opts.iterations ?? 6
    this.fixed = 1 / 120
    this.maxSub = 8
    this._acc = 0

    this.points = []
    this.links = []
    this.colliders = []
  }

  // ---- точки ---------------------------------------------------------------
  addPoint(o = {}) {
    const x = o.x || 0
    const y = o.y || 0
    const p = {
      id: nid('p'),
      x, y,
      px: x - (o.vx || 0),
      py: y - (o.vy || 0),
      ax: 0, ay: 0,
      // глобальные свойства
      radius: o.radius ?? 8,
      mass: o.mass ?? 1,
      restitution: o.restitution ?? 0.2,   // упругость
      smoothness: o.smoothness ?? 0.5,     // гладкость: 1 — лёд, 0 — липучка
      collision: {                         // коллизия
        world: o.collision?.world ?? true, // со статической геометрией
        points: o.collision?.points ?? true, // с другими точками
      },
      attachable: o.attachable ?? false,   // можно ли прилепить связь
      suction: o.suction ?? 0,             // всасывание
      pinned: !!o.pinned,
      gravityScale: o.gravityScale ?? 1,
      owner: o.owner || null,              // id инстанса-владельца
      links: [],
      removed: false,
    }
    this.points.push(p)
    return p
  }

  removePoint(p) {
    if (!p || p.removed) return
    for (const l of [...p.links]) this.removeLink(l)
    p.removed = true
    const i = this.points.indexOf(p)
    if (i >= 0) this.points.splice(i, 1)
  }

  applyAccel(p, ax, ay) { p.ax += ax; p.ay += ay }

  // ---- связи ---------------------------------------------------------------
  addLink(a, b, o = {}) {
    const l = {
      id: nid('l'), a, b,
      rest: o.rest ?? Math.hypot(a.x - b.x, a.y - b.y),
      stiffness: clamp(o.stiffness ?? 1, 0, 1),
      visible: o.visible !== false,
      width: o.width ?? 5,
      color: o.color || null,
      owner: o.owner || null,
      removed: false,
    }
    a.links.push(l); b.links.push(l)
    this.links.push(l)
    return l
  }

  removeLink(l) {
    if (!l || l.removed) return
    l.removed = true
    const ai = l.a.links.indexOf(l); if (ai >= 0) l.a.links.splice(ai, 1)
    const bi = l.b.links.indexOf(l); if (bi >= 0) l.b.links.splice(bi, 1)
    const i = this.links.indexOf(l); if (i >= 0) this.links.splice(i, 1)
  }

  // ---- статическая геометрия ----------------------------------------------
  addCollider(o = {}) {
    const c = {
      id: nid('c'),
      points: o.points || [],
      smoothness: o.smoothness ?? 0.5,
      restitution: o.restitution ?? 0.1,
      owner: o.owner || null,
      removed: false,
    }
    c.bbox = bboxOfPoints(c.points)
    this.colliders.push(c)
    return c
  }

  removeCollider(c) {
    if (!c) return
    c.removed = true
    const i = this.colliders.indexOf(c); if (i >= 0) this.colliders.splice(i, 1)
  }

  // ---- шаг -----------------------------------------------------------------
  step(dt) {
    this._acc += Math.min(dt, 0.25)
    let n = 0
    while (this._acc >= this.fixed && n < this.maxSub) {
      this._sub(this.fixed)
      this._acc -= this.fixed
      n++
    }
    if (n === this.maxSub) this._acc = 0
    for (const p of this.points) { p.ax = 0; p.ay = 0 }
  }

  _sub(dt) {
    const g = this.gravity
    for (const p of this.points) {
      if (p.pinned) { p.px = p.x; p.py = p.y; continue }
      const vx = (p.x - p.px) * this.damping
      const vy = (p.y - p.py) * this.damping
      p.px = p.x; p.py = p.y
      p.x += vx + (g.x * p.gravityScale + p.ax) * dt * dt
      p.y += vy + (g.y * p.gravityScale + p.ay) * dt * dt
    }
    for (let i = 0; i < this.iterations; i++) {
      this._solveLinks()
      this._solvePairs()
      this._solveWorld(false)
    }
    this._solveWorld(true)
  }

  _solveLinks() {
    for (const l of this.links) {
      const { a, b } = l
      const dx = b.x - a.x, dy = b.y - a.y
      const d = Math.hypot(dx, dy) || 1e-9
      const ima = a.pinned ? 0 : 1 / a.mass
      const imb = b.pinned ? 0 : 1 / b.mass
      const s = ima + imb
      if (!s) continue
      const diff = ((d - l.rest) / d) * l.stiffness
      a.x += dx * diff * (ima / s); a.y += dy * diff * (ima / s)
      b.x -= dx * diff * (imb / s); b.y -= dy * diff * (imb / s)
    }
  }

  _solvePairs() {
    const pts = this.points
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      if (!a.collision.points) continue
      for (let j = i + 1; j < pts.length; j++) {
        const b = pts[j]
        if (!b.collision.points) continue
        const dx = b.x - a.x, dy = b.y - a.y
        const min = a.radius + b.radius
        if (Math.abs(dx) > min || Math.abs(dy) > min) continue
        const d = Math.hypot(dx, dy)
        if (d >= min || d < 1e-9) continue
        const ima = a.pinned ? 0 : 1 / a.mass
        const imb = b.pinned ? 0 : 1 / b.mass
        const s = ima + imb
        if (!s) continue
        const push = (min - d) / d
        a.x -= dx * push * (ima / s); a.y -= dy * push * (ima / s)
        b.x += dx * push * (imb / s); b.y += dy * push * (imb / s)
      }
    }
  }

  _solveWorld(withVelocity) {
    for (const p of this.points) {
      if (p.pinned || !p.collision.world) continue
      for (const c of this.colliders) {
        if (!c.points.length) continue
        const bb = c.bbox
        if (p.x + p.radius < bb.x || p.x - p.radius > bb.x + bb.w) continue
        if (p.y + p.radius < bb.y || p.y - p.radius > bb.y + bb.h) continue
        this._resolvePoly(p, c, withVelocity)
      }
    }
  }

  _resolvePoly(p, c, withVelocity) {
    const pts = c.points
    let best = null, bestD = Infinity
    for (let i = 0, n = pts.length; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n]
      const q = closestOnSegment(p.x, p.y, a[0], a[1], b[0], b[1])
      const d = Math.hypot(p.x - q.x, p.y - q.y)
      if (d < bestD) { bestD = d; best = q }
    }
    if (!best) return
    const inside = pointInPoly(p.x, p.y, pts)
    if (!inside && bestD >= p.radius) return

    let nx, ny
    if (bestD < 1e-6) { nx = 0; ny = -1 }
    else {
      nx = (p.x - best.x) / bestD
      ny = (p.y - best.y) / bestD
      if (inside) { nx = -nx; ny = -ny }
    }

    const vx = p.x - p.px, vy = p.y - p.py
    p.x = best.x + nx * p.radius
    p.y = best.y + ny * p.radius

    if (!withVelocity) { p.px = p.x - vx; p.py = p.y - vy; return }

    const rest = (p.restitution + c.restitution) * 0.5
    // гладкость 0 — шершавая поверхность, 1 — лёд
    const avg = clamp((p.smoothness + c.smoothness) * 0.5, 0, 1)
    const keep = 0.78 + 0.22 * avg
    const tx = -ny, ty = nx
    const vn = vx * nx + vy * ny
    const vt = vx * tx + vy * ty
    const nvn = vn < 0 ? -vn * rest : vn
    const nvt = vt * keep
    p.px = p.x - (nvn * nx + nvt * tx)
    p.py = p.y - (nvn * ny + nvt * ty)
  }
}
