import { describe, it, expect, vi } from 'vitest'
import pipe from '../index.js'
import { PROP, readProperty } from '../../../core/GlobalProperties.js'
import { VerletPoint } from '../../../core/verlet.js'

function makeInstance(props) {
  return pipe.createInstance('pipe_1', props)
}

function fakeWorld(entities) {
  return {
    level: {
      getEntitiesWithDefs: () => entities,
      removeEntity: vi.fn(),
    },
  }
}

const collidingDef = { properties: { [PROP.COLLISION]: true } }
const nonCollidingDef = { properties: { [PROP.COLLISION]: false } }

describe('pipe: createInstance', () => {
  it('defaults "from" to the placement point and "to" offset from it', () => {
    const inst = makeInstance({ x: 10, y: 20 })
    expect(inst.state.from).toEqual({ x: 10, y: 20 })
    expect(inst.state.to).toEqual({ x: 100, y: 10 })
  })

  it('accepts explicit from/to/width overrides', () => {
    const inst = makeInstance({ from: { x: 1, y: 2 }, to: { x: 3, y: 4 } })
    expect(inst.state.from).toEqual({ x: 1, y: 2 })
    expect(inst.state.to).toEqual({ x: 3, y: 4 })
  })
})

describe('pipe: global properties', () => {
  it('is static and does not physically collide with anything itself', () => {
    const inst = makeInstance({ x: 0, y: 0 })
    expect(readProperty(inst, pipe, PROP.WEIGHT)).toBe(Infinity)
    expect(readProperty(inst, pipe, PROP.COLLISION)).toBe(false)
  })

  it('is not bondable and draws between rock and balls (z-index 5)', () => {
    const inst = makeInstance({ x: 0, y: 0 })
    expect(readProperty(inst, pipe, PROP.BONDABLE)).toBe(false)
    expect(readProperty(inst, pipe, PROP.Z_INDEX)).toBe(5)
  })
})

describe('pipe: physics.update (suction)', () => {
  it('pulls a colliding point-based entity within range toward the mouth', () => {
    const inst = makeInstance({ x: 0, y: 0 })
    const victimPoint = new VerletPoint(40, 0, { radius: 10 })
    const victim = { id: 'victim', points: [victimPoint] }
    const world = fakeWorld([
      { instance: inst, definition: pipe },
      { instance: victim, definition: collidingDef },
    ])
    pipe.physics.update(inst, 1 / 60, world)
    // импульс не двигает точку мгновенно — он меняет её "скорость" (x - oldX).
    // Устье находится левее точки (mouth.x=0 < p.x=40), поэтому итоговая
    // скорость должна быть отрицательной — на следующем шаге точка пойдёт влево, к устью.
    const velocityX = victimPoint.x - victimPoint.oldX
    expect(velocityX).toBeLessThan(0)
    expect(world.level.removeEntity).not.toHaveBeenCalled()
  })

  it('consumes (removes) an entity once it is close enough to the mouth', () => {
    const inst = makeInstance({ x: 0, y: 0 })
    const victimPoint = new VerletPoint(5, 0, { radius: 5 }) // ближе, чем CONSUME_DISTANCE
    const victim = { id: 'victim', points: [victimPoint] }
    const world = fakeWorld([
      { instance: inst, definition: pipe },
      { instance: victim, definition: collidingDef },
    ])
    pipe.physics.update(inst, 1 / 60, world)
    expect(world.level.removeEntity).toHaveBeenCalledWith('victim')
  })

  it('ignores entities outside the suction radius', () => {
    const inst = makeInstance({ x: 0, y: 0 })
    const farPoint = new VerletPoint(10000, 0, { radius: 10 })
    const far = { id: 'far', points: [farPoint] }
    const world = fakeWorld([
      { instance: inst, definition: pipe },
      { instance: far, definition: collidingDef },
    ])
    const before = { x: farPoint.x, oldX: farPoint.oldX }
    pipe.physics.update(inst, 1 / 60, world)
    expect(farPoint.x).toBe(before.x)
    expect(farPoint.oldX).toBe(before.oldX)
    expect(world.level.removeEntity).not.toHaveBeenCalled()
  })

  it('ignores entities without a collision-capable body (no points)', () => {
    const inst = makeInstance({ x: 0, y: 0 })
    const bodyless = { id: 'bodyless', state: {} }
    const world = fakeWorld([
      { instance: inst, definition: pipe },
      { instance: bodyless, definition: collidingDef },
    ])
    expect(() => pipe.physics.update(inst, 1 / 60, world)).not.toThrow()
    expect(world.level.removeEntity).not.toHaveBeenCalled()
  })

  it('ignores entities whose collision property is false', () => {
    const inst = makeInstance({ x: 0, y: 0 })
    const ghostPoint = new VerletPoint(5, 0, { radius: 5 })
    const ghost = { id: 'ghost', points: [ghostPoint] }
    const world = fakeWorld([
      { instance: inst, definition: pipe },
      { instance: ghost, definition: nonCollidingDef },
    ])
    pipe.physics.update(inst, 1 / 60, world)
    expect(world.level.removeEntity).not.toHaveBeenCalled()
  })

  it('never tries to suck itself', () => {
    const inst = makeInstance({ x: 0, y: 0 })
    const world = fakeWorld([{ instance: inst, definition: pipe }])
    expect(() => pipe.physics.update(inst, 1 / 60, world)).not.toThrow()
    expect(world.level.removeEntity).not.toHaveBeenCalled()
  })
})

describe('pipe: editor', () => {
  it('getBounds wraps both endpoints with padding', () => {
    const inst = makeInstance({ from: { x: 0, y: 0 }, to: { x: 10, y: 10 } })
    const bounds = pipe.editor.getBounds(inst)
    expect(bounds.x).toBeLessThanOrEqual(0)
    expect(bounds.y).toBeLessThanOrEqual(0)
    expect(bounds.width).toBeGreaterThanOrEqual(10)
    expect(bounds.height).toBeGreaterThanOrEqual(10)
  })

  it('onRectSelect selects "from" when it falls in the rect', () => {
    const inst = makeInstance({ from: { x: 5, y: 5 }, to: { x: 500, y: 500 } })
    pipe.editor.onRectSelect(inst, { x: 0, y: 0, width: 10, height: 10 })
    expect(inst.state._selectedEndpoint).toBe('from')
  })

  it('onRectSelect selects "to" when it falls in the rect', () => {
    const inst = makeInstance({ from: { x: 500, y: 500 }, to: { x: 5, y: 5 } })
    pipe.editor.onRectSelect(inst, { x: 0, y: 0, width: 10, height: 10 })
    expect(inst.state._selectedEndpoint).toBe('to')
  })

  it('onRectSelect clears selection when neither endpoint is in the rect', () => {
    const inst = makeInstance({ from: { x: 500, y: 500 }, to: { x: 600, y: 600 } })
    inst.state._selectedEndpoint = 'from'
    pipe.editor.onRectSelect(inst, { x: 0, y: 0, width: 10, height: 10 })
    expect(inst.state._selectedEndpoint).toBe(null)
  })

  it('onClearSelection resets the selected endpoint', () => {
    const inst = makeInstance({ x: 0, y: 0 })
    inst.state._selectedEndpoint = 'to'
    pipe.editor.onClearSelection(inst)
    expect(inst.state._selectedEndpoint).toBe(null)
  })
})
