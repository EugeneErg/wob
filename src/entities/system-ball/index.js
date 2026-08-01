import { defineEntity } from '../../core/registry.js'

// Системный шар: опора конструкции. К нему всегда можно лепить связи.
// Приватное свойство сущности — статичный он или физический.

export default defineEntity({
  type: 'system-ball',
  title: 'Системный шар',
  z: 10,
  icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2.5"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/></svg>',

  defaults: () => ({
    x: 0, y: 0, r: 17,
    static: true,
    color: '#d8cbb0',
  }),

  spawn(ctx, data) {
    const p = ctx.addPoint({
      x: data.x, y: data.y,
      radius: data.r,
      mass: 3,
      pinned: data.static,
      restitution: 0.15,
      smoothness: 0.4,
      collision: { world: true, points: true },
      attachable: true, // всегда
    })
    return { p }
  },

  shapes(data, rt) {
    const x = rt?.p ? rt.p.x : data.x
    const y = rt?.p ? rt.p.y : data.y
    const r = data.r
    const out = [
      { k: 'circle', x, y, r, fill: data.color, stroke: '#2b2519', sw: 3 },
      { k: 'circle', x, y, r: r * 0.42, fill: '#2b2519', opacity: data.static ? 1 : 0.25 },
    ]
    if (data.static) {
      for (let i = 0; i < 4; i++) {
        const a = (Math.PI / 2) * i + Math.PI / 4
        out.push({
          k: 'line',
          x1: x + Math.cos(a) * r * 0.62, y1: y + Math.sin(a) * r * 0.62,
          x2: x + Math.cos(a) * r * 0.95, y2: y + Math.sin(a) * r * 0.95,
          stroke: '#2b2519', sw: 3, cap: 'round',
        })
      }
    }
    return out
  },

  editor: {
    create: {
      start: () => ({ x: 0, y: 0, ready: false }),
      click(draft, pt) { draft.x = pt.x; draft.y = pt.y; draft.ready = true; return 'done' },
      move(draft, pt) { draft.x = pt.x; draft.y = pt.y },
      shapes: (draft) => [{ k: 'circle', x: draft.x, y: draft.y, r: 17, fill: 'rgba(216,203,176,.5)', stroke: '#d8cbb0', sw: 2, dash: '4 4' }],
      finish: (draft) => (draft.ready ? { x: draft.x, y: draft.y, r: 17, static: true, color: '#d8cbb0' } : null),
    },

    bounds: (data) => ({ x: data.x - data.r, y: data.y - data.r, w: data.r * 2, h: data.r * 2 }),
    hit: (data, pt) => Math.hypot(pt.x - data.x, pt.y - data.y) <= data.r,
    move(data, dx, dy) { data.x += dx; data.y += dy },

    handles: (data) => [{ id: 0, x: data.x, y: data.y }],
    moveHandles(data, ids, dx, dy) { if (ids.length) { data.x += dx; data.y += dy } },
    deleteHandles: () => false, // удалить вершину = удалить шар

    props: () => [
      { key: 'static', label: 'Статичный', type: 'bool' },
      { key: 'r', label: 'Радиус', type: 'range', min: 8, max: 40, step: 1 },
      { key: 'color', label: 'Цвет', type: 'color' },
    ],
  },
})
