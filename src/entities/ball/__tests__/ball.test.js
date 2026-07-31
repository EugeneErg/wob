import { describe, it, expect, vi } from 'vitest'
import ball from '../index.js'
import { PROP, readProperty } from '../../../core/GlobalProperties.js'

function makeInstance(props) {
  return ball.createInstance('ball_1', props)
}

describe('ball: createInstance', () => {
  it('creates a single physics point at the given position', () => {
    const inst = makeInstance({ x: 42, y: 24 })
    expect(inst.points).toHaveLength(1)
    expect(inst.points[0].x).toBe(42)
    expect(inst.points[0].y).toBe(24)
  })

  it('defaults radius to 22 and mass to 1', () => {
    const inst = makeInstance({ x: 0, y: 0 })
    expect(inst.state.radius).toBe(22)
    expect(inst.state.mass).toBe(1)
  })

  it('respects explicit radius/mass/color overrides', () => {
    const inst = makeInstance({ x: 0, y: 0, radius: 10, mass: 5, color: '#123456' })
    expect(inst.state.radius).toBe(10)
    expect(inst.state.mass).toBe(5)
    expect(inst.state.color).toBe('#123456')
    expect(inst.points[0].radius).toBe(10)
  })

  it('starts with an empty sticks array (ready to receive bonds)', () => {
    const inst = makeInstance({ x: 0, y: 0 })
    expect(inst.sticks).toEqual([])
  })
})

describe('ball: global properties', () => {
  it('reads weight dynamically from state.mass', () => {
    const inst = makeInstance({ x: 0, y: 0, mass: 3 })
    expect(readProperty(inst, ball, PROP.WEIGHT)).toBe(3)
    inst.state.mass = 7
    expect(readProperty(inst, ball, PROP.WEIGHT)).toBe(7)
  })

  it('is bondable', () => {
    const inst = makeInstance({ x: 0, y: 0 })
    expect(readProperty(inst, ball, PROP.BONDABLE)).toBe(true)
  })

  it('is always drawn above rock/pipe (high z-index)', () => {
    const inst = makeInstance({ x: 0, y: 0 })
    expect(readProperty(inst, ball, PROP.Z_INDEX)).toBe(10)
  })

  it('participates in collisions', () => {
    const inst = makeInstance({ x: 0, y: 0 })
    expect(readProperty(inst, ball, PROP.COLLISION)).toBe(true)
  })
})

describe('ball: editor.getBounds', () => {
  it('returns a square bounding box centered on the point with side 2*radius', () => {
    const inst = makeInstance({ x: 100, y: 100, radius: 20 })
    expect(ball.editor.getBounds(inst)).toEqual({ x: 80, y: 80, width: 40, height: 40 })
  })
})

describe('ball: editor.onEntityClick (bonding)', () => {
  it('asks the level to toggle a connection when the other entity is bondable', () => {
    const a = makeInstance({ x: 0, y: 0 })
    const b = makeInstance({ x: 100, y: 0 })
    b.id = 'ball_2'
    const level = { toggleConnection: vi.fn() }
    ball.editor.onEntityClick(a, b, ball, level)
    expect(level.toggleConnection).toHaveBeenCalledWith(a.id, b.id)
  })

  it('does nothing when the other entity is not bondable', () => {
    const a = makeInstance({ x: 0, y: 0 })
    const notBondable = { id: 'rock_1', state: {} }
    const rigidDef = { properties: { [PROP.BONDABLE]: false } }
    const level = { toggleConnection: vi.fn() }
    ball.editor.onEntityClick(a, notBondable, rigidDef, level)
    expect(level.toggleConnection).not.toHaveBeenCalled()
  })

  it('does nothing when clicking itself', () => {
    const a = makeInstance({ x: 0, y: 0 })
    const level = { toggleConnection: vi.fn() }
    ball.editor.onEntityClick(a, a, ball, level)
    expect(level.toggleConnection).not.toHaveBeenCalled()
  })
})
