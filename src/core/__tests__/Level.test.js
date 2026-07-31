import { describe, it, expect, beforeAll } from 'vitest'
import { createLevel } from '../Level.js'
import { registerEntity } from '../EntityRegistry.js'
import { VerletPoint } from '../verlet.js'
import { PROP } from '../GlobalProperties.js'

beforeAll(() => {
  registerEntity({
    type: 'level_test_bondy',
    name: 'Bondy',
    properties: { [PROP.BONDABLE]: true },
    createInstance(id, initProps = {}) {
      return {
        id,
        type: 'level_test_bondy',
        state: { x: initProps.x ?? 0, y: initProps.y ?? 0 },
        points: [new VerletPoint(initProps.x ?? 0, initProps.y ?? 0)],
        sticks: [],
      }
    },
  })

  registerEntity({
    type: 'level_test_rigid',
    name: 'Rigid',
    properties: { [PROP.BONDABLE]: false },
    createInstance(id, initProps = {}) {
      return { id, type: 'level_test_rigid', state: { x: initProps.x ?? 0, y: initProps.y ?? 0 } }
    },
  })
})

describe('Level: entities', () => {
  it('starts empty', () => {
    const level = createLevel()
    expect(level.state.entities).toHaveLength(0)
    expect(level.state.connections).toHaveLength(0)
  })

  it('addEntity creates an instance via the registered definition and stores it', () => {
    const level = createLevel()
    const inst = level.addEntity('level_test_rigid', { x: 5, y: 6 })
    expect(inst.type).toBe('level_test_rigid')
    expect(inst.state.x).toBe(5)
    expect(level.state.entities).toHaveLength(1)
    // Level оборачивает state в reactive(), поэтому getInstance() возвращает
    // реактивный прокси того же объекта, а не тот же самый reference —
    // сверяем по id/содержимому, а не через toBe().
    expect(level.getInstance(inst.id).id).toBe(inst.id)
    expect(level.getInstance(inst.id).state.x).toBe(5)
  })

  it('addEntity assigns unique ids to successive instances', () => {
    const level = createLevel()
    const a = level.addEntity('level_test_rigid', {})
    const b = level.addEntity('level_test_rigid', {})
    expect(a.id).not.toBe(b.id)
  })

  it('addEntity throws for an unregistered type', () => {
    const level = createLevel()
    expect(() => level.addEntity('nonexistent_type', {})).toThrow()
  })

  it('removeEntity removes the instance from state', () => {
    const level = createLevel()
    const inst = level.addEntity('level_test_rigid', {})
    level.removeEntity(inst.id)
    expect(level.state.entities).toHaveLength(0)
    expect(level.getInstance(inst.id)).toBeUndefined()
  })

  it('removeEntity on an unknown id is a harmless no-op', () => {
    const level = createLevel()
    level.addEntity('level_test_rigid', {})
    expect(() => level.removeEntity('nope')).not.toThrow()
    expect(level.state.entities).toHaveLength(1)
  })

  it('getDefinition resolves the definition for a live instance', () => {
    const level = createLevel()
    const inst = level.addEntity('level_test_rigid', {})
    expect(level.getDefinition(inst.id).type).toBe('level_test_rigid')
  })

  it('getEntitiesWithDefs pairs every instance with its definition', () => {
    const level = createLevel()
    level.addEntity('level_test_rigid', {})
    level.addEntity('level_test_bondy', {})
    const pairs = level.getEntitiesWithDefs()
    expect(pairs).toHaveLength(2)
    pairs.forEach((p) => expect(p.definition).toBeTruthy())
  })
})

describe('Level: connections', () => {
  it('creates a connection between two bondable entities', () => {
    const level = createLevel()
    const a = level.addEntity('level_test_bondy', { x: 0, y: 0 })
    const b = level.addEntity('level_test_bondy', { x: 50, y: 0 })
    level.toggleConnection(a.id, b.id)
    expect(level.connectionExists(a.id, b.id)).toBe(true)
    expect(level.state.connections).toHaveLength(1)
  })

  it('connectionExists is symmetric regardless of argument order', () => {
    const level = createLevel()
    const a = level.addEntity('level_test_bondy', {})
    const b = level.addEntity('level_test_bondy', {})
    level.toggleConnection(a.id, b.id)
    expect(level.connectionExists(b.id, a.id)).toBe(true)
  })

  it('refuses to connect when either entity is not bondable', () => {
    const level = createLevel()
    const a = level.addEntity('level_test_bondy', {})
    const b = level.addEntity('level_test_rigid', {})
    level.toggleConnection(a.id, b.id)
    expect(level.state.connections).toHaveLength(0)
  })

  it('refuses to connect an entity to itself', () => {
    const level = createLevel()
    const a = level.addEntity('level_test_bondy', {})
    level.toggleConnection(a.id, a.id)
    expect(level.state.connections).toHaveLength(0)
  })

  it('toggling an existing connection removes it', () => {
    const level = createLevel()
    const a = level.addEntity('level_test_bondy', {})
    const b = level.addEntity('level_test_bondy', {})
    level.toggleConnection(a.id, b.id)
    level.toggleConnection(a.id, b.id)
    expect(level.state.connections).toHaveLength(0)
  })

  it('stores the stick on the initiating entity so physics satisfies it exactly once per sub-step', () => {
    const level = createLevel()
    const a = level.addEntity('level_test_bondy', {})
    const b = level.addEntity('level_test_bondy', {})
    level.toggleConnection(a.id, b.id)
    expect(a.sticks).toHaveLength(1)
    expect(b.sticks).toHaveLength(0)
  })

  it('removeEntity also drops connections referencing the removed entity', () => {
    const level = createLevel()
    const a = level.addEntity('level_test_bondy', {})
    const b = level.addEntity('level_test_bondy', {})
    level.toggleConnection(a.id, b.id)
    level.removeEntity(b.id)
    expect(level.state.connections).toHaveLength(0)
  })

  it('removeConnection removes the connection and the stick reference from the initiator', () => {
    const level = createLevel()
    const a = level.addEntity('level_test_bondy', {})
    const b = level.addEntity('level_test_bondy', {})
    level.toggleConnection(a.id, b.id)
    level.removeConnection(a.id, b.id)
    expect(level.state.connections).toHaveLength(0)
    expect(a.sticks).toHaveLength(0)
  })

  it('pruneBrokenConnections removes connections whose stick has snapped', () => {
    const level = createLevel()
    const a = level.addEntity('level_test_bondy', {})
    const b = level.addEntity('level_test_bondy', {})
    level.toggleConnection(a.id, b.id)
    level.state.connections[0].stick.broken = true
    level.pruneBrokenConnections()
    expect(level.state.connections).toHaveLength(0)
    expect(a.sticks).toHaveLength(0)
  })

  it('pruneBrokenConnections leaves intact connections untouched', () => {
    const level = createLevel()
    const a = level.addEntity('level_test_bondy', {})
    const b = level.addEntity('level_test_bondy', {})
    level.toggleConnection(a.id, b.id)
    level.pruneBrokenConnections()
    expect(level.state.connections).toHaveLength(1)
  })
})
