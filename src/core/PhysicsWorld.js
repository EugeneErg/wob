// core/PhysicsWorld.js
//
// Общий физический шаг мира. Ключевая идея: движок не знает про rock/ball/pipe.
// Он знает только про:
//   - instance.points / instance.sticks (если есть — общий Verlet-объект)
//   - instance.collisionShape (если есть — статическая форма коллизии, полигон)
//   - definition.properties[...] через GlobalProperties (вес/коллизия/гладкость/...)
//   - definition.physics.update(instance, dt, world) — кастомный шаг сущности (труба и т.п.)
//
// Добавление новой сущности с собственной физикой не требует правок этого файла.

import { readProperty, PROP } from './GlobalProperties.js'
import { closestPointOnSegment } from './verlet.js'

const GRAVITY = { x: 0, y: 900 } // px/s^2
const SUB_STEPS = 8

export class PhysicsWorld {
  /**
   * @param {ReturnType<typeof import('./Level.js').createLevel>} level
   *   Мир не хранит сущности сам — всегда читает актуальный список из Level
   *   и может попросить Level удалить сущность (например труба поглощает шар).
   */
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
    for (let s = 0; s < SUB_STEPS; s++) {
      // 1. интеграция
      for (const { instance, definition } of dynamic) {
        const weight = readProperty(instance, definition, PROP.WEIGHT, this)
        const gravityScale = Number.isFinite(weight) ? weight / 1 : 0 // Infinity → статика, не двигаем
        if (gravityScale === 0) continue
        for (const p of instance.points) {
          p.update(subDt, this.gravity)
        }
      }

      // 2. связи (constraints) — несколько релаксаций для стабильности
      for (const { instance } of dynamic) {
        for (const stick of instance.sticks || []) {
          stick.satisfy()
        }
      }

      // 3. коллизии точек с полигонами породы
      for (const { instance, definition } of dynamic) {
        if (!readProperty(instance, definition, PROP.COLLISION, this)) continue
        const smoothness = readProperty(instance, definition, PROP.SMOOTHNESS, this)
        for (const p of instance.points) {
          for (const collider of staticCollidersShapes) {
            resolvePointVsPolygon(p, collider.shape.points, smoothness)
          }
        }
      }

      // 4. коллизии точек друг с другом (простое циклическое разрешение)
      for (let i = 0; i < dynamic.length; i++) {
        const a = dynamic[i]
        if (!readProperty(a.instance, a.definition, PROP.COLLISION, this)) continue
        for (let j = i + 1; j < dynamic.length; j++) {
          const b = dynamic[j]
          if (!readProperty(b.instance, b.definition, PROP.COLLISION, this)) continue
          for (const pa of a.instance.points) {
            for (const pb of b.instance.points) {
              resolvePointVsPoint(pa, pb)
            }
          }
        }
      }
    }

    // 5. кастомная физика сущностей (труба засасывает шары и т.п.), один раз за кадр
    for (const { instance, definition } of entities) {
      definition.physics?.update?.(instance, dt, this)
    }

    // 6. связи, порванные через maxStretch в этом кадре — убираем из уровня
    this.level.pruneBrokenConnections()
  }
}

function resolvePointVsPolygon(point, polygonPoints, smoothness) {
  if (!polygonPoints || polygonPoints.length < 2) return
  let closest = null
  for (let i = 0; i < polygonPoints.length; i++) {
    const a = polygonPoints[i]
    const b = polygonPoints[(i + 1) % polygonPoints.length]
    const c = closestPointOnSegment(point, a, b)
    if (!closest || c.dist < closest.dist) closest = c
  }
  const r = point.radius ?? 0
  if (closest && closest.dist < r && closest.dist > 0.0001) {
    const nx = closest.nx / closest.dist
    const ny = closest.ny / closest.dist
    const push = r - closest.dist
    point.x += nx * push
    point.y += ny * push
    // трение: гасим тангенциальную скорость пропорционально (1 - smoothness)
    const vx = point.x - point.oldX
    const vy = point.y - point.oldY
    const tx = -ny, ty = nx
    const vt = vx * tx + vy * ty
    const friction = 1 - smoothness
    point.oldX += tx * vt * friction
    point.oldY += ty * vt * friction
  }
}

function resolvePointVsPoint(a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001
  const minDist = (a.radius ?? 0) + (b.radius ?? 0)
  if (dist < minDist) {
    const overlap = (minDist - dist) / 2
    const nx = dx / dist
    const ny = dy / dist
    if (!a.pinned) { a.x -= nx * overlap; a.y -= ny * overlap }
    if (!b.pinned) { b.x += nx * overlap; b.y += ny * overlap }
  }
}
