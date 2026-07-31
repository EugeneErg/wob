import { describe, it, expect, vi } from 'vitest'
import { useDragSelect, rectIntersectsCircle, rectIntersectsPolygon } from '../useDragSelect.js'

describe('useDragSelect', () => {
  it('is not dragging before begin() is called', () => {
    const { isDragging } = useDragSelect()
    expect(isDragging.value).toBe(false)
  })

  it('starts dragging on begin() and computes a normalized rect as the cursor moves', () => {
    const { isDragging, rect, begin, move } = useDragSelect()
    begin(50, 50)
    expect(isDragging.value).toBe(true)
    move(10, 20) // курсор ушёл влево-вверх от старта — rect должен нормализоваться
    expect(rect.value).toEqual({ x: 10, y: 20, width: 40, height: 30 })
  })

  it('move() before begin() has no effect', () => {
    const { isDragging, move } = useDragSelect()
    move(10, 10)
    expect(isDragging.value).toBe(false)
  })

  it('calls onComplete with the final rect when the drag moved enough to count as a selection', () => {
    const onComplete = vi.fn()
    const { begin, move, end } = useDragSelect(onComplete)
    begin(0, 0)
    move(100, 100)
    const moved = end()
    expect(moved).toBe(true)
    expect(onComplete).toHaveBeenCalledWith({ x: 0, y: 0, width: 100, height: 100 })
  })

  it('treats a tiny movement as a click, not a rectangle, and does not call onComplete', () => {
    const onComplete = vi.fn()
    const { begin, move, end } = useDragSelect(onComplete)
    begin(50, 50)
    move(51, 51)
    const moved = end()
    expect(moved).toBe(false)
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('end() sets isDragging back to false', () => {
    const { isDragging, begin, end } = useDragSelect()
    begin(0, 0)
    end()
    expect(isDragging.value).toBe(false)
  })

  it('end() before begin() is a harmless no-op', () => {
    const onComplete = vi.fn()
    const { end } = useDragSelect(onComplete)
    expect(() => end()).not.toThrow()
    expect(onComplete).not.toHaveBeenCalled()
  })
})

describe('rectIntersectsCircle', () => {
  const rect = { x: 0, y: 0, width: 100, height: 100 }

  it('returns true when the circle center is inside the rect', () => {
    expect(rectIntersectsCircle(rect, 50, 50, 5)).toBe(true)
  })

  it('returns true when the circle merely overlaps the rect edge', () => {
    expect(rectIntersectsCircle(rect, 105, 50, 10)).toBe(true)
  })

  it('returns false when the circle is far outside the rect', () => {
    expect(rectIntersectsCircle(rect, 500, 500, 10)).toBe(false)
  })
})

describe('rectIntersectsPolygon', () => {
  const rect = { x: 0, y: 0, width: 10, height: 10 }

  it('returns true when at least one polygon vertex is inside the rect', () => {
    const points = [{ x: 5, y: 5 }, { x: 500, y: 500 }]
    expect(rectIntersectsPolygon(rect, points)).toBe(true)
  })

  it('returns false when no polygon vertex is inside the rect', () => {
    const points = [{ x: 500, y: 500 }, { x: 600, y: 600 }]
    expect(rectIntersectsPolygon(rect, points)).toBe(false)
  })
})
