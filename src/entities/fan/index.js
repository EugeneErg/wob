import { defineEntity } from '../../core/registry.js'
import { LAYERS } from '../../core/globals.js'
import { createField, markSolids, inject, step, sample } from './fluid.js'

// Вентилятор. Поле течения одно на всех: первый по id вентилятор его заводит и
// считает, остальные просто вливают в него свою струю через ctx.peers().
// Отсюда всё требуемое выходит само, без единого условия:
//   три вентилятора рядом дуют сильнее — вливают в одно поле;
//   в узком месте поток быстрее — проекция сохраняет расход;
//   преграда разворачивает струю — твёрдые клетки помечены в сетке.

const RAD = Math.PI / 180

export default defineEntity({
  type: 'fan',
  title: 'Вентилятор',
  z: LAYERS.midground + 1,
  icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 10c0-4 2-6 5-5s1 5-5 5m0 4c0 4-2 6-5 5s-1-5 5-5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',

  defaults: () => ({
    x: 0, y: 0,
    angle: -90,     // куда дует, градусы
    power: 520,     // скорость воздуха на срезе, px/с
    nozzle: 46,     // радиус горловины
    cell: 26,       // размер клетки сетки
    push: 6,        // сопротивление воздуха для тел
    show: true,
    color: '#7fb6cc',
  }),

  spawn(ctx, data) {
    return { air: null, spin: 0 }
  },

  update(rt, ctx, dt, data) {
    rt.spin += (data.power / 260) * dt

    // Воздух — общая среда, а не имущество вентилятора. Каждый просто вливает
    // в него свою струю; кто первым дотянулся в этом кадре, тот и продвигает
    // решатель на шаг. Порядок и число вентиляторов ни на что не влияют,
    // и удаление любого из них ничего не ломает.
    const b = ctx.bounds
    const air = ctx.shared('air', () => ({
      field: createField(b.w, b.h, data.cell),
      frame: -1, acc: 0, marks: 0, draw: -1,
    }))
    rt.air = air
    const f = air.field

    if (air.frame !== ctx.frame) {
      air.frame = ctx.frame
      air.acc += dt
      if (air.marks % 30 === 0) markSolids(f, (x, y) => ctx.solidAt(x, y))
      air.marks++

      // течение считаем 30 раз в секунду: вдвое дешевле, на глаз не отличить
      if (air.acc >= 1 / 30) {
        step(f, air.acc, { iters: 26, damping: 0.99 })
        air.acc = 0
      }

      // сопротивление воздуха телам — тоже один раз за кадр
      for (const p of ctx.points) {
        if (p.pinned || !p.collision.world) continue
        const a = sample(f, p.x, p.y)
        const vx = (p.x - p.px) * 120, vy = (p.y - p.py) * 120
        const k = (data.push * p.radius) / (13 * p.mass)
        ctx.applyAccel(p, (a.x - vx) * k, (a.y - vy) * k)
      }
    }

    // а струю вливает каждый, за себя — в своих координатах
    const ang = (data.angle || 0) * RAD + ctx.angle
    const [fx, fy] = ctx.place(data.x, data.y)
    inject(f, fx, fy, Math.cos(ang), Math.sin(ang), data.nozzle, data.power * 6 * dt, 1)
  },

  shapes(data, rt, ctx) {
    const out = []
    // поток общий, поэтому рисует его тот, кто первым дошёл до отрисовки в кадре
    const air = rt?.air
    const f = air && air.draw !== air.frame ? air.field : null
    if (f && data.show) {
      air.draw = air.frame
      const stepCell = 2
      for (let j = 0; j < f.ny; j += stepCell) {
        for (let i = 0; i < f.nx; i += stepCell) {
          const k = i + j * f.nx
          if (f.solid[k]) continue
          const sx = f.u[k], sy = f.v[k]
          const sp = Math.hypot(sx, sy)
          if (sp < 30) continue
          const cx = (i + 0.5) * f.cell, cy = (j + 0.5) * f.cell
          const len = Math.min(f.cell * 1.8, sp * 0.05)
          out.push({
            k: 'line', layer: LAYERS.midground,
            x1: cx, y1: cy, x2: cx + (sx / sp) * len, y2: cy + (sy / sp) * len,
            stroke: data.color, sw: 2, cap: 'round',
            opacity: Math.min(0.55, 0.12 + sp / 900),
          })
        }
      }
    }

    // корпус
    const a = (data.angle || 0) * RAD + (ctx?.angle ?? 0)
    const nx = Math.cos(a), ny = Math.sin(a)
    const tx = -ny, ty = nx
    const [x, y] = ctx ? ctx.place(data.x, data.y) : [data.x, data.y]
    const r = data.nozzle
    out.push({
      k: 'poly', closed: true,
      pts: [
        [x + tx * r - nx * r * 0.5, y + ty * r - ny * r * 0.5],
        [x + tx * r * 0.8 + nx * r * 0.2, y + ty * r * 0.8 + ny * r * 0.2],
        [x - tx * r * 0.8 + nx * r * 0.2, y - ty * r * 0.8 + ny * r * 0.2],
        [x - tx * r - nx * r * 0.5, y - ty * r - ny * r * 0.5],
      ],
      fill: '#2a3740', stroke: data.color, sw: 3, join: 'round',
    })
    for (let i = 0; i < 4; i++) {
      const t = rt ? rt.spin + (Math.PI / 2) * i : (Math.PI / 2) * i
      const s = Math.cos(t)
      out.push({
        k: 'line',
        x1: x - tx * r * 0.75 * s - nx * r * 0.15, y1: y - ty * r * 0.75 * s - ny * r * 0.15,
        x2: x + tx * r * 0.75 * s - nx * r * 0.15, y2: y + ty * r * 0.75 * s - ny * r * 0.15,
        stroke: data.color, sw: 3, cap: 'round', opacity: 0.8,
      })
    }
    return out
  },

  editor: {
    create: {
      start: () => ({ x: 0, y: 0, ready: false }),
      click(d, pt) { d.x = pt.x; d.y = pt.y; d.ready = true; return 'done' },
      move(d, pt) { d.x = pt.x; d.y = pt.y },
      shapes: (d) => [{ k: 'circle', x: d.x, y: d.y, r: 46, fill: 'none', stroke: '#7fb6cc', sw: 2, dash: '5 5' }],
      finish: (d) => (d.ready
        ? { x: d.x, y: d.y, angle: -90, power: 520, nozzle: 46, cell: 26, push: 6, show: true, color: '#7fb6cc' }
        : null),
    },

    bounds: (d) => ({ x: d.x - d.nozzle, y: d.y - d.nozzle, w: d.nozzle * 2, h: d.nozzle * 2 }),
    hit: (d, pt) => Math.hypot(pt.x - d.x, pt.y - d.y) <= d.nozzle,
    move(d, dx, dy) { d.x += dx; d.y += dy },
    handles: (d) => [{ id: 0, x: d.x, y: d.y }],
    moveHandles(d, ids, dx, dy) { if (ids.length) { d.x += dx; d.y += dy } },
    deleteHandles: () => false,

    props: () => [
      { key: 'angle', label: 'Направление, °', type: 'range', min: -180, max: 180, step: 5 },
      { key: 'power', label: 'Скорость на срезе', type: 'range', min: 0, max: 1400, step: 20 },
      { key: 'nozzle', label: 'Горловина', type: 'range', min: 14, max: 160, step: 2 },
      { key: 'cell', label: 'Клетка сетки', type: 'range', min: 14, max: 60, step: 2 },
      { key: 'push', label: 'Сопротивление воздуха', type: 'range', min: 0, max: 20, step: 0.25 },
      { key: 'show', label: 'Показывать поток', type: 'bool' },
      { key: 'color', label: 'Цвет', type: 'color' },
    ],
  },
})
