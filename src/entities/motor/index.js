import { defineEntity } from '../../core/registry.js'
import { LAYERS } from '../../core/globals.js'
import { clamp } from '../../core/geom.js'

// Двигатель — ось, к которой привязывают что угодно: объект, рельеф, песок.
// Привязка делается обычным родительством: двигатель становится родителем.
//
// Два характера:
//   жёсткий — двигатель крутит собственную рамку, а мир возит за ней ребёнка.
//             Остановить нечем: это кинематика, а не сила.
//   упругий — двигатель заводит жёсткое тело, ребёнок в него врастает (ось при
//             этом тяжёлая и закреплённая, то есть получается шарнир), и мотор
//             раскручивает тело ограниченным моментом. Преграда его останавливает.
//             Скорость 0 — просто шарнир: вращается только от внешних сил.

const TAU = Math.PI * 2

export default defineEntity({
  type: 'motor',
  title: 'Motor',
  z: LAYERS.midground + 1,
  icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M12 21a9 9 0 0 1-9-9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',

  defaults: () => ({
    x: 0, y: 0,
    r: 26,
    hard: true,      // жёсткий: ничем не остановить
    speed: 0.4,      // оборотов в секунду, знак задаёт направление
    torque: 60,      // предел углового ускорения у упругого, рад/с²
    color: '#c58a4b',
  }),

  spawn(ctx, data) {
    const [ax0, ay0] = ctx.place(data.x, data.y)
    const axis = ctx.addPoint({
      x: ax0, y: ay0,
      radius: 4,
      mass: data.hard ? 1 : 500,   // тяжёлая ось держит центр шарнира на месте
      pinned: true,
      attachable: false,
      collision: { world: false, points: false },
    })
    const rt = { axis, angle: 0, spin: 0 }
    if (data.hard) {
      // вторая точка нужна, чтобы у рамки был поворот, а не только сдвиг
      rt.mark = ctx.addPoint({
        x: ax0 + data.r, y: ay0,
        radius: 2, mass: 1, pinned: true,
        attachable: false, collision: { world: false, points: false },
      })
    } else {
      rt.body = ctx.addBody({ points: [axis], stiffness: 1 })
    }
    return rt
  },

  update(rt, ctx, dt, data) {
    const target = (data.speed || 0) * TAU

    if (data.hard) {
      rt.angle += target * dt
      rt.spin = target
      const [cx, cy] = ctx.place(data.x, data.y)
      const a = rt.angle + ctx.angle
      const ax = rt.axis
      ctx.placeAt(ax, cx, cy)
      const m = rt.mark
      if (m) {
        const nx = cx + Math.cos(a) * data.r
        const ny = cy + Math.sin(a) * data.r
        const vx = (nx - m.x) / dt, vy = (ny - m.y) / dt
        ctx.placeAt(m, nx, ny)
        ctx.setVelocity(m, vx, vy)
      }
      return
    }

    // упругий: считаем, как быстро сборка крутится сейчас, и подталкиваем
    const body = rt.body
    if (!body) return
    const ax = rt.axis.x, ay = rt.axis.y
    let num = 0, den = 0
    for (const p of body.verts) {
      if (p.pinned) continue
      const rx = p.x - ax, ry = p.y - ay
      num += rx * p.vy - ry * p.vx
      den += rx * rx + ry * ry
    }
    const omega = den ? num / den : 0   // рад/с
    rt.spin = omega
    rt.angle += omega * dt
    if (!target) return                          // мотор выключен — чистый шарнир

    const alpha = clamp((target - omega) * 8, -data.torque, data.torque)
    for (const p of body.verts) {
      if (p.pinned) continue
      const rx = p.x - ax, ry = p.y - ay
      ctx.applyAccel(p, -ry * alpha, rx * alpha)
    }
  },

  shapes(data, rt, ctx) {
    const [x, y] = ctx ? ctx.place(data.x, data.y) : [data.x, data.y]
    const r = data.r
    const a = (rt?.angle ?? 0) + (ctx?.angle ?? 0)
    const out = [
      { k: 'circle', x, y, r, fill: 'none', stroke: data.color, sw: 3, opacity: data.hard ? 0.9 : 0.5, dash: data.hard ? null : '5 6' },
      { k: 'circle', x, y, r: r * 0.3, fill: data.color, stroke: '#2b2519', sw: 2 },
    ]
    for (let i = 0; i < 3; i++) {
      const t = a + (TAU / 3) * i
      out.push({
        k: 'line',
        x1: x + Math.cos(t) * r * 0.3, y1: y + Math.sin(t) * r * 0.3,
        x2: x + Math.cos(t) * r * 0.92, y2: y + Math.sin(t) * r * 0.92,
        stroke: data.color, sw: 4, cap: 'round',
      })
    }
    if (!data.speed) {
      out.push({ k: 'circle', x, y, r: r * 0.55, fill: 'none', stroke: data.color, sw: 1.5, opacity: 0.5, dash: '3 4' })
    }
    return out
  },

  editor: {
    create: {
      start: () => ({ x: 0, y: 0, ready: false }),
      click(draft, pt) { draft.x = pt.x; draft.y = pt.y; draft.ready = true; return 'done' },
      move(draft, pt) { draft.x = pt.x; draft.y = pt.y },
      shapes: (d) => [{ k: 'circle', x: d.x, y: d.y, r: 26, fill: 'none', stroke: '#c58a4b', sw: 2, dash: '4 4' }],
      finish: (d) => (d.ready
        ? { x: d.x, y: d.y, r: 26, hard: true, speed: 0.4, torque: 60, color: '#c58a4b' }
        : null),
    },

    bounds: (d) => ({ x: d.x - d.r, y: d.y - d.r, w: d.r * 2, h: d.r * 2 }),
    hit: (d, pt) => Math.hypot(pt.x - d.x, pt.y - d.y) <= d.r,
    move(d, dx, dy) { d.x += dx; d.y += dy },

    handles: (d) => [{ id: 0, x: d.x, y: d.y }],
    moveHandles(d, ids, dx, dy) { if (ids.length) { d.x += dx; d.y += dy } },
    deleteHandles: () => false,

    props: () => [
      { key: 'hard', label: 'Rigid (nothing can stop it)', type: 'bool' },
      { key: 'speed', label: 'Speed, rev/s (0 = free hinge)', type: 'range', min: -2, max: 2, step: 0.05 },
      { key: 'torque', label: 'Torque limit', type: 'range', min: 5, max: 300, step: 5 },
      { key: 'r', label: 'Radius', type: 'range', min: 10, max: 90, step: 1 },
      { key: 'color', label: 'Color', type: 'color' },
    ],
  },
})
