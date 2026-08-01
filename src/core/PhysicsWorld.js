// core/PhysicsWorld.js
// Адаптировано из оригинального World of Goo physics.js

import { readProperty, PROP } from './GlobalProperties.js'
import { closestPointOnSegment, pointInPolygon } from './verlet.js'

const GRAVITY = { x: 0, y: 900 }
const SUB_STEPS = 1 // интеграция 1 раз, связи решаются итеративно
const ITERATIONS = 8 // количество итераций релаксации связей
const NODE_DAMPING = 0.99 // damping для узлов (связанных шаров)
const FREE_DAMPING = 0.995 // damping для свободных шаров
const MAX_SPEED = 2600 // px/s

export class PhysicsWorld {
  constructor(level) {
    this.level = level
    this.gravity = GRAVITY
    this.tearing = null // VerletPoint, который тащат
    this.tearOrigin = null // {x, y} — позиция в момент захвата
    this.brokenThisStep = 0
  }

  step(dt) {
    const entities = this.level.getEntitiesWithDefs()
    const dynamic = entities.filter((e) => e.instance.points?.length)
    const staticColliders = entities
      .filter((e) => e.instance.collisionShape && readProperty(e.instance, e.definition, PROP.COLLISION, this))
      .map((e) => e.instance.collisionShape)

    // Синхронизируем neighbors/degree из connections
    this.syncNeighbors(dynamic)

    const subDt = dt / SUB_STEPS
    const gravityCompensated = { x: this.gravity.x, y: this.gravity.y }

    for (let s = 0; s < SUB_STEPS; s++) {
      this.integrate(dynamic, subDt, gravityCompensated)

      for (let i = 0; i < ITERATIONS; i++) {
        this.solveStruts()
      }

      this.collideBalls(dynamic)
      this.collideTerrain(dynamic, staticColliders)
    }

    this.updateStress(dt)
    this.sweep()
    this.level.pruneBrokenConnections()
  }

  syncNeighbors(entities) {
    // Сброс
    for (const { instance } of entities) {
      for (const p of instance.points || []) {
        p.neighbors.clear()
        p.degree = 0
      }
    }
    // Заполнение из connections
    for (const c of this.level.state.connections) {
      const a = this.level.getInstance(c.aId)
      const b = this.level.getInstance(c.bId)
      if (!a || !b || !a.points?.[0] || !b.points?.[0]) continue
      const pa = a.points[0]
      const pb = b.points[0]
      pa.neighbors.add(pb)
      pb.neighbors.add(pa)
      pa.degree++
      pb.degree++
    }
  }

  integrate(entities, dt, gravity) {
    const maxV = MAX_SPEED * dt
    for (const { instance, definition } of entities) {
      const weight = readProperty(instance, definition, PROP.WEIGHT, this)
      const gravityScale = Number.isFinite(weight) ? weight / 1 : 0
      if (gravityScale === 0) continue
      for (const p of instance.points) {
        // damping: узлы (связанные) — больше, свободные — меньше
        const damp = p.degree > 0 ? NODE_DAMPING : FREE_DAMPING
        p.update(dt, gravity, damp, MAX_SPEED)
      }
    }
  }

  solveStruts() {
    for (const c of this.level.state.connections) {
      if (!c.stick || c.stick.broken || c.stick.dead) continue
      c.stick.satisfy(this.tearOrigin, this.tearing)
    }
  }

  collideBalls(entities) {
    const arr = []
    for (const { instance } of entities) {
      for (const p of instance.points || []) arr.push(p)
    }
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i]
      if (a.pinned) continue
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j]
        if (b.pinned) continue
        if (a.neighbors.has(b)) continue // пропускаем связанные
        const dx = b.x - a.x
        const dy = b.y - a.y
        const min = (a.radius + b.radius) * 0.95
        const d2 = dx * dx + dy * dy
        if (d2 >= min * min || d2 < 1e-9) continue
        const d = Math.sqrt(d2)
        const overlap = Math.min(min - d, 2.5)
        const push = overlap / d * 0.6
        a.x -= dx * push * 0.5
        a.y -= dy * push * 0.5
        b.x += dx * push * 0.5
        b.y += dy * push * 0.5
      }
    }
  }

  collideTerrain(entities, staticColliders) {
    for (const { instance, definition } of entities) {
      if (!readProperty(instance, definition, PROP.COLLISION, this)) continue
      for (const p of instance.points) {
        for (const poly of staticColliders) {
          this.resolvePointVsPolygon(p, poly.points)
        }
      }
    }
  }

  resolvePointVsPolygon(point, polygonPoints) {
    if (!polygonPoints || polygonPoints.length < 2) return
    let bestX = 0, bestY = 0, bestD = Infinity, inside = false

    for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i++) {
      const a = polygonPoints[j]
      const b = polygonPoints[i]
      const q = closestPointOnSegment(point.x, point.y, a, b)
      const d = Math.hypot(point.x - q.x, point.y - q.y)
      if (d < bestD) {
        bestD = d
        bestX = q.x
        bestY = q.y
      }
    }

    inside = pointInPolygon(point.x, point.y, polygonPoints)
    if (!inside && bestD >= point.radius) return

    const vx = point.x - point.oldX
    const vy = point.y - point.oldY

    let nx = point.x - bestX
    let ny = point.y - bestY
    let len = Math.hypot(nx, ny)
    if (len < 1e-6) { nx = 0; ny = -1; len = 1 }
    nx /= len; ny /= len
    if (inside) { nx = -nx; ny = -ny }

    point.x = bestX + nx * point.radius
    point.y = bestY + ny * point.radius

    // скольжение + отскок (как в оригинале)
    const tx = -ny, ty = nx
    const vnRaw = vx * nx + vy * ny
    const restitution = 0.2
    const vn = vnRaw < 0 ? -vnRaw * restitution : vnRaw
    const slip = 0.85 // гладкость
    const vt = (vx * tx + vy * ty) * slip
    point.oldX = point.x - (tx * vt + nx * vn)
    point.oldY = point.y - (ty * vt + ny * vn)
  }

  updateStress(dt) {
    const maxStretch = 2.2
    const fatigueFrom = 0.7
    const fatigueRate = 1.5
    this.brokenThisStep = 0
    for (const c of this.level.state.connections) {
      const s = c.stick
      if (!s || s.broken || s.dead) continue
      const d = Math.hypot(s.p2.x - s.p1.x, s.p2.y - s.p1.y)
      const ratio = d / s.length
      s.stress = Math.max(0, Math.min(1, (ratio - 1) / (maxStretch - 1)))

      // Связи вырываемого шара не рвутся по натяжению
      if (this.tearing && (s.p1 === this.tearing || s.p2 === this.tearing)) continue

      if (s.stress > fatigueFrom) {
        s.damage += (s.stress - fatigueFrom) * fatigueRate * dt
      } else if (s.damage > 0) {
        s.damage = Math.max(0, s.damage - dt * 0.3)
      }

      if (ratio > maxStretch || s.damage >= 1) {
        s.dead = true
        s.broken = true
        this.brokenThisStep++
      }
    }
  }

  sweep() {
    // Удаляем мёртвые связи из level
    const dead = this.level.state.connections.filter((c) => c.stick?.dead || c.stick?.broken)
    for (const c of dead) {
      this.level.removeConnection(c.aId, c.bId)
    }
    // Обновляем bondCount
    this.level.updateAllBondCounts()
  }
}
