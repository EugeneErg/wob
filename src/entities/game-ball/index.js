import { defineEntity } from '../../core/registry.js'
import { clamp } from '../../core/geom.js'

// Игровой шар.
// Глобально: attachable = true только когда шар уже часть конструкции.
// Приватно: min/max связей, радиус притяжения, состояние (свободен / ползёт / вставлен).
// Друг друга игровые шары не замечают: collision.points = false у всех.

const other = (l, p) => (l.a === p ? l.b : l.a)
const len = (l) => Math.hypot(l.a.x - l.b.x, l.a.y - l.b.y) || 1e-9

export default defineEntity({
  type: 'game-ball',
  title: 'Игровой шар',
  z: 20,
  icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="currentColor"/><circle cx="9.7" cy="10.5" r="2" fill="#fff"/><circle cx="14.3" cy="10.5" r="2" fill="#fff"/></svg>',

  defaults: () => ({
    x: 0, y: 0, r: 13,
    minLinks: 2,
    maxLinks: 3,
    range: 165,
    seek: 340,
    color: '#e2704a',
    linkColor: '#f0b48c',
  }),

  spawn(ctx, data) {
    const p = ctx.addPoint({
      x: data.x, y: data.y,
      radius: data.r,
      mass: 1,
      restitution: 0.12,
      smoothness: 0.55,
      collision: { world: true, points: false },
      attachable: false,
    })
    return { p, state: 'free', walk: null, links: [], preview: [], look: { x: 0, y: 1 } }
  },

  update(rt, ctx, dt, data) {
    const p = rt.p
    rt.links = rt.links.filter((l) => !l.removed)
    if (p.y > ctx.bounds.y + ctx.bounds.h + 400) { ctx.emit('ball:lost'); ctx.despawnSelf(); return }
    p.attachable = rt.state === 'built'

    if (rt.state === 'built') {
      if (p.links.length === 0) { rt.state = 'free'; p.pinned = false }
      return
    }
    if (rt.state === 'drag') return

    if (rt.state === 'walk') return walk(rt, ctx, dt, data)

    // --- свободный шар: всегда тянется к конструкции ---
    p.pinned = false
    const target = ctx.nearest(p, (q) => q !== p && q.attachable, data.seek ?? data.range * 2)
    if (!target) { rt.look = { x: 0, y: 1 }; return }

    const dx = target.x - p.x, dy = target.y - p.y
    const d = Math.hypot(dx, dy) || 1e-9
    rt.look = { x: dx / d, y: dy / d }
    ctx.applyAccel(p, (dx / d) * 900, (dy / d) * 220)

    // дошёл — залезаем на конструкцию
    if (d < p.radius + target.radius + 10 && target.links.length) {
      const link = target.links[(Math.random() * target.links.length) | 0]
      rt.state = 'walk'
      rt.walk = { link, from: target, t: 0 }
      p.pinned = true
    }
  },

  shapes(data, rt) {
    const p = rt?.p
    const x = p ? p.x : data.x
    const y = p ? p.y : data.y
    const r = data.r
    const out = []

    // собственные связи рисует тот, кто их построил
    for (const l of rt?.links || []) {
      out.push({ k: 'line', x1: l.a.x, y1: l.a.y, x2: l.b.x, y2: l.b.y, stroke: data.linkColor, sw: 7, cap: 'round' })
      out.push({ k: 'line', x1: l.a.x, y1: l.a.y, x2: l.b.x, y2: l.b.y, stroke: '#a34a26', sw: 2, cap: 'round', opacity: 0.5 })
    }
    for (const q of rt?.preview || []) {
      out.push({ k: 'line', x1: x, y1: y, x2: q.x, y2: q.y, stroke: '#ffd9a0', sw: 3, dash: '8 8', opacity: 0.9 })
    }

    const look = rt?.look || { x: 0, y: 1 }
    const glow = rt?.state === 'walk' || rt?.state === 'drag'
    out.push({ k: 'circle', x, y, r, fill: data.color, stroke: '#7a2f14', sw: 2.5 })
    if (glow) out.push({ k: 'circle', x, y, r: r + 4, fill: 'none', stroke: '#ffd9a0', sw: 2, opacity: 0.55 })
    const ex = r * 0.36, ey = -r * 0.18
    for (const s of [-1, 1]) {
      out.push({ k: 'circle', x: x + s * ex, y: y + ey, r: r * 0.33, fill: '#fff' })
      out.push({ k: 'circle', x: x + s * ex + look.x * r * 0.12, y: y + ey + look.y * r * 0.12, r: r * 0.15, fill: '#20140d' })
    }
    return out
  },

  pointer: {
    hit(rt, ctx, pt, data) {
      if (rt.state === 'built') return false
      return Math.hypot(pt.x - rt.p.x, pt.y - rt.p.y) <= data.r + 12
    },
    down(rt, ctx, pt) {
      rt.state = 'drag'
      rt.walk = null
      rt.p.pinned = true
    },
    move(rt, ctx, pt, data) {
      const p = rt.p
      p.x = pt.x; p.y = pt.y; p.px = pt.x; p.py = pt.y
      rt.preview = candidates(rt, ctx, data)
    },
    up(rt, ctx, pt, data) {
      const p = rt.p
      p.pinned = false
      const cands = candidates(rt, ctx, data)
      rt.preview = []
      if (cands.length >= data.minLinks) {
        rt.links = cands.map((q) => ctx.addLink(p, q, { stiffness: 0.9, width: 7, color: data.linkColor }))
        rt.state = 'built'
      } else {
        rt.state = 'free'
      }
    },
  },

  editor: {
    create: {
      start: () => ({ x: 0, y: 0, ready: false }),
      click(draft, pt) { draft.x = pt.x; draft.y = pt.y; draft.ready = true; return 'done' },
      move(draft, pt) { draft.x = pt.x; draft.y = pt.y },
      shapes: (draft) => [{ k: 'circle', x: draft.x, y: draft.y, r: 13, fill: 'rgba(226,112,74,.5)', stroke: '#e2704a', sw: 2, dash: '4 4' }],
      finish: (draft) => (draft.ready
        ? { x: draft.x, y: draft.y, r: 13, minLinks: 2, maxLinks: 3, range: 165, seek: 340, color: '#e2704a', linkColor: '#f0b48c' }
        : null),
    },

    bounds: (data) => ({ x: data.x - data.r, y: data.y - data.r, w: data.r * 2, h: data.r * 2 }),
    hit: (data, pt) => Math.hypot(pt.x - data.x, pt.y - data.y) <= data.r,
    move(data, dx, dy) { data.x += dx; data.y += dy },

    handles: (data) => [{ id: 0, x: data.x, y: data.y }],
    moveHandles(data, ids, dx, dy) { if (ids.length) { data.x += dx; data.y += dy } },
    deleteHandles: () => false,

    props: () => [
      { key: 'minLinks', label: 'Связей минимум', type: 'number', min: 1, max: 6, step: 1 },
      { key: 'maxLinks', label: 'Связей максимум', type: 'number', min: 1, max: 6, step: 1 },
      { key: 'range', label: 'Дальность связи', type: 'range', min: 60, max: 400, step: 5 },
      { key: 'seek', label: 'Радиус притяжения', type: 'range', min: 100, max: 900, step: 10 },
      { key: 'r', label: 'Радиус', type: 'range', min: 8, max: 30, step: 1 },
      { key: 'color', label: 'Цвет', type: 'color' },
    ],
  },
})

function candidates(rt, ctx, data) {
  const p = rt.p
  return ctx
    .query((q) => q !== p && q.attachable && Math.hypot(q.x - p.x, q.y - p.y) <= data.range)
    .filter((q) => !ctx.isBlocked(p, q))
    .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))
    .slice(0, data.maxLinks)
}

function walk(rt, ctx, dt, data) {
  const p = rt.p
  const w = rt.walk
  if (!w || !w.link || w.link.removed) { rt.state = 'free'; p.pinned = false; return }

  // есть ли всасывание в достижимой части конструкции
  const ahead = other(w.link, w.from)
  const path = ctx.pathFrom(ahead, (q) => q.suction > 0)
  const suck = path ? path[path.length - 1].suction : 0
  const speed = path ? 80 + 150 * clamp(suck, 0, 3) : 55

  w.t += (speed * dt) / len(w.link)
  rt.look = { x: ahead.x - w.from.x, y: ahead.y - w.from.y }
  const nl = Math.hypot(rt.look.x, rt.look.y) || 1
  rt.look.x /= nl; rt.look.y /= nl

  if (w.t >= 1) {
    const node = ahead
    if (node.suction > 0) { ctx.emit('ball:collected'); ctx.despawnSelf(); return }
    w.link = nextLink(ctx, node, w.link)
    w.from = node
    w.t = 0
  }

  // позиция на связи + смещение "вверх" по нормали
  const a = w.from, b = other(w.link, w.from)
  const x = a.x + (b.x - a.x) * w.t
  const y = a.y + (b.y - a.y) * w.t
  let nx = -(b.y - a.y), ny = b.x - a.x
  const n = Math.hypot(nx, ny) || 1
  nx /= n; ny /= n
  const g = ctx.gravity
  if (nx * g.x + ny * g.y > 0) { nx = -nx; ny = -ny }
  const off = data.r * 0.7
  p.x = x + nx * off; p.y = y + ny * off
  p.px = p.x; p.py = p.y
  p.pinned = true
}

function nextLink(ctx, node, curLink) {
  const path = ctx.pathFrom(node, (q) => q.suction > 0)
  if (path && path.length > 1) {
    const want = path[1]
    const l = node.links.find((ln) => other(ln, node) === want)
    if (l) return l
  }
  const opts = node.links.filter((l) => l !== curLink)
  return opts.length ? opts[(Math.random() * opts.length) | 0] : curLink
}
