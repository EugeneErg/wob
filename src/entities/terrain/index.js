import { defineEntity } from '../../core/registry.js'
import { bboxOfPoints, pointInPoly, nearestEdgeIndex } from '../../core/geom.js'

// Статичный рельеф. Из глобальных свойств отдаёт миру только гладкость.

export default defineEntity({
  type: 'terrain',
  title: 'Рельеф',
  z: -20,
  icon: '<svg viewBox="0 0 24 24"><path d="M2 19h20L15 7l-4 6-3-3z" fill="currentColor"/></svg>',

  defaults: () => ({
    points: [],
    smoothness: 0.35,
    fill: '#2a3326',
    edge: '#66804f',
  }),

  spawn(ctx, data) {
    const c = ctx.addCollider({
      points: data.points,
      smoothness: data.smoothness,
      restitution: 0.05,
    })
    return { c }
  },

  shapes(data) {
    if (data.points.length < 2) return []
    return [
      { k: 'poly', pts: data.points, closed: true, fill: data.fill, stroke: data.edge, sw: 4, join: 'round' },
    ]
  },

  editor: {
    create: {
      start: () => ({ points: [], cursor: null }),
      click(draft, pt) { draft.points.push([pt.x, pt.y]) },
      move(draft, pt) { draft.cursor = pt },
      shapes(draft) {
        const pts = draft.cursor ? [...draft.points, [draft.cursor.x, draft.cursor.y]] : draft.points
        if (!pts.length) return []
        const out = [{ k: 'poly', pts, closed: pts.length > 2, fill: 'rgba(102,128,79,.25)', stroke: '#8fb36a', sw: 2, dash: '6 6' }]
        for (const [x, y] of draft.points) out.push({ k: 'circle', x, y, r: 5, fill: '#8fb36a' })
        return out
      },
      finish(draft) {
        if (draft.points.length < 3) return null
        return { points: draft.points, smoothness: 0.35, fill: '#2a3326', edge: '#66804f' }
      },
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
      if (keep.length < 3) return false // мир удалит сущность целиком
      data.points = keep
      return true
    },
    addHandle(data, pt) {
      const i = nearestEdgeIndex(pt.x, pt.y, data.points, true)
      data.points.splice(i + 1, 0, [pt.x, pt.y])
    },

    props: () => [
      { key: 'smoothness', label: 'Гладкость', type: 'range', min: 0, max: 1, step: 0.05, global: true },
      { key: 'fill', label: 'Заливка', type: 'color' },
      { key: 'edge', label: 'Кромка', type: 'color' },
    ],
  },
})
