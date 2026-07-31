import { describe, it, expect } from 'vitest'
import rock from '../index.js'
import { PROP, readProperty } from '../../../core/GlobalProperties.js'

function makeInstance(props) {
  return rock.createInstance('rock_1', props)
}

describe('rock: createInstance', () => {
  it('generates a default quadrilateral polygon centered around the given point', () => {
    const inst = makeInstance({ x: 100, y: 100 })
    expect(inst.state.points).toHaveLength(4)
    inst.state.points.forEach((p) => {
      expect(typeof p.x).toBe('number')
      expect(typeof p.y).toBe('number')
    })
  })

  it('accepts a custom polygon when provided', () => {
    const custom = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }]
    const inst = makeInstance({ points: custom })
    expect(inst.state.points).toBe(custom)
  })

  it('keeps collisionShape.points as the same array reference as state.points (stays in sync when edited)', () => {
    const inst = makeInstance({ x: 0, y: 0 })
    expect(inst.collisionShape.points).toBe(inst.state.points)
    inst.state.points[0].x = 999
    expect(inst.collisionShape.points[0].x).toBe(999)
  })

  it('starts with no selected vertices', () => {
    const inst = makeInstance({ x: 0, y: 0 })
    expect(inst.state._selectedVertices).toEqual([])
  })
})

describe('rock: global properties', () => {
  it('is infinitely heavy (static)', () => {
    const inst = makeInstance({ x: 0, y: 0 })
    expect(readProperty(inst, rock, PROP.WEIGHT)).toBe(Infinity)
  })

  it('participates in collisions', () => {
    const inst = makeInstance({ x: 0, y: 0 })
    expect(readProperty(inst, rock, PROP.COLLISION)).toBe(true)
  })

  it('is not bondable', () => {
    const inst = makeInstance({ x: 0, y: 0 })
    expect(readProperty(inst, rock, PROP.BONDABLE)).toBe(false)
  })

  it('reads smoothness dynamically from its own state', () => {
    const inst = makeInstance({ x: 0, y: 0 })
    inst.state.smoothness = 0.8
    expect(readProperty(inst, rock, PROP.SMOOTHNESS)).toBe(0.8)
  })

  it('has default z-index 0 (drawn below balls)', () => {
    const inst = makeInstance({ x: 0, y: 0 })
    expect(readProperty(inst, rock, PROP.Z_INDEX)).toBe(0)
  })
})

describe('rock: editor.getBounds', () => {
  it('computes the axis-aligned bounding box of the polygon', () => {
    const inst = makeInstance({ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: 0, y: 20 }] })
    expect(rock.editor.getBounds(inst)).toEqual({ x: 0, y: 0, width: 10, height: 20 })
  })
})

describe('rock: editor.onRectSelect', () => {
  it('selects only vertices that fall inside the given rect', () => {
    const inst = makeInstance({ points: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 5, y: 5 }] })
    rock.editor.onRectSelect(inst, { x: -1, y: -1, width: 10, height: 10 })
    expect(inst.state._selectedVertices.sort()).toEqual([0, 2])
  })

  it('selects nothing when the rect covers no vertices', () => {
    const inst = makeInstance({ points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] })
    rock.editor.onRectSelect(inst, { x: 500, y: 500, width: 10, height: 10 })
    expect(inst.state._selectedVertices).toEqual([])
  })
})

describe('rock: editor.onClearSelection', () => {
  it('empties the selected vertex list', () => {
    const inst = makeInstance({ x: 0, y: 0 })
    inst.state._selectedVertices = [0, 1]
    rock.editor.onClearSelection(inst)
    expect(inst.state._selectedVertices).toEqual([])
  })
})

describe('rock: editor.deleteSelection', () => {
  it('removes the selected vertices when enough vertices remain', () => {
    const inst = makeInstance({
      points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 4 }],
    })
    inst.state._selectedVertices = [1, 3]
    const handled = rock.editor.deleteSelection(inst)
    expect(handled).toBe(true)
    expect(inst.state.points).toHaveLength(3)
    expect(inst.state.points.map((p) => p.x)).toEqual([0, 2, 4])
    expect(inst.state._selectedVertices).toEqual([])
  })

  it('refuses to delete vertices that would leave fewer than 3 (still reports handled)', () => {
    const inst = makeInstance({ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }] })
    inst.state._selectedVertices = [0, 1]
    const handled = rock.editor.deleteSelection(inst)
    expect(handled).toBe(true)
    expect(inst.state.points).toHaveLength(3) // ничего не удалено
  })

  it('returns false (not handled) when nothing is selected, so the caller falls back to default behavior', () => {
    const inst = makeInstance({ x: 0, y: 0 })
    inst.state._selectedVertices = []
    expect(rock.editor.deleteSelection(inst)).toBe(false)
  })
})
