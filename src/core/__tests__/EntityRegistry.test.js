import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  registerEntity,
  getEntityDefinition,
  getAllEntityDefinitions,
  hasEntity,
} from '../EntityRegistry.js'

function fakeDef(type, overrides = {}) {
  return { type, name: type, icon: '❔', properties: {}, ...overrides }
}

describe('EntityRegistry', () => {
  it('registers a definition and makes it retrievable by type', () => {
    registerEntity(fakeDef('test_widget'))
    expect(hasEntity('test_widget')).toBe(true)
    expect(getEntityDefinition('test_widget').type).toBe('test_widget')
  })

  it('returns undefined for an unregistered type', () => {
    expect(getEntityDefinition('does_not_exist')).toBeUndefined()
    expect(hasEntity('does_not_exist')).toBe(false)
  })

  it('throws when registering a definition without a type', () => {
    expect(() => registerEntity({ name: 'nameless' })).toThrow()
    expect(() => registerEntity(null)).toThrow()
  })

  it('includes registered definitions in getAllEntityDefinitions()', () => {
    registerEntity(fakeDef('test_widget_2'))
    const all = getAllEntityDefinitions()
    expect(all.some((d) => d.type === 'test_widget_2')).toBe(true)
  })

  it('overwrites an existing definition when the same type is registered again, with a warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerEntity(fakeDef('test_widget_3', { name: 'first' }))
    registerEntity(fakeDef('test_widget_3', { name: 'second' }))
    expect(getEntityDefinition('test_widget_3').name).toBe('second')
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('does not duplicate entries in getAllEntityDefinitions() for re-registered types', () => {
    registerEntity(fakeDef('test_widget_4'))
    registerEntity(fakeDef('test_widget_4'))
    const count = getAllEntityDefinitions().filter((d) => d.type === 'test_widget_4').length
    expect(count).toBe(1)
  })
})
