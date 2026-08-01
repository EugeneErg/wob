// Собственный верле-солвер.
// Знает только о глобальных свойствах (см. core/globals.js) и ничего — о сущностях.

import { clamp, closestOnSegment, pointInPoly, bboxOfPoints } from './geom.js'

let UID = 1
const nid = (p) => p + UID++

export class Physics {
  constructor(opts = {}) {
    this.gravity = { x: 0, y: 1800, ...(opts.gravity || {}) }
    this.damping = opts.damping ?? 0.998
    this.iterations = opts.iterations ?? 3
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
      ax: 0, ay: 0,   // ускорение от сущностей (живёт весь кадр)
      fx: 0, fy: 0,   // сила от связей (пересчитывается каждый подшаг)
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
      spring: o.spring ?? 2500,        // сила на пиксель растяжения
      damping: clamp(o.damping ?? 0.2, 0, 1), // доля гасимой скорости вдоль связи
      breakForce: o.breakForce ?? Infinity,   // рвётся, когда натяжение превысит порог
      lambda: 0,                       // множитель ограничения за подшаг
      tension: 0,                      // натяжение (сила), сглаженное
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

    // 1. предсказание: px хранит положение до шага и больше не трогается,
    //    поэтому любая позиционная коррекция сама становится изменением скорости
    for (const p of this.points) {
      if (p.pinned) { p.px = p.x; p.py = p.y; continue }
      const vx = (p.x - p.px) * this.damping
      const vy = (p.y - p.py) * this.damping
      p.px = p.x; p.py = p.y
      p.x += vx + (g.x * p.gravityScale + p.ax) * dt * dt
      p.y += vy + (g.y * p.gravityScale + p.ay) * dt * dt
    }

    // 2. решение ограничений — только позиции
    for (const l of this.links) l.lambda = 0
    for (let i = 0; i < this.iterations; i++) {
      this._solveLinks(dt)
      this._solvePairs()
      this._collide()
    }

    // 3. скорость: трение и отскок в контактах, гашение вдоль связей
    this._contactVelocity()
    this._dampLinks()

    // 4. натяжение = сила в связи; сглаживаем, чтобы не рвать от случайного всплеска
    let broken = null
    const k = 1 / (dt * dt)
    for (const l of this.links) {
      const f = Math.max(0, -l.lambda * k)
      l.tension += (f - l.tension) * 0.05
      if (l.tension > l.breakForce) (broken ||= []).push(l)
    }
    if (broken) for (const l of broken) this.removeLink(l)
  }

  // Податливое ограничение (XPBD): та же позиционная коррекция, что и в верле,
  // но с податливостью 1/spring. Устойчиво при любой жёсткости, при этом связь
  // растягивается пропорционально нагрузке, а lambda даёт настоящую силу.
  _solveLinks(dt) {
    const inv = 1 / (dt * dt)
    for (const l of this.links) {
      const { a, b } = l
      const w1 = a.pinned ? 0 : 1 / a.mass
      const w2 = b.pinned ? 0 : 1 / b.mass
      const w = w1 + w2
      if (!w) continue
      const dx = b.x - a.x, dy = b.y - a.y
      const d = Math.hypot(dx, dy) || 1e-9
      const nx = dx / d, ny = dy / d
      const C = d - l.rest
      const alpha = inv / l.spring
      const dl = (-C - alpha * l.lambda) / (w + alpha)
      l.lambda += dl
      a.x -= nx * dl * w1; a.y -= ny * dl * w1
      b.x += nx * dl * w2; b.y += ny * dl * w2
    }
  }

  // Гашение — фильтр скорости, а не сила: не может накачать энергию.
  _dampLinks() {
    for (const l of this.links) {
      if (!l.damping) continue
      const { a, b } = l
      const w1 = a.pinned ? 0 : 1 / a.mass
      const w2 = b.pinned ? 0 : 1 / b.mass
      const w = w1 + w2
      if (!w) continue
      const dx = b.x - a.x, dy = b.y - a.y
      const d = Math.hypot(dx, dy) || 1e-9
      const nx = dx / d, ny = dy / d
      const vrel = ((b.x - b.px) - (a.x - a.px)) * nx + ((b.y - b.py) - (a.y - a.py)) * ny
      const k = l.damping * vrel
      a.px -= (k * nx * w1) / w; a.py -= (k * ny * w1) / w
      b.px += (k * nx * w2) / w; b.py += (k * ny * w2) / w
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

  // Позиционная часть контакта: просто выталкиваем из статики
  _collide() {
    for (const p of this.points) {
      if (p.pinned || !p.collision.world) continue
      for (const c of this.colliders) {
        const ct = this._contact(p, c)
        if (!ct) continue
        p.x = ct.qx + ct.nx * p.radius
        p.y = ct.qy + ct.ny * p.radius
      }
    }
  }

  // Скоростная часть контакта: упругость по нормали, гладкость по касательной
  _contactVelocity() {
    for (const p of this.points) {
      if (p.pinned || !p.collision.world) continue
      for (const c of this.colliders) {
        const ct = this._contact(p, c, 0.5)
        if (!ct) continue
        const { nx, ny } = ct
        const vx = p.x - p.px, vy = p.y - p.py
        const rest = (p.restitution + c.restitution) * 0.5
        // гладкость 0 — шершавая поверхность, 1 — лёд
        const avg = clamp((p.smoothness + c.smoothness) * 0.5, 0, 1)
        const keep = 0.6 + 0.4 * avg
        const tx = -ny, ty = nx
        const vn = vx * nx + vy * ny
        const vt = vx * tx + vy * ty
        const nvn = vn < 0 ? -vn * rest : vn
        const nvt = vt * keep
        p.px = p.x - (nvn * nx + nvt * tx)
        p.py = p.y - (nvn * ny + nvt * ty)
      }
    }
  }

  // Ближайшая точка границы и внешняя нормаль, если тело её касается
  _contact(p, c, slack = 0) {
    const pts = c.points
    if (!pts.length) return null
    const bb = c.bbox
    if (p.x + p.radius < bb.x || p.x - p.radius > bb.x + bb.w) return null
    if (p.y + p.radius < bb.y || p.y - p.radius > bb.y + bb.h) return null

    const closest = (x, y) => {
      let q = null, best = Infinity
      for (let i = 0, n = pts.length; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n]
        const s = closestOnSegment(x, y, a[0], a[1], b[0], b[1])
        const d = Math.hypot(x - s.x, y - s.y)
        if (d < best) { best = d; q = s }
      }
      return { q, d: best }
    }

    const inside = pointInPoly(p.x, p.y, pts)
    let { q, d } = closest(p.x, p.y)
    if (!q) return null
    if (!inside && d >= p.radius + slack) return null

    let nx, ny
    if (inside && !pointInPoly(p.px, p.py, pts)) {
      // влетел за один шаг — выталкиваем туда, откуда пришёл
      const prev = closest(p.px, p.py)
      q = prev.q
      const dx = p.px - q.x, dy = p.py - q.y
      const len = Math.hypot(dx, dy) || 1e-9
      nx = dx / len; ny = dy / len
    } else if (d < 1e-6) { nx = 0; ny = -1 }
    else {
      nx = (p.x - q.x) / d; ny = (p.y - q.y) / d
      if (inside) { nx = -nx; ny = -ny }
    }
    return { qx: q.x, qy: q.y, nx, ny }
  }
}
