import { describe, it, expect, vi, beforeAll } from 'vitest'
import { createLevel } from '../Level.js'
import { registerEntity } from '../EntityRegistry.js'
import { PhysicsWorld } from '../PhysicsWorld.js'
import { VerletPoint } from '../verlet.js'
import { PROP } from '../GlobalProperties.js'

beforeAll(() => {
  registerEntity({
    type: 'phys_dynamic',
    name: 'Dynamic',
    properties: {
      [PROP.WEIGHT]: (state) => state.mass,
      [PROP.COLLISION]: true,
      [PROP.SMOOTHNESS]: 0.5,
    },
    createInstance(id, initProps = {}) {
      const state = { mass: initProps.mass ?? 1 }
      return {
        id,
        type: 'phys_dynamic',
        state,
        points: [new VerletPoint(initProps.x ?? 0, initProps.y ?? 0, { radius: initProps.radius ?? 10 })],
        sticks: [],
      }
    },
  })

  registerEntity({
    type: 'phys_static',
    name: 'Static',
    properties: { [PROP.WEIGHT]: Infinity, [PROP.COLLISION]: true, [PROP.SMOOTHNESS]: 0.5 },
    createInstance(id, initProps = {}) {
      const points = initProps.points ?? [
        { x: -1000, y: 300 },
        { x: 1000, y: 300 },
        { x: 1000, y: 400 },
        { x: -1000, y: 400 },
      ]
      return { id, type: 'phys_static', state: {}, collisionShape: { points } }
    },
  })
})

function makeWorldWithLevel() {
  const level = createLevel()
  const world = new PhysicsWorld(level)
  return { level, world }
}

describe('PhysicsWorld: integration', () => {
  it('applies gravity to a dynamic point over time (it falls)', () => {
    const { level, world } = makeWorldWithLevel()
    const inst = level.addEntity('phys_dynamic', { x: 0, y: 0, mass: 1 })
    const startY = inst.points[0].y
    world.step(1 / 60)
    expect(inst.points[0].y).toBeGreaterThan(startY)
  })

  it('does not move a static (weight=Infinity) entity even without a points array', () => {
    const { level, world } = makeWorldWithLevel()
    const inst = level.addEntity('phys_static', {})
    const before = JSON.stringify(inst.collisionShape.points)
    world.step(1 / 60)
    expect(JSON.stringify(inst.collisionShape.points)).toBe(before)
  })

  it('free-fall acceleration is independent of mass (gravity, not weight-scaled)', () => {
    const { level, world } = makeWorldWithLevel()
    const light = level.addEntity('phys_dynamic', { x: 0, y: 0, mass: 0.1 })
    const heavy = level.addEntity('phys_dynamic', { x: 500, y: 0, mass: 50 })
    world.step(1 / 60)
    expect(light.points[0].y).toBeCloseTo(heavy.points[0].y, 5)
  })
})

describe('PhysicsWorld: collisions', () => {
  it('stops a falling point at a static polygon surface instead of passing through', () => {
    const { level, world } = makeWorldWithLevel()
    const inst = level.addEntity('phys_dynamic', { x: 0, y: 0, radius: 10 })
    level.addEntity('phys_static', {}) // плоскость на y=300..400
    for (let i = 0; i < 240; i++) world.step(1 / 60) // достаточно кадров, чтобы точно упасть и осесть
    // точка не должна провалиться far ниже поверхности (300 - radius ~= 290)
    expect(inst.points[0].y).toBeLessThan(305)
  })

  it('pushes two overlapping dynamic points apart', () => {
    const { level, world } = makeWorldWithLevel()
    const a = level.addEntity('phys_dynamic', { x: 100, y: 100, radius: 10 })
    const b = level.addEntity('phys_dynamic', { x: 105, y: 100, radius: 10 }) // сильно перекрываются
    world.step(1 / 60)
    const dx = b.points[0].x - a.points[0].x
    const dy = b.points[0].y - a.points[0].y
    const dist = Math.sqrt(dx * dx + dy * dy)
    expect(dist).toBeGreaterThan(5) // разошлись сильнее, чем были изначально
  })
})

describe('PhysicsWorld: constraints', () => {
  it('satisfies sticks stored on an instance, pulling connected points toward rest length', async () => {
    const { VerletStick } = await import('../verlet.js')
    const { level, world } = makeWorldWithLevel()
    const a = level.addEntity('phys_dynamic', { x: 0, y: 0 })
    const b = level.addEntity('phys_dynamic', { x: 200, y: 0 })
    a.sticks.push(new VerletStick(a.points[0], b.points[0], { length: 50, stiffness: 1 }))
    world.step(1 / 60)
    const dist = Math.abs(b.points[0].x - a.points[0].x)
    expect(dist).toBeLessThan(200) // связь подтянула точки друг к другу
  })
})

describe('PhysicsWorld: custom entity physics hook', () => {
  it('calls definition.physics.update(instance, dt, world) once per step for every entity that defines it', () => {
    const updateSpy = vi.fn()
    registerEntity({
      type: 'phys_custom_hook',
      name: 'CustomHook',
      properties: {},
      createInstance(id) {
        return { id, type: 'phys_custom_hook', state: {} }
      },
      physics: { update: updateSpy },
    })
    const { level, world } = makeWorldWithLevel()
    const inst = level.addEntity('phys_custom_hook', {})
    world.step(1 / 60)
    expect(updateSpy).toHaveBeenCalledTimes(1)
    const [calledInstance, calledDt, calledWorld] = updateSpy.mock.calls[0]
    expect(calledInstance.id).toBe(inst.id)
    expect(calledDt).toBeCloseTo(1 / 60)
    expect(calledWorld).toBe(world)
  })

  it('gives the custom hook access to world.level so it can remove entities (pipe-style consumption)', () => {
    registerEntity({
      type: 'phys_consumer',
      name: 'Consumer',
      properties: {},
      createInstance(id) {
        return { id, type: 'phys_consumer', state: {} }
      },
      physics: {
        update(instance, dt, world) {
          const [{ instance: victim }] = world.level.getEntitiesWithDefs().filter((e) => e.instance.type === 'phys_dynamic')
          if (victim) world.level.removeEntity(victim.id)
        },
      },
    })
    const { level, world } = makeWorldWithLevel()
    level.addEntity('phys_consumer', {})
    const victim = level.addEntity('phys_dynamic', { x: 0, y: 0 })
    world.step(1 / 60)
    expect(level.getInstance(victim.id)).toBeUndefined()
  })
})

describe('PhysicsWorld: broken bond cleanup', () => {
  it('prunes connections whose stick snapped during the step', () => {
    const { level, world } = makeWorldWithLevel()
    registerEntity({
      type: 'phys_bondable',
      name: 'Bondable',
      properties: { [PROP.BONDABLE]: true, [PROP.WEIGHT]: 1, [PROP.COLLISION]: false },
      createInstance(id, initProps = {}) {
        return {
          id,
          type: 'phys_bondable',
          state: {},
          points: [new VerletPoint(initProps.x ?? 0, initProps.y ?? 0)],
          sticks: [],
        }
      },
    })
    const a = level.addEntity('phys_bondable', { x: 0, y: 0 })
    const b = level.addEntity('phys_bondable', { x: 10, y: 0 })
    level.toggleConnection(a.id, b.id)
    level.state.connections[0].stick.breakable = true
    level.state.connections[0].stick.maxStretch = 1.01
    b.points[0].x = 10000 // резко растягиваем далеко за предел прочности
    world.step(1 / 60)
    expect(level.state.connections).toHaveLength(0)
  })
})
