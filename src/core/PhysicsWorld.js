// core/PhysicsWorld.js

import { readProperty, PROP } from './GlobalProperties.js'
import { closestPointOnSegment } from './verlet.js'

const GRAVITY = { x: 0, y: 900 } // px/s^2
const SUB_STEPS = 8

export class PhysicsWorld {
  constructor(level) {
    this.level = level
    this.gravity = GRAVITY
  }

  step(dt) {
    const entities = this.level.getEntitiesWithDefs()
    const dynamic = entities.filter((e) => e.instance.points?.length)
    const staticCollidersShapes = entities
      .filter((e) => e.instance.collisionShape && readProperty(e.instance, e.definition, PROP.COLLISION, this))
      .map((e) => ({ shape: e.instance.collisionShape, def: e.definition, inst: e.instance }))

    const subDt = dt / SUB_STEPS
    const gravityCompensated = {
      x: this.gravity.x * SUB_STEPS,
      y: this.gravity.y * SUB_STEPS,
    }

    for (let s = 0; s < SUB_STEPS; s++) {
      // 1. интеграция
      for (const { instance, definition } of dynamic) {
        const weight = readProperty(instance, definition, PROP.WEIGHT, this)
        const gravityScale = Number.isFinite(weight) ? weight / 1 : 0
        if (gravityScale === 0) continue
        for (const p of instance.points) {
          p.update(subDt, gravityCompensated, 1.0)
        }
      }

      // 2. связи (constraints)
      for (const { instance } of dynamic) {
        for (const stick of instance.sticks || []) {
          stick.satisfy()
        }
      }

      // 3. коллизии точек с полигонами
      for (const { instance, definition } of dynamic) {
        if (!readProperty(instance, definition, PROP.COLLISION, this)) continue
        for (const p of instance.points) {
          for (const collider of staticCollidersShapes) {
            resolvePointVsPolygon(p, collider.shape.points)
          }
        }
      }

      // 4. коллизии точек друг с другом — пропускаем связанные пары
      for (let i = 0; i < dynamic.length; i++) {
        const a = dynamic[i]
        if (!readProperty(a.instance, a.definition, PROP.COLLISION, this)) continue
        for (let j = i + 1; j < dynamic.length; j++) {
          const b = dynamic[j]
          if (!readProperty(b.instance, b.definition, PROP.COLLISION, this)) continue
          if (this.level.connectionExists(a.instance.id, b.instance.id)) continue
          for (const pa of a.instance.points) {
            for (const pb of b.instance.points) {
              resolvePointVsPoint(pa, pb)
            }
          }
        }
      }
    }

    // 5. кастомная физика сущностей
    for (const { instance, definition } of entities) {
      definition.physics?.update?.(instance, dt, this)
    }

    // 6. связи, порванные через maxStretch
    this.level.pruneBrokenConnections()
  }
}

function resolvePointVsPolygon(point, polygonPoints) {
  if (!polygonPoints || polygonPoints.length < 2) return
  let closest = null
  for (let i = 0; i < polygonPoints.length; i++) {
    const a = polygonPoints[i]
    const b = polygonPoints[(i + 1) % polygonPoints.length]
    const c = closestPointOnSegment(point, a, b)
    if (!closest || c.dist < closest.dist) closest = c
  }
  if (!closest || closest.dist > point.radius) return

  const dist = closest.dist || 0.0001
  const nx = closest.nx / dist
  const ny = closest.ny / dist

  const push = point.radius - closest.dist
  if (!point.pinned && push > 0) {
    point.x += nx * push
    point.y += ny * push
    point.oldX += nx * push
    point.oldY += ny * push
  }

  const vx = point.x - point.oldX
  const vy = point.y - point.oldY
  const vn = vx * nx + vy * ny

  if (vn < 0) {
    point.oldX += vn * nx
    point.oldY += vn * ny
  }
}

function resolvePointVsPoint(a, b, restitution = 0.2) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001
  const minDist = a.radius + b.radius
  if (dist >= minDist) return
  const overlap = minDist - dist
  const nx = dx / dist
  const ny = dy / dist

  if (!a.pinned) {
    a.x -= nx * overlap * 0.5
    a.y -= ny * overlap * 0.5
  }
  if (!b.pinned) {
    b.x += nx * overlap * 0.5
    b.y += ny * overlap * 0.5
  }

  // Упругость при столкновении шаров
  const rvx = (b.x - b.oldX) - (a.x - a.oldX)
  const rvy = (b.y - b.oldY) - (a.y - a.oldY)
  const rvn = rvx * nx + rvy * ny
  if (rvn < 0) {
    const impulse = (1 + restitution) * rvn * 0.5
    if (!a.pinned) {
      a.oldX += impulse * nx
      a.oldY += impulse * ny
    }
    if (!b.pinned) {
      b.oldX -= impulse * nx
      b.oldY -= impulse * ny
    }
  }
}
