import { defineEntity } from '../../core/registry.js'
import { LAYERS } from '../../core/globals.js'

// Глобальный ветер. Задаются два вектора; ветер не переключается рывком, а
// перетекает из одного в другой и обратно за заданное время. Короткий период —
// порывы, длинный — плавная смена погоды, одинаковые векторы — ровный поток.
//
// Действует не «толчком», а сопротивлением воздуха: сила тянет тело к скорости
// воздуха и растёт с его размером. Поэтому лёгкое и крупное сдувает, а тяжёлое
// почти стоит — без единого условия на тип тела.

const STREAKS = 26

export default defineEntity({
  type: 'wind',
  title: 'Ветер',
  z: LAYERS.overlay - 5,
  icon: '<svg viewBox="0 0 24 24"><path d="M3 8h11a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M3 18h9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',

  defaults: () => ({
    x: 100, y: 100,
    ax: 260, ay: 0,      // первый вектор, px/с
    bx: -120, by: -60,   // второй вектор
    period: 6,           // секунд на полный перелив туда и обратно
    force: 0.55,         // сопротивление воздуха
    show: true,
    color: '#9fc6d8',
  }),

  spawn(ctx, data) {
    const b = ctx.bounds
    const streaks = []
    for (let i = 0; i < STREAKS; i++) {
      streaks.push({ x: b.x + ctx.rng.next() * b.w, y: b.y + ctx.rng.next() * b.h, len: ctx.rng.range(20, 60) })
    }
    return { streaks, air: { x: 0, y: 0 } }
  },

  update(rt, ctx, dt, data) {
    // перелив между векторами: t гуляет от 0 до 1 и обратно
    const t = 0.5 - 0.5 * Math.cos((ctx.time / Math.max(0.2, data.period)) * Math.PI * 2)
    const air = {
      x: data.ax + (data.bx - data.ax) * t,
      y: data.ay + (data.by - data.ay) * t,
    }
    rt.air = air

    for (const p of ctx.points) {
      if (p.pinned || !p.collision.world) continue
      const vx = p.vx, vy = p.vy
      const k = (data.force * p.radius) / (13 * p.mass)
      ctx.applyAccel(p, (air.x - vx) * k, (air.y - vy) * k)
    }

    // полоски, чтобы ветер было видно
    const b = ctx.bounds
    for (const s of rt.streaks) {
      s.x += air.x * dt
      s.y += air.y * dt
      if (s.x < b.x - 60) s.x = b.x + b.w + 40
      if (s.x > b.x + b.w + 60) s.x = b.x - 40
      if (s.y < b.y - 60) s.y = b.y + b.h + 40
      if (s.y > b.y + b.h + 60) s.y = b.y - 40
    }
  },

  shapes(data, rt, ctx) {
    const out = []
    const air = rt?.air || { x: data.ax, y: data.ay }
    const speed = Math.hypot(air.x, air.y) || 1
    if (data.show && rt?.streaks) {
      const nx = air.x / speed, ny = air.y / speed
      const alpha = Math.min(0.5, speed / 700)
      for (const s of rt.streaks) {
        out.push({
          k: 'line', layer: LAYERS.overlay - 5,
          x1: s.x, y1: s.y, x2: s.x - nx * s.len, y2: s.y - ny * s.len,
          stroke: data.color, sw: 2, cap: 'round', opacity: alpha,
        })
      }
    }
    // значок в редакторе и указатель текущего направления
    const [x, y] = ctx ? ctx.place(data.x, data.y) : [data.x, data.y]
    out.push({ k: 'circle', x, y, r: 22, fill: 'none', stroke: data.color, sw: 2, opacity: 0.5, dash: '4 5' })
    out.push({
      k: 'line', x1: x, y1: y,
      x2: x + (air.x / speed) * 20, y2: y + (air.y / speed) * 20,
      stroke: data.color, sw: 3, cap: 'round',
    })
    return out
  },

  editor: {
    create: {
      start: () => ({ x: 0, y: 0, ready: false }),
      click(d, pt) { d.x = pt.x; d.y = pt.y; d.ready = true; return 'done' },
      move(d, pt) { d.x = pt.x; d.y = pt.y },
      shapes: (d) => [{ k: 'circle', x: d.x, y: d.y, r: 22, fill: 'none', stroke: '#9fc6d8', sw: 2, dash: '4 4' }],
      finish: (d) => (d.ready
        ? { x: d.x, y: d.y, ax: 260, ay: 0, bx: -120, by: -60, period: 6, force: 0.55, show: true, color: '#9fc6d8' }
        : null),
    },

    bounds: (d) => ({ x: d.x - 22, y: d.y - 22, w: 44, h: 44 }),
    hit: (d, pt) => Math.hypot(pt.x - d.x, pt.y - d.y) <= 22,
    move(d, dx, dy) { d.x += dx; d.y += dy },
    handles: (d) => [{ id: 0, x: d.x, y: d.y }],
    moveHandles(d, ids, dx, dy) { if (ids.length) { d.x += dx; d.y += dy } },
    deleteHandles: () => false,

    props: () => [
      { key: 'ax', label: 'Вектор A, по X', type: 'range', min: -600, max: 600, step: 10 },
      { key: 'ay', label: 'Вектор A, по Y', type: 'range', min: -600, max: 600, step: 10 },
      { key: 'bx', label: 'Вектор B, по X', type: 'range', min: -600, max: 600, step: 10 },
      { key: 'by', label: 'Вектор B, по Y', type: 'range', min: -600, max: 600, step: 10 },
      { key: 'period', label: 'Секунд на перелив', type: 'range', min: 0.4, max: 30, step: 0.2 },
      { key: 'force', label: 'Сопротивление воздуха', type: 'range', min: 0, max: 3, step: 0.05 },
      { key: 'show', label: 'Показывать полоски', type: 'bool' },
      { key: 'color', label: 'Цвет', type: 'color' },
    ],
  },
})
