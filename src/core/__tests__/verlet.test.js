import { describe, it, expect } from 'vitest'
import { VerletPoint, VerletStick, distance, pointInPolygon, closestPointOnSegment } from '../verlet.js'

describe('VerletPoint', () => {
  it('carries inertia forward each update (previous displacement repeats)', () => {
    const p = new VerletPoint(0, 0)
    p.oldX = -5 // симулируем предыдущее движение на +5 по x
    p.oldY = 0
    p.update(1, { x: 0, y: 0 }, 1) // damping=1, без гравитации
    expect(p.x).toBeCloseTo(5) // x(0) + (x(0)-oldX) = 0 + 5 = 5
  })

  it('applies gravity quadratically in dt', () => {
    const p = new VerletPoint(0, 0)
    p.update(1, { x: 0, y: 10 }, 1)
    expect(p.y).toBeCloseTo(10) // 0 + 0 + 10*1*1
  })

  it('does not move pinned points', () => {
    const p = new VerletPoint(5, 5, { pinned: true })
    p.update(1, { x: 0, y: 100 })
    expect(p.x).toBe(5)
    expect(p.y).toBe(5)
  })

  it('applyImpulse changes velocity by shifting oldX/oldY, not position directly', () => {
    const p = new VerletPoint(0, 0)
    p.applyImpulse(3, 4)
    expect(p.x).toBe(0)
    expect(p.y).toBe(0)
    expect(p.oldX).toBe(-3)
    expect(p.oldY).toBe(-4)
    // на следующем шаге импульс проявится как перемещение
    p.update(1, { x: 0, y: 0 }, 1)
    expect(p.x).toBeCloseTo(3)
    expect(p.y).toBeCloseTo(4)
  })

  it('applyImpulse is a no-op for pinned points', () => {
    const p = new VerletPoint(0, 0, { pinned: true })
    p.applyImpulse(10, 10)
    expect(p.oldX).toBe(0)
    expect(p.oldY).toBe(0)
  })

  it('setPosition resets both current and old position (kills velocity)', () => {
    const p = new VerletPoint(0, 0)
    p.oldX = -10
    p.setPosition(50, 60)
    expect(p.x).toBe(50)
    expect(p.y).toBe(60)
    expect(p.oldX).toBe(50)
    expect(p.oldY).toBe(60)
  })

  it('damping reduces carried-over velocity', () => {
    const p = new VerletPoint(10, 0)
    p.oldX = 0 // предыдущая скорость по x была +10
    p.update(1, { x: 0, y: 0 }, 0.5)
    expect(p.x).toBeCloseTo(15) // 10 + 10*0.5
  })
})

describe('VerletStick', () => {
  it('defaults its rest length to the initial distance between points', () => {
    const a = new VerletPoint(0, 0)
    const b = new VerletPoint(10, 0)
    const stick = new VerletStick(a, b)
    expect(stick.length).toBeCloseTo(10)
  })

  it('pulls stretched points back toward rest length', () => {
    const a = new VerletPoint(0, 0)
    const b = new VerletPoint(20, 0)
    const stick = new VerletStick(a, b, { length: 10, stiffness: 1 })
    stick.satisfy()
    expect(distance(a, b)).toBeCloseTo(10)
    expect(a.x).toBeGreaterThan(0)
    expect(b.x).toBeLessThan(20)
  })

  it('pushes compressed points apart back toward rest length', () => {
    const a = new VerletPoint(0, 0)
    const b = new VerletPoint(2, 0)
    const stick = new VerletStick(a, b, { length: 10, stiffness: 1 })
    stick.satisfy()
    expect(distance(a, b)).toBeCloseTo(10)
  })

  it('does not move pinned endpoints', () => {
    const a = new VerletPoint(0, 0, { pinned: true })
    const b = new VerletPoint(20, 0)
    const stick = new VerletStick(a, b, { length: 10, stiffness: 1 })
    stick.satisfy()
    expect(a.x).toBe(0)
    expect(a.y).toBe(0)
  })

  it('stiffness scales the correction applied per call', () => {
    const a = new VerletPoint(0, 0)
    const b = new VerletPoint(20, 0)
    const stick = new VerletStick(a, b, { length: 10, stiffness: 0.5 })
    stick.satisfy()
    // при stiffness=1 расстояние стало бы точно 10 за 1 шаг; при 0.5 — только половина коррекции
    expect(distance(a, b)).toBeGreaterThan(10)
    expect(distance(a, b)).toBeLessThan(20)
  })

  it('breaks when stretched beyond maxStretch and stops correcting afterwards', () => {
    const a = new VerletPoint(0, 0)
    const b = new VerletPoint(10, 0)
    const stick = new VerletStick(a, b, { length: 10, breakable: true, maxStretch: 1.5 })
    b.x = 20 // растяжение x2, больше чем maxStretch=1.5
    const broke = stick.satisfy()
    expect(broke).toBe(true)
    expect(stick.broken).toBe(true)
    // дальнейшие вызовы ничего не делают
    const positionsBefore = { ax: a.x, bx: b.x }
    stick.satisfy()
    expect(a.x).toBe(positionsBefore.ax)
    expect(b.x).toBe(positionsBefore.bx)
  })

  it('does not break when breakable is false, regardless of stretch', () => {
    const a = new VerletPoint(0, 0)
    const b = new VerletPoint(1000, 0)
    const stick = new VerletStick(a, b, { length: 10, breakable: false })
    const broke = stick.satisfy()
    expect(broke).toBe(false)
    expect(stick.broken).toBe(false)
  })
})

describe('distance', () => {
  it('computes euclidean distance between two points', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  })
})

describe('pointInPolygon', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]

  it('returns true for a point inside the polygon', () => {
    expect(pointInPolygon(5, 5, square)).toBe(true)
  })

  it('returns false for a point outside the polygon', () => {
    expect(pointInPolygon(50, 50, square)).toBe(false)
  })

  it('handles non-convex (L-shaped) polygons correctly', () => {
    const lShape = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 10 },
      { x: 0, y: 10 },
    ]
    expect(pointInPolygon(8, 8, lShape)).toBe(false) // в вырезанном углу
    expect(pointInPolygon(2, 2, lShape)).toBe(true)
  })
})

describe('closestPointOnSegment', () => {
  it('returns the perpendicular projection when it falls within the segment', () => {
    const result = closestPointOnSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })
    expect(result.x).toBeCloseTo(5)
    expect(result.y).toBeCloseTo(0)
    expect(result.dist).toBeCloseTo(5)
  })

  it('clamps to the nearest endpoint when the projection falls outside the segment', () => {
    const result = closestPointOnSegment({ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })
    expect(result.x).toBeCloseTo(0)
    expect(result.y).toBeCloseTo(0)
    expect(result.dist).toBeCloseTo(5)
  })

  it('reports a normal vector pointing from the segment toward the point', () => {
    const result = closestPointOnSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })
    expect(result.nx).toBeCloseTo(0)
    expect(result.ny).toBeCloseTo(5)
  })
})
