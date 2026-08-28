import { defineEntity } from '../../core/registry.js'
import { LAYERS } from '../../core/globals.js'
import { createField, markSolidsRows, inject, step, sample, cellVel } from './fluid.js'

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
    cell: 22,       // размер клетки сетки
    push: 16,       // напор струи на тела
    show: true,
    color: '#7fb6cc',
  }),

  spawn(ctx, data) {
    return { air: null, spin: 0, seed: 0 }
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
      frame: -1, acc: 0, row: 0, draw: -1, motes: [],
    }))
    rt.air = air
    const f = air.field

    if (air.frame !== ctx.frame) {
      air.frame = ctx.frame
      air.acc += dt

      // Течение считаем 30 раз в секунду: вдвое дешевле, на глаз не отличить.
      // Итераций хватает 16: Гаусс — Зейдель сходится вдвое быстрее Якоби,
      // на 14 и на 30 расход через колено совпадает до десятых.
      if (air.acc >= 1 / 30) {
        // Преграды перечитываем полосами: за четыре шага решателя сетка целиком
        // свежая, но ни один кадр не платит за весь уровень. Это же чинит
        // запаздывание после раскопок — прокопанный ход открывается почти сразу.
        const band = Math.ceil(f.ny / 4)
        // Преграда — это и камень, и вода: поток не имеет права идти сквозь
        // лужу, будто её нет. Обратную сторону (ветер гонит рябь по воде)
        // считает сама среда, читая это же поле течения.
        markSolidsRows(f, (x, y) => ctx.solidAt(x, y) || ctx.liquidAt(x, y), air.row, air.row + band)
        air.row = (air.row + band) % f.ny

        step(f, air.acc, { iters: 16, damping: 0.995 })
        moveMotes(air, f, air.acc, b)
        air.acc = 0
      }

      // Напор телам — тоже один раз за кадр. Это поток импульса движущегося
      // воздуха: F ~ |a| · (a − v), где a — воздух, v — тело.
      //
      // Три свойства, и все нужны. По силе струи закон квадратичный, поэтому
      // сильный вентилятор заметно сильнее слабого. При v = a сила ровно ноль,
      // поэтому тело разгоняется до скорости воздуха и не дальше. И, главное,
      // при a = 0 силы нет вовсе: вентилятор отвечает за свою струю, а не за
      // всю среду. Раньше в множителе стояла |a − v|, куда входит собственная
      // скорость тела, — и вентилятор в углу уровня тормозил шар на другом
      // его конце, где воздуха не было. За среду отвечают общее гашение
      // физики и сущность «ветер», а не вентилятор.
      for (const p of ctx.points) {
        if (p.pinned || !p.collision.world) continue
        const a = sample(f, p.x, p.y)
        const air = Math.hypot(a.x, a.y)
        if (air < 1) continue
        const vx = p.vx, vy = p.vy
        const k = (data.push * p.radius * air) / (6500 * p.mass)
        ctx.applyAccel(p, (a.x - vx) * k, (a.y - vy) * k)
      }
    }

    // а струю вливает каждый, за себя — в своих координатах
    const ang = (data.angle || 0) * RAD + ctx.angle
    const [fx, fy] = ctx.place(data.x, data.y)
    const nx = Math.cos(ang), ny = Math.sin(ang)
    inject(f, fx, fy, nx, ny, data.nozzle, data.power * 6 * dt, 1)

    // и подсевает в общий поток свои пылинки — по ним видно, куда он идёт
    if (data.show) seedMotes(ctx, rt, air, dt, data, fx, fy, nx, ny)
  },

  shapes(data, rt, ctx) {
    const out = []
    // поток общий, поэтому рисует его тот, кто первым дошёл до отрисовки в кадре
    const air = rt?.air
    const f = air && air.draw !== air.frame ? air.field : null
    if (f && data.show) {
      air.draw = air.frame

      // Пылинки: их несёт то же поле, что и тела. Поэтому видно не «где поток»,
      // а как он идёт — как заворачивает за угол, как отражается от преграды,
      // как ускоряется в узком месте. Хвост рисуем по последнему следу, так что
      // длина штриха сама показывает скорость.
      for (const m of air.motes) {
        const sp = Math.hypot(m.vx, m.vy)
        if (sp < 12) continue
        const fade = Math.min(1, m.life * 2.5) * Math.min(1, (m.max - m.life) * 1.2)
        out.push({
          k: 'line', layer: LAYERS.midground,
          x1: m.px, y1: m.py, x2: m.x, y2: m.y,
          stroke: m.color || data.color, sw: 2.2, cap: 'round',
          opacity: Math.min(0.85, 0.15 + sp / 700) * fade,
        })
      }

      // и бледная «шерсть» поля под ними — чтобы читалась общая картина
      const stepCell = 3
      for (let j = 1; j < f.ny; j += stepCell) {
        for (let i = 1; i < f.nx; i += stepCell) {
          if (f.solid[i + j * f.nx]) continue
          const s2 = cellVel(f, i, j)
          const sp = Math.hypot(s2.x, s2.y)
          if (sp < 40) continue
          const cx = (i + 0.5) * f.cell, cy = (j + 0.5) * f.cell
          const len = Math.min(f.cell * 1.6, sp * 0.035)
          out.push({
            k: 'line', layer: LAYERS.midground,
            x1: cx - (s2.x / sp) * len * 0.5, y1: cy - (s2.y / sp) * len * 0.5,
            x2: cx + (s2.x / sp) * len * 0.5, y2: cy + (s2.y / sp) * len * 0.5,
            stroke: data.color, sw: 1.4, cap: 'round',
            opacity: Math.min(0.3, 0.05 + sp / 2600),
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
        ? { x: d.x, y: d.y, angle: -90, power: 520, nozzle: 46, cell: 22, push: 16, show: true, color: '#7fb6cc' }
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

// --- пылинки ---------------------------------------------------------------
// Общие для всех вентиляторов, живут в общей среде рядом с полем. Сами по себе
// ни на что не влияют: это чистая визуализация, но движутся они ровно по тому
// полю, которое толкает тела, — поэтому не врут.

const MAX_MOTES = 220

function seedMotes(ctx, rt, air, dt, data, fx, fy, nx, ny) {
  const want = Math.max(0, Math.min(26, Math.round(data.power / 40)))
  rt.seed += want * dt * 3
  while (rt.seed >= 1 && air.motes.length < MAX_MOTES) {
    rt.seed -= 1
    // рассыпаем по срезу горловины, поперёк направления
    const t = (ctx.rng.next() * 2 - 1) * data.nozzle * 0.85
    const x = fx - ny * t + nx * data.nozzle * 0.2
    const y = fy + nx * t + ny * data.nozzle * 0.2
    air.motes.push({
      x, y, px: x, py: y, vx: nx * data.power, vy: ny * data.power,
      life: 0, max: ctx.rng.range(1.6, 3.4), color: data.color,
    })
  }
}

function moveMotes(air, f, dt, b) {
  const live = []
  for (const m of air.motes) {
    m.life += dt
    const a = sample(f, m.x, m.y)
    // пылинка догоняет поток, а не прыгает в него: движение выходит плавным
    m.vx += (a.x - m.vx) * Math.min(1, dt * 12)
    m.vy += (a.y - m.vy) * Math.min(1, dt * 12)
    m.px = m.x; m.py = m.y
    m.x += m.vx * dt
    m.y += m.vy * dt
    const i = Math.floor(m.x / f.cell), j = Math.floor(m.y / f.cell)
    const out = m.x < b.x || m.x > b.x + b.w || m.y < b.y || m.y > b.y + b.h
    const stuck = i >= 0 && j >= 0 && i < f.nx && j < f.ny && f.solid[i + j * f.nx]
    if (m.life < m.max && !out && !stuck && Math.hypot(m.vx, m.vy) > 6) live.push(m)
  }
  air.motes = live
}
