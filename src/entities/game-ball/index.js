import { defineEntity } from '../../core/registry.js'
import { clamp } from '../../core/geom.js'
import { LAYERS } from '../../core/globals.js'

// Игровой шар.
// Глобально: attachable = true только когда шар уже часть конструкции.
// Приватно: min/max связей, дальность, состояние.
//
// Состояния:
//   free  — падает, ползёт и прыгает к ближайшей конструкции
//   walk  — идёт по связям, при всасывании — кратчайшим путём к нему
//   drag  — свободный шар в руке игрока
//   pull  — шар вынимают из конструкции: настоящий остаётся на месте и держит
//           конструкцию, но не виден; в руке — копия, которая ни на что не влияет
//   built — часть конструкции

const other = (l, p) => (l.a === p ? l.b : l.a)
const llen = (l) => Math.hypot(l.a.x - l.b.x, l.a.y - l.b.y) || 1e-9

export default defineEntity({
  type: 'game-ball',
  title: 'Игровой шар',
  z: LAYERS.body,
  icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="currentColor"/><circle cx="9.7" cy="10.5" r="2" fill="#fff"/><circle cx="14.3" cy="10.5" r="2" fill="#fff"/></svg>',

  defaults: () => ({
    x: 0, y: 0, r: 13,
    mass: 1,
    minLinks: 2,
    maxLinks: 3,
    range: 165,
    jump: 470,
    color: '#e2704a',
    linkColor: '#f0b48c',
  }),

  spawn(ctx, data) {
    const p = ctx.addPoint({
      x: data.x, y: data.y,
      radius: data.r,
      mass: data.mass ?? 1,
      restitution: 0.12,
      smoothness: 0.55,
      collision: { world: true, points: false },
      attachable: false,
    })
    return { p, state: 'free', walk: null, links: [], preview: [], ghost: null, cd: 0, look: { x: 0, y: 1 } }
  },

  update(rt, ctx, dt, data) {
    const p = rt.p
    rt.links = rt.links.filter((l) => !l.removed)
    if (p.y > ctx.bounds.y + ctx.bounds.h + 400) { ctx.emit('ball:lost'); ctx.despawnSelf(); return }

    p.attachable = rt.state === 'built' || rt.state === 'pull'
    rt.cd = Math.max(0, rt.cd - dt)

    // шар вынимают: он всё ещё держит конструкцию, но его не видно
    if (rt.state === 'pull') {
      for (const l of p.links) l.visible = false
      return
    }
    if (rt.state === 'drag') return
    if (rt.state === 'built') {
      if (p.links.length === 0) { rt.state = 'free'; p.pinned = false }
      return
    }
    if (rt.state === 'walk') return walk(rt, ctx, dt, data)

    // --- свободный шар: всегда идёт к ближайшей конструкции ---
    p.pinned = false
    const target = ctx.nearest(p, (q) => q !== p && q.attachable)
    if (!target) { rt.look = { x: 0, y: 1 }; return }

    const dx = target.x - p.x, dy = target.y - p.y
    const d = Math.hypot(dx, dy) || 1e-9
    rt.look = { x: dx / d, y: dy / d }
    // пропорциональное подруливание, чтобы не проскакивать цель насквозь
    const grounded = Math.abs(p.y - p.py) < 1
    const vx = (p.x - p.px) * 120
    const air = grounded ? 1 : 0.25
    const want = clamp(dx * 7, -900, 900)
    ctx.applyAccel(p, Math.abs(vx) > 220 && Math.sign(vx) === Math.sign(want) ? 0 : want * air, (dy / d) * 150 * air)

    // конструкция прямо над головой — подпрыгиваем
    if (dy < -(p.radius + target.radius + 40) && Math.abs(dx) < 150 && grounded && rt.cd === 0) {
      p.py = p.y + (data.jump ?? 470) / 120
      rt.cd = 0.7 + Math.random() * 0.5
    }

    if (d < p.radius + target.radius + 10 && target.links.length) {
      const link = target.links[(Math.random() * target.links.length) | 0]
      rt.state = 'walk'
      rt.walk = { link, from: target, t: 0 }
      p.pinned = true
    }
  },

  shapes(data, rt) {
    const p = rt?.p
    const st = rt?.state
    const r = data.r
    const out = []

    // связи рисует тот, кто их построил; невидимые пропускаем
    for (const l of rt?.links || []) {
      if (l.visible === false) continue
      const strain = clamp(l.tension / (l.breakForce || 1), 0, 1)
      out.push({
        k: 'line', layer: LAYERS.structure,
        x1: l.a.x, y1: l.a.y, x2: l.b.x, y2: l.b.y,
        stroke: data.linkColor, sw: 8 - strain * 4, cap: 'round',
      })
      out.push({
        k: 'line', layer: LAYERS.structure,
        x1: l.a.x, y1: l.a.y, x2: l.b.x, y2: l.b.y,
        stroke: strain > 0.55 ? '#ffd9a0' : '#a34a26', sw: 2, cap: 'round', opacity: 0.5 + strain * 0.5,
      })
    }

    // тело: настоящее или копия в руке
    const ghost = (st === 'pull' || st === 'drag') && rt.ghost
    if (st === 'pull' && !ghost) return out
    const x = ghost ? rt.ghost.x : p ? p.x : data.x
    const y = ghost ? rt.ghost.y : p ? p.y : data.y
    const ok = !ghost || rt.preview.length >= data.minLinks

    for (const q of rt?.preview || []) {
      out.push({ k: 'line', layer: LAYERS.overlay, x1: x, y1: y, x2: q.x, y2: q.y, stroke: '#ffd9a0', sw: 3, dash: '8 8', opacity: 0.9 })
    }

    const layer = ghost ? LAYERS.overlay : undefined
    if (st === 'walk' || ghost) {
      out.push({ k: 'circle', layer, x, y, r: r + 4, fill: 'none', stroke: ok ? '#ffd9a0' : '#c0563a', sw: 2, opacity: 0.55 })
    }
    out.push({ k: 'circle', layer, x, y, r, fill: data.color, stroke: '#7a2f14', sw: 2.5, opacity: ghost && !ok ? 0.65 : 1 })
    const look = rt?.look || { x: 0, y: 1 }
    const ex = r * 0.36, ey = -r * 0.18
    for (const s of [-1, 1]) {
      out.push({ k: 'circle', layer, x: x + s * ex, y: y + ey, r: r * 0.33, fill: '#fff' })
      out.push({ k: 'circle', layer, x: x + s * ex + look.x * r * 0.12, y: y + ey + look.y * r * 0.12, r: r * 0.15, fill: '#20140d' })
    }
    return out
  },

  pointer: {
    hit(rt, ctx, pt, data) {
      const at = (rt.state === 'pull' || rt.state === 'drag') && rt.ghost ? rt.ghost : rt.p
      return Math.hypot(pt.x - at.x, pt.y - at.y) <= data.r + 12
    },
    down(rt, ctx, pt, data) {
      rt.ghost = { x: rt.p.x, y: rt.p.y }
      if (rt.state === 'built') {
        rt.state = 'pull'                       // настоящий шар остаётся в конструкции
        for (const l of rt.p.links) l.visible = false
      } else {
        rt.state = 'drag'
        rt.walk = null
        rt.p.pinned = true
      }
      rt.preview = candidatesAt(rt, ctx, rt.ghost, data)
    },
    move(rt, ctx, pt, data) {
      rt.ghost = { x: pt.x, y: pt.y }
      rt.preview = candidatesAt(rt, ctx, rt.ghost, data)
      if (rt.state === 'drag') {
        const p = rt.p
        p.x = pt.x; p.y = pt.y; p.px = pt.x; p.py = pt.y
      }
    },
    up(rt, ctx, pt, data) {
      const p = rt.p
      const at = rt.ghost || pt
      const cands = candidatesAt(rt, ctx, at, data)
      rt.preview = []
      rt.ghost = null

      if (rt.state === 'pull') {
        for (const l of [...p.links]) ctx.removeLink(l) // только теперь покидает конструкцию
        rt.links = []
      }
      // телепорт в точку, где отпустили
      p.x = at.x; p.y = at.y; p.px = at.x; p.py = at.y
      p.pinned = false

      if (cands.length >= data.minLinks) {
        rt.links = cands.map((q) => ctx.addLink(p, q, {
          spring: 1600,
          damping: 0.25,
          breakForce: 26000,
          width: 8,
          color: data.linkColor,
        }))
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
        ? { x: draft.x, y: draft.y, r: 13, mass: 1, minLinks: 2, maxLinks: 3, range: 165, jump: 470, color: '#e2704a', linkColor: '#f0b48c' }
        : null),
    },

    bounds: (data) => ({ x: data.x - data.r, y: data.y - data.r, w: data.r * 2, h: data.r * 2 }),
    hit: (data, pt) => Math.hypot(pt.x - data.x, pt.y - data.y) <= data.r,
    move(data, dx, dy) { data.x += dx; data.y += dy },

    handles: (data) => [{ id: 0, x: data.x, y: data.y }],
    moveHandles(data, ids, dx, dy) { if (ids.length) { data.x += dx; data.y += dy } },
    deleteHandles: () => false,

    props: () => [
      { key: 'mass', label: 'Вес', type: 'range', min: 0.2, max: 6, step: 0.1, global: true },
      { key: 'minLinks', label: 'Связей минимум', type: 'number', min: 1, max: 6, step: 1 },
      { key: 'maxLinks', label: 'Связей максимум', type: 'number', min: 1, max: 6, step: 1 },
      { key: 'range', label: 'Дальность связи', type: 'range', min: 60, max: 400, step: 5 },
      { key: 'jump', label: 'Прыжок', type: 'range', min: 0, max: 900, step: 10 },
      { key: 'r', label: 'Радиус', type: 'range', min: 8, max: 30, step: 1 },
      { key: 'color', label: 'Цвет', type: 'color' },
    ],
  },
})

// Кандидаты на связь из точки at — только глобальные свойства чужих тел
function candidatesAt(rt, ctx, at, data) {
  const p = rt.p
  return ctx
    .query((q) => q !== p && q.attachable && Math.hypot(q.x - at.x, q.y - at.y) <= data.range)
    .filter((q) => !ctx.isBlocked(at, q))
    .sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y))
    .slice(0, data.maxLinks)
}

function walk(rt, ctx, dt, data) {
  const p = rt.p
  const w = rt.walk
  if (!w || !w.link || w.link.removed) { rt.state = 'free'; p.pinned = false; return }

  const ahead = other(w.link, w.from)
  const path = ctx.pathFrom(ahead, (q) => q.suction > 0)
  const suck = path ? path[path.length - 1].suction : 0
  const speed = path ? 80 + 150 * clamp(suck, 0, 3) : 55

  w.t += (speed * dt) / llen(w.link)
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
