import { defineEntity } from '../../core/registry.js'
import { LAYERS, EVENTS } from '../../core/globals.js'

// Лунка. Не всасывает, как труба: это настоящий стакан в геометрии, куда шар
// должен попасть и остаться. Стенки гасят отскок, ширина подобрана под шар —
// промахнулся или пролетел мимо, значит промахнулся.
//
// По сути кнопка: пока в лунке сидит подходящее тело, она держит сигнал (его
// имя задают в редакторе) и, если велено, засчитывает шаг к цели уровня.

const ARC = 14

// Стакан: прямоугольная плита с выемкой-стаканом ровно под шар
function cup(data) {
  const { x, y, r, depth } = data
  const wall = Math.max(10, r * 0.7)
  const lip = r + wall
  const bottom = y + depth
  const ring = [[x - lip, y]]
  ring.push([x - r, y], [x - r, bottom])
  for (let i = 0; i <= ARC; i++) {
    const a = Math.PI - (Math.PI * i) / ARC
    ring.push([x - Math.cos(a) * r * -1, bottom + Math.sin(a) * r])
  }
  ring.push([x + r, bottom], [x + r, y], [x + lip, y])
  ring.push([x + lip, bottom + r + wall], [x - lip, bottom + r + wall])
  return ring
}

const socket = (data) => ({ x: data.x, y: data.y + data.depth + data.r * 0.25 })
const pos = (ctx, p) => { if (!ctx) return p; const [x, y] = ctx.place(p.x, p.y); return { x, y } }

export default defineEntity({
  type: 'hole',
  title: 'Hole',
  z: LAYERS.midground + 2,
  icon: '<svg viewBox="0 0 24 24"><path d="M4 6v6a8 8 0 0 0 16 0V6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="11" r="3.2" fill="currentColor"/></svg>',

  defaults: () => ({
    x: 0, y: 0,
    r: 19,          // радиус стакана: под шар тютелька в тютельку
    depth: 26,
    counts: true,   // засчитывать в цель уровня
    signal: '',     // имя сигнала на шине
    color: '#4a5560',
    glow: '#8fb36a',
  }),

  spawn(ctx, data) {
    const c = ctx.addCollider({
      points: ctx.placePoints(cup(data)),
      smoothness: 0.12,     // шершавые стенки — шар не выкатывается
      restitution: 0.02,    // и не отскакивает
    })
    return { c, taken: null, reported: false }
  },

  update(rt, ctx, dt, data) {
    const s = rt.socket || (rt.socket = pos(ctx, socket(data)))
    const hold = ctx.nearest(s, (p) => {
      if (!p.collision.world) return false
      // тютелька в тютельку: чужой размер в лунку не считается
      if (p.radius < data.r * 0.55 || p.radius > data.r * 1.12) return false
      const v = Math.hypot(p.vx, p.vy)
      return v < 60
    }, data.r * 0.7)

    if (!!hold === rt.reported) { rt.taken = hold; return }
    rt.taken = hold
    rt.reported = !!hold
    if (data.signal) ctx.setSignal(data.signal, rt.reported)
    if (data.counts) ctx.emit(EVENTS.progress, { delta: rt.reported ? 1 : -1 })
  },

  shapes(data, rt, ctx) {
    const s = rt?.socket || pos(ctx, socket(data))
    const on = !!rt?.reported
    const out = [
      { k: 'poly', pts: rt?.c ? rt.c.points : (ctx ? ctx.placePoints(cup(data)) : cup(data)), closed: true, fill: data.color, stroke: '#28323a', sw: 3, join: 'round' },
      { k: 'circle', x: s.x, y: s.y, r: data.r * 0.9, fill: 'none', stroke: on ? data.glow : '#28323a', sw: 2.5, opacity: on ? 0.9 : 0.55 },
    ]
    if (on) out.push({ k: 'circle', x: s.x, y: s.y, r: data.r * 1.5, fill: 'none', stroke: data.glow, sw: 2, opacity: 0.4, class: 'pulse' })
    return out
  },

  editor: {
    create: {
      start: () => ({ x: 0, y: 0, ready: false }),
      click(d, pt) { d.x = pt.x; d.y = pt.y; d.ready = true; return 'done' },
      move(d, pt) { d.x = pt.x; d.y = pt.y },
      shapes: (d) => [{ k: 'poly', pts: cup({ ...d, r: 19, depth: 26 }), closed: true, fill: 'rgba(74,85,96,.5)', stroke: '#8fb36a', sw: 2, dash: '5 5' }],
      finish: (d) => (d.ready
        ? { x: d.x, y: d.y, r: 19, depth: 26, counts: true, signal: '', color: '#4a5560', glow: '#8fb36a' }
        : null),
    },

    bounds: (d) => {
      const lip = d.r + Math.max(10, d.r * 0.7)
      return { x: d.x - lip, y: d.y, w: lip * 2, h: d.depth + d.r * 2 + 10 }
    },
    hit: (d, pt) => Math.abs(pt.x - d.x) <= d.r * 2 && pt.y >= d.y && pt.y <= d.y + d.depth + d.r * 2,
    move(d, dx, dy) { d.x += dx; d.y += dy },

    handles: (d) => [{ id: 0, x: d.x, y: d.y }],
    moveHandles(d, ids, dx, dy) { if (ids.length) { d.x += dx; d.y += dy } },
    deleteHandles: () => false,

    props: () => [
      { key: 'r', label: 'Fits a ball of radius', type: 'range', min: 8, max: 60, step: 1 },
      { key: 'depth', label: 'Depth', type: 'range', min: 4, max: 120, step: 2 },
      { key: 'counts', label: 'Counts toward the level goal', type: 'bool' },
      { key: 'signal', label: 'Signal name', type: 'text' },
      { key: 'color', label: 'Color', type: 'color' },
    ],
  },
})
