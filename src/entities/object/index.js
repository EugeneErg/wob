import { defineEntity } from '../../core/registry.js'
import { LAYERS } from '../../core/globals.js'
import { bboxOfPoints, pointInPoly, nearestEdgeIndex } from '../../core/geom.js'

// Физический объект: полигон с весом, который живёт по законам мира —
// падает, вращается, на него можно встать. Игрок его не трогает.
// Вершины держит жёсткая форма (ctx.addBody), геометрия коллайдера живая,
// поэтому шары и другие объекты сталкиваются с ним по его настоящему контуру.

export default defineEntity({
  type: 'object',
  title: 'Object',
  z: LAYERS.body - 1,
  icon: '<svg viewBox="0 0 24 24"><path d="M4 8l8-4 8 4v8l-8 4-8-4z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>',

  defaults: () => ({
    points: [],
    mass: 6,
    smoothness: 0.4,
    restitution: 0.1,
    static: false,
    fill: '#5c5346',
    edge: '#8d7f68',
  }),

  spawn(ctx, data) {
    const pts = data.points
    if (pts.length < 3) return {}
    const per = Math.max(0.05, Math.abs(data.mass) / pts.length) * Math.sign(data.mass || 1)
    const verts = pts.map(([x, y]) => ctx.addPoint({
      x, y,
      radius: 3,
      mass: per,
      pinned: data.static,
      restitution: data.restitution,
      smoothness: data.smoothness,
      collision: { world: true, points: false },
      attachable: false,
    }))
    const body = data.static ? null : ctx.addBody({ points: verts, stiffness: 1 })
    const col = ctx.addCollider({
      verts,
      smoothness: data.smoothness,
      restitution: data.restitution,
    })
    return { verts, body, col }
  },

  shapes(data, rt) {
    const pts = rt?.verts ? rt.verts.map((p) => [p.x, p.y]) : data.points
    if (pts.length < 3) return []
    const out = [{ k: 'poly', pts, closed: true, fill: data.fill, stroke: data.edge, sw: 3, join: 'round' }]
    // насечка, чтобы вращение было видно
    const c = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0])
    out.push({ k: 'line', x1: c[0], y1: c[1], x2: pts[0][0], y2: pts[0][1], stroke: data.edge, sw: 1.5, opacity: 0.45 })
    if (data.static) out.push({ k: 'circle', x: c[0], y: c[1], r: 4, fill: data.edge, opacity: 0.7 })
    return out
  },

  editor: {
    create: {
      start: () => ({ points: [], cursor: null }),
      click(draft, pt) { draft.points.push([pt.x, pt.y]) },
      move(draft, pt) { draft.cursor = pt },
      shapes(draft) {
        const pts = draft.cursor ? [...draft.points, [draft.cursor.x, draft.cursor.y]] : draft.points
        if (!pts.length) return []
        const out = [{ k: 'poly', pts, closed: pts.length > 2, fill: 'rgba(141,127,104,.3)', stroke: '#8d7f68', sw: 2, dash: '6 6' }]
        for (const [x, y] of draft.points) out.push({ k: 'circle', x, y, r: 5, fill: '#8d7f68' })
        return out
      },
      finish: (draft) => (draft.points.length >= 3
        ? { points: draft.points, mass: 6, smoothness: 0.4, restitution: 0.1, static: false, fill: '#5c5346', edge: '#8d7f68' }
        : null),
    },

    bounds: (data) => bboxOfPoints(data.points),
    hit: (data, pt) => pointInPoly(pt.x, pt.y, data.points),
    move(data, dx, dy) { for (const p of data.points) { p[0] += dx; p[1] += dy } },

    handles: (data) => data.points.map(([x, y], i) => ({ id: i, x, y })),
    moveHandles(data, ids, dx, dy) {
      for (const i of ids) { data.points[i][0] += dx; data.points[i][1] += dy }
    },
    deleteHandles(data, ids) {
      const keep = data.points.filter((_, i) => !ids.includes(i))
      if (keep.length < 3) return false
      data.points = keep
      return true
    },
    addHandle(data, pt) {
      const i = nearestEdgeIndex(pt.x, pt.y, data.points, true)
      data.points.splice(i + 1, 0, [pt.x, pt.y])
    },

    props: () => [
      { key: 'mass', label: 'Weight', type: 'range', min: -20, max: 40, step: 0.5, global: true },
      { key: 'smoothness', label: 'Smoothness', type: 'range', min: 0, max: 1, step: 0.05, global: true },
      { key: 'restitution', label: 'Bounciness', type: 'range', min: 0, max: 1, step: 0.05, global: true },
      { key: 'static', label: 'Fixed in place', type: 'bool' },
      { key: 'fill', label: 'Fill', type: 'color' },
      { key: 'edge', label: 'Edge', type: 'color' },
    ],
  },
})
