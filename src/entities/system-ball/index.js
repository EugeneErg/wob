import { defineEntity } from '../../core/registry.js'
import { LAYERS } from '../../core/globals.js'

// Системный шар: опора конструкции. К нему всегда можно лепить связи.
// Приватно: статичный он или физический и с какими системными шарами связан
// (ссылки на соседей своего же типа — ctx.peers()).

export default defineEntity({
  type: 'system-ball',
  title: 'Системный шар',
  z: LAYERS.body,
  icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2.5"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/></svg>',

  defaults: () => ({
    x: 0, y: 0, r: 17,
    static: true,
    links: [],            // id других системных шаров
    color: '#d8cbb0',
    linkColor: '#b9ae95',
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
    return { p, links: new Map() }
  },

  update(rt, ctx, dt, data) {
    const want = data.links || []
    // связь создаёт тот из пары, чей id меньше — иначе получим две
    for (const id of want) {
      if (ctx.id > id) continue
      const cur = rt.links.get(id)
      if (cur && !cur.removed) continue
      const peer = ctx.peer(id)
      if (peer?.rt?.p) rt.links.set(id, ctx.addLink(rt.p, peer.rt.p, { spring: 9000, damping: 0.35 }))
    }
    for (const [id, l] of rt.links) {
      if (!want.includes(id)) { ctx.removeLink(l); rt.links.delete(id) }
    }
  },

  shapes(data, rt, ctx) {
    const x = rt?.p ? rt.p.x : data.x
    const y = rt?.p ? rt.p.y : data.y
    const r = data.r
    const out = []

    // связи между системными шарами рисует тот, у кого id меньше
    for (const id of data.links || []) {
      if (!ctx || ctx.id > id) continue
      const peer = ctx.peer?.(id)
      if (!peer) continue
      const q = peer.rt?.p || peer.data
      out.push({ k: 'line', layer: LAYERS.structure, x1: x, y1: y, x2: q.x, y2: q.y, stroke: data.linkColor, sw: 9, cap: 'round' })
      out.push({ k: 'line', layer: LAYERS.structure, x1: x, y1: y, x2: q.x, y2: q.y, stroke: '#4a4234', sw: 2.5, cap: 'round', opacity: 0.6 })
    }

    out.push({ k: 'circle', x, y, r, fill: data.color, stroke: '#2b2519', sw: 3 })
    out.push({ k: 'circle', x, y, r: r * 0.42, fill: '#2b2519', opacity: data.static ? 1 : 0.25 })
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
      finish: (draft) => (draft.ready
        ? { x: draft.x, y: draft.y, r: 17, static: true, links: [], color: '#d8cbb0', linkColor: '#b9ae95' }
        : null),
    },

    bounds: (data) => ({ x: data.x - data.r, y: data.y - data.r, w: data.r * 2, h: data.r * 2 }),
    hit: (data, pt) => Math.hypot(pt.x - data.x, pt.y - data.y) <= data.r,
    move(data, dx, dy) { data.x += dx; data.y += dy },

    handles: (data) => [{ id: 0, x: data.x, y: data.y }],
    moveHandles(data, ids, dx, dy) { if (ids.length) { data.x += dx; data.y += dy } },
    deleteHandles: () => false,

    // групповое действие: появляется, когда выделено несколько шаров
    bulk: {
      label: 'Связать / разорвать',
      apply(list) {
        const linked = (a, b) => (a.data.links || []).includes(b.id)
        let all = true
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) if (!linked(list[i], list[j])) all = false
        }
        for (const e of list) e.data.links ||= []
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            const a = list[i], b = list[j]
            if (all) {
              a.data.links = a.data.links.filter((id) => id !== b.id)
              b.data.links = b.data.links.filter((id) => id !== a.id)
            } else if (!linked(a, b)) {
              a.data.links.push(b.id)
              b.data.links.push(a.id)
            }
          }
        }
      },
    },

    // при удалении сущности мир зовёт это у остальных того же типа
    forget(data, id) {
      if (data.links?.includes(id)) data.links = data.links.filter((x) => x !== id)
    },

    props: () => [
      { key: 'static', label: 'Статичный', type: 'bool' },
      { key: 'r', label: 'Радиус', type: 'range', min: 8, max: 40, step: 1 },
      { key: 'color', label: 'Цвет', type: 'color' },
    ],
  },
})
