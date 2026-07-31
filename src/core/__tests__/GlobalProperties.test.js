import { describe, it, expect } from 'vitest'
import { PROP, readProperty } from '../GlobalProperties.js'

describe('PROP', () => {
  it('exposes exactly the five interaction properties from the spec', () => {
    expect(Object.values(PROP).sort()).toEqual(
      ['bondable', 'collision', 'smoothness', 'weight', 'zIndex'].sort()
    )
  })
})

describe('readProperty', () => {
  const instance = { state: { mass: 3 } }

  it('returns a constant value as-is', () => {
    const def = { properties: { [PROP.COLLISION]: true } }
    expect(readProperty(instance, def, PROP.COLLISION)).toBe(true)
  })

  it('calls a function property with (state, instance, world) and returns its result', () => {
    const def = { properties: { [PROP.WEIGHT]: (state) => state.mass * 2 } }
    expect(readProperty(instance, def, PROP.WEIGHT)).toBe(6)
  })

  it('re-evaluates function properties on every call (dynamic properties)', () => {
    let mass = 1
    const def = { properties: { [PROP.WEIGHT]: () => mass } }
    expect(readProperty(instance, def, PROP.WEIGHT)).toBe(1)
    mass = 99
    expect(readProperty(instance, def, PROP.WEIGHT)).toBe(99)
  })

  it('passes the world argument through to the getter', () => {
    const world = { tag: 'physics-world' }
    const def = { properties: { [PROP.WEIGHT]: (_s, _i, w) => w.tag } }
    expect(readProperty(instance, def, PROP.WEIGHT, world)).toBe('physics-world')
  })

  it('falls back to the built-in default when the entity does not define the property', () => {
    const def = { properties: {} }
    expect(readProperty(instance, def, PROP.SMOOTHNESS)).toBe(0.5)
    expect(readProperty(instance, def, PROP.COLLISION)).toBe(true)
    expect(readProperty(instance, def, PROP.BONDABLE)).toBe(false)
    expect(readProperty(instance, def, PROP.Z_INDEX)).toBe(0)
    expect(readProperty(instance, def, PROP.WEIGHT)).toBe(1)
  })

  it('falls back to defaults when the definition has no properties object at all', () => {
    expect(readProperty(instance, {}, PROP.COLLISION)).toBe(true)
  })

  it('treats an explicit falsy constant (0/false) as a real value, not "missing"', () => {
    const def = { properties: { [PROP.COLLISION]: false, [PROP.Z_INDEX]: 0 } }
    expect(readProperty(instance, def, PROP.COLLISION)).toBe(false)
    expect(readProperty(instance, def, PROP.Z_INDEX)).toBe(0)
  })
})
