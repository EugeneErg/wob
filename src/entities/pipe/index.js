import { defineEntity } from '../../core/registry.js'
import { LAYERS } from '../../core/globals.js'
import { bboxOfPoints, distToPolyline, nearestEdgeIndex } from '../../core/geom.js'

// Труба. Первая точка ломаной — устье.
// Глобально устье отдаёт миру "всасывание". Как только рядом оказывается тело,
// к которому можно лепить связи, труба строит к нему невидимую связь и тянет к себе.

export default defineEntity({
  type: 'pipe',
  title: 'Pipe',
  z: LAYERS.midground,
  icon: '<svg viewBox="0 0 24 24"><path d="M4 18v-6a5 5 0 0 1 5-5h11" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/></svg>',

  defaults: () => ({
    points: [],
    radius: 30,
    power: 1,
    color: '#4c93c4',
    inner: '#0d1a24',
  }),

  spawn(ctx, data) {
    const [mx, my] = ctx.place(...(data.points[0] || [0, 0]))
    const mouth = ctx.addPoint({
      x: mx, y: my,
      radius: data.radius,
      pinned: true,
      attachable: false,
      suction: data.power,
      collision: { world: false, points: false },
    })
    return { mouth, link: null }
  },

  update(rt, ctx, dt, data) {
    const m = rt.mouth
    if (rt.link && rt.link.removed) rt.link = null

    if (rt.link) {
      const far = rt.link.a === m ? rt.link.b : rt.link.a
      // держим только конструкцию: одиночное тело на трубе висеть не должно
      const alone = !far.pinned && far.links.length <= 1
      if (!far.attachable || alone) { ctx.removeLink(rt.link); rt.link = null; return }
      // лебёдка: тянем конструкцию к устью со скоростью 60 px/с
      rt.link.rest = Math.max(data.radius * 0.8, rt.link.rest - 60 * dt)
      return
    }
    const t = ctx.nearest(m, (q) => q.attachable && (q.pinned || q.links.length > 0), data.radius * 3.5)
    if (t) {
      rt.link = ctx.addLink(m, t, {
        visible: false,
        spring: 900,
        damping: 0.3,
        rest: Math.hypot(t.x - m.x, t.y - m.y), // подтягиваем плавно, а не рывком
      })
    }
  },

  shapes(data, rt, ctx) {
    if (data.points.length < 2) return []
    const pts = ctx ? ctx.placePoints(data.points) : data.points
    const [mx, my] = rt?.mouth ? [rt.mouth.x, rt.mouth.y] : pts[0]
    const r = data.radius
    const active = !!rt?.link
    const out = [
      { k: 'poly', pts, stroke: data.color, sw: r * 2, cap: 'round', join: 'round' },
      { k: 'poly', pts, stroke: data.inner, sw: r * 2 - 10, cap: 'round', join: 'round' },
      { k: 'poly', pts, stroke: active ? '#8fe0ff' : '#2f5c78', sw: 6, cap: 'round', join: 'round', dash: '14 16', class: active ? 'flow' : '' },
      { k: 'circle', x: mx, y: my, r, fill: 'none', stroke: data.color, sw: 6 },
      { k: 'circle', x: mx, y: my, r: r - 6, fill: data.inner },
    ]
    if (active) out.push({ k: 'circle', x: mx, y: my, r: r + 6, fill: 'none', stroke: '#8fe0ff', sw: 2, opacity: 0.5, class: 'pulse' })
    return out
  },

  editor: {
    create: {
      start: () => ({ points: [], cursor: null }),
      click(draft, pt) { draft.points.push([pt.x, pt.y]) },
      move(draft, pt) { draft.cursor = pt },
      shapes(draft) {
        const pts = draft.cursor ? [...draft.points, [draft.cursor.x, draft.cursor.y]] : draft.points
        if (pts.length < 2) return pts.length ? [{ k: 'circle', x: pts[0][0], y: pts[0][1], r: 30, fill: 'none', stroke: '#4c93c4', sw: 2, dash: '5 5' }] : []
        return [
          { k: 'poly', pts, stroke: 'rgba(76,147,196,.45)', sw: 60, cap: 'round', join: 'round' },
          { k: 'circle', x: pts[0][0], y: pts[0][1], r: 30, fill: 'none', stroke: '#8fe0ff', sw: 3 },
        ]
      },
      finish: (draft) => (draft.points.length >= 2
        ? { points: draft.points, radius: 30, power: 1, color: '#4c93c4', inner: '#0d1a24' }
        : null),
    },

    bounds(data) {
      const b = bboxOfPoints(data.points)
      const r = data.radius
      return { x: b.x - r, y: b.y - r, w: b.w + r * 2, h: b.h + r * 2 }
    },
    hit: (data, pt) => distToPolyline(pt.x, pt.y, data.points) <= data.radius,
    move(data, dx, dy) { for (const p of data.points) { p[0] += dx; p[1] += dy } },

    handles: (data) => data.points.map(([x, y], i) => ({ id: i, x, y, kind: i === 0 ? 'mouth' : 'node' })),
    moveHandles(data, ids, dx, dy) {
      for (const i of ids) { data.points[i][0] += dx; data.points[i][1] += dy }
    },
    deleteHandles(data, ids) {
      const keep = data.points.filter((_, i) => !ids.includes(i))
      if (keep.length < 2) return false
      data.points = keep
      return true
    },
    addHandle(data, pt) {
      const i = nearestEdgeIndex(pt.x, pt.y, data.points)
      data.points.splice(i + 1, 0, [pt.x, pt.y])
    },

    props: () => [
      { key: 'power', label: 'Suction', type: 'range', min: 0, max: 3, step: 0.1, global: true },
      { key: 'radius', label: 'Mouth diameter', type: 'range', min: 14, max: 60, step: 1 },
      { key: 'color', label: 'Color', type: 'color' },
    ],
  },
})
