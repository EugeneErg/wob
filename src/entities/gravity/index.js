import { defineEntity } from '../../core/registry.js'
import { LAYERS } from '../../core/globals.js'
import { clamp } from '../../core/geom.js'
import { makeWell, fieldAt } from '../../core/field.js'

// Точка притяжения.
//
// Мир больше не «падает вниз»: гравитация — поле, и эта сущность вкладывает
// в него один источник. Их может быть сколько угодно, вклады складываются,
// и никакого «главного» источника нет. Если во всём уровне нет ни одного
// источника, а однородная составляющая уровня нулевая — получается
// невесомость, и это не отдельный случай, а сумма пустого списка.
//
// Источник — шар: у поверхности тяга равна `pull`, снаружи падает по закону
// обратных квадратов, внутри тела — линейно к нулю в центре (теорема о слоях).
// Поэтому у планеты нет бесконечности в середине, и провалившийся внутрь шар
// не выстреливает в бесконечность, а колеблется около центра.
//
// Управляемость: `pull` может быть отрицательным (отталкивание), источник
// можно выключать сигналом с шины уровня, а `movable` разрешает игроку таскать
// его руками — поле едет следом целиком.

const TAU = Math.PI * 2

// круг многоугольником — для твёрдого тела источника
const ring = (x, y, r, n = 32) => {
  const pts = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU
    pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r])
  }
  return pts
}

// Данные сущности → источник в том виде, в каком его понимает поле мира.
// Одной и той же функцией пользуются и мир (через spawn), и отрисовка —
// поэтому картинка силовых линий считается ровно тем же полем, что и сила.
const wellFrom = (data, x, y, enabled = true) => makeWell({
  x, y,
  pull: data.pull,
  radius: data.radius,
  falloff: data.falloff,
  range: data.range,
  enabled,
})

// Источник работает, если его не выключили сигналом.
// Пустое имя сигнала — значит выключателя нет вовсе.
const isOn = (data, signal) => {
  if (!data.signal) return !data.invert
  return !!signal !== !!data.invert
}

// Все источники уровня, какими их видит эта сущность: свой и соседи того же
// типа (`ctx.peers()` — единственный законный канал). Чужих типов тут нет,
// граница знания не нарушена: сущность просто знает про себе подобных.
function allWells(data, rt, ctx) {
  const own = rt?.well || wellFrom(data, ...(ctx ? ctx.place(data.x, data.y) : [data.x, data.y]))
  const out = [own]
  if (!ctx) return out
  for (const q of ctx.peers()) {
    if (q.rt?.well) out.push(q.rt.well)
    else if (q.data) out.push(wellFrom(q.data, q.data.x, q.data.y, isOn(q.data, undefined)))
  }
  return out
}

// Силовые линии. Идём от поверхности источника наружу против поля (для
// притяжения) или по полю (для отталкивания) и просто шагаем туда, куда
// показывает СУММАРНОЕ поле. Поэтому линии сами сходятся, расходятся и
// сворачиваются к нулевым точкам между источниками — ничего из этого не
// запрограммировано отдельно, это и есть картинка суперпозиции.
function traceLines(wells, self, uniform, bounds, count, step = 15, maxSteps = 120) {
  const out = []
  if (!self.pull || !self.enabled || count <= 0) return out
  const dir = self.pull >= 0 ? -1 : 1
  const a = { x: 0, y: 0 }
  const m = 60
  for (let i = 0; i < count; i++) {
    const th = (i / count) * TAU + 0.2
    let x = self.x + Math.cos(th) * self.radius * 1.03
    let y = self.y + Math.sin(th) * self.radius * 1.03
    const pts = [[x, y]]
    for (let s = 0; s < maxSteps; s++) {
      fieldAt(wells, uniform, x, y, a)
      const len = Math.hypot(a.x, a.y)
      if (len < 1e-3) break             // нулевая точка поля: линия в ней и кончается
      x += (a.x / len) * step * dir
      y += (a.y / len) * step * dir
      pts.push([x, y])
      if (x < bounds.x - m || x > bounds.x + bounds.w + m) break
      if (y < bounds.y - m || y > bounds.y + bounds.h + m) break
      // упёрлись в чужое тело — линия на нём и заканчивается
      let hit = false
      for (const w of wells) {
        if (w === self || !w.enabled) continue
        if (Math.hypot(w.x - x, w.y - y) <= w.radius) { hit = true; break }
      }
      if (hit) break
    }
    if (pts.length > 1) out.push(pts)
  }
  return out
}

// Пересчитывать линии каждый кадр незачем: они меняются, только когда
// меняется само поле. Подпись поля — дешёвая проверка «а изменилось ли».
const signOf = (wells, uniform) =>
  `${uniform.x | 0},${uniform.y | 0}|` +
  wells.map((w) => `${w.x | 0},${w.y | 0},${w.pull | 0},${w.radius | 0},${w.falloff},${w.range | 0},${w.enabled ? 1 : 0}`).join(';')

export default defineEntity({
  type: 'gravity-well',
  title: 'Притяжение',
  z: LAYERS.background + 5,
  icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" fill="currentColor"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 3"/></svg>',

  defaults: () => ({
    x: 0, y: 0,
    pull: 1800,      // ускорение на поверхности, px/с²; минус — отталкивание
    radius: 90,      // радиус тела
    falloff: 2,      // 2 — обратные квадраты; 1 — плоский мир; 0 — ровное поле
    range: 0,        // дальность действия, 0 — без предела
    solid: true,     // тело твёрдое: на него можно встать
    movable: false,  // игрок может таскать источник руками
    signal: '',      // имя сигнала-выключателя
    invert: false,   // работает, пока сигнала нет
    lines: 12,       // сколько силовых линий рисовать
    smoothness: 0.4,
    color: '#8ea6ff',
    fill: '#2c3450',
  }),

  spawn(ctx, data) {
    const [x, y] = ctx.place(data.x, data.y)
    const well = ctx.addWell(wellFrom(data, x, y, isOn(data, ctx.signal(data.signal))))
    const rt = { well, c: null, off: { x: 0, y: 0 }, grab: null, lines: [], sig: '', on: well.enabled }
    if (data.solid) {
      rt.c = ctx.addCollider({
        points: ring(x, y, data.radius),
        smoothness: data.smoothness ?? 0.4,
        restitution: 0.05,
      })
    }
    return rt
  },

  update(rt, ctx, dt, data) {
    const w = rt.well
    const [bx, by] = ctx.place(data.x, data.y)
    const x = bx + rt.off.x, y = by + rt.off.y
    const moved = Math.abs(w.x - x) > 0.01 || Math.abs(w.y - y) > 0.01 || w.radius !== data.radius

    w.x = x; w.y = y
    w.pull = data.pull
    w.radius = Math.max(1, data.radius)
    w.falloff = data.falloff ?? 2
    w.range = Math.max(0, data.range || 0)
    w.enabled = isOn(data, ctx.signal(data.signal))
    rt.on = w.enabled

    // тело едет вместе с источником
    if (rt.c && moved) ctx.setRegion(rt.c, [[ring(x, y, w.radius)]])

    // линии пересчитываем, только когда поле и правда изменилось
    const wells = allWells(data, rt, ctx)
    const sig = signOf(wells, ctx.gravity)
    if (sig !== rt.sig) {
      rt.sig = sig
      rt.lines = traceLines(wells, w, ctx.gravity, ctx.bounds, data.lines ?? 12)
    }
  },

  shapes(data, rt, ctx) {
    const on = rt ? rt.on : isOn(data, undefined)
    const [x, y] = rt?.well ? [rt.well.x, rt.well.y] : (ctx ? ctx.place(data.x, data.y) : [data.x, data.y])
    const r = Math.max(1, data.radius)
    const out = []

    // Силовые линии. В редакторе рантайма нет — считаем их прямо здесь тем же
    // полем: сущность знает свои данные и данные соседей своего типа.
    let lines = rt?.lines
    if (!lines && ctx) {
      const wells = allWells(data, rt, ctx)
      const self = wells[0]
      lines = traceLines(wells, self, ctx.gravity, ctx.bounds, data.lines ?? 12)
    }
    for (const pts of lines || []) {
      out.push({
        k: 'poly', pts, closed: false, fill: 'none',
        stroke: data.color, sw: 1.5, cap: 'round', join: 'round',
        opacity: on ? 0.3 : 0.08,
        layer: LAYERS.background + 4,
      })
      // стрелка на конце линии: видно, в какую сторону тянет
      if (pts.length > 3 && on) {
        const [ax, ay] = pts[pts.length - 3]
        const [bx2, by2] = pts[pts.length - 1]
        const dx = bx2 - ax, dy = by2 - ay
        const d = Math.hypot(dx, dy) || 1
        const ux = dx / d, uy = dy / d
        const back = data.pull >= 0 ? 1 : -1   // к источнику или от него
        out.push({
          k: 'poly', closed: true, fill: data.color, opacity: 0.35,
          layer: LAYERS.background + 4,
          pts: [
            [bx2, by2],
            [bx2 - (ux * 9 + uy * 4) * back, by2 - (uy * 9 - ux * 4) * back],
            [bx2 - (ux * 9 - uy * 4) * back, by2 - (uy * 9 + ux * 4) * back],
          ],
        })
      }
    }

    // предел действия
    if (data.range > 0) {
      out.push({
        k: 'circle', x, y, r: data.range, fill: 'none', stroke: data.color,
        sw: 1, dash: '3 7', opacity: on ? 0.3 : 0.12, layer: LAYERS.background + 4,
      })
    }

    // тело источника
    const glow = clamp(Math.abs(data.pull) / 3000, 0.05, 0.6)
    out.push({ k: 'circle', x, y, r: r * 1.5, fill: data.color, opacity: on ? glow * 0.18 : 0.03 })
    out.push({
      k: 'circle', x, y, r,
      fill: data.fill, stroke: data.color, sw: data.solid ? 3 : 2,
      dash: data.solid ? undefined : '7 6',
      opacity: on ? 1 : 0.45,
    })
    // знак: плюс — притягивает, минус — отталкивает
    const s = Math.min(r * 0.45, 26)
    out.push({ k: 'line', x1: x - s, y1: y, x2: x + s, y2: y, stroke: data.color, sw: 3, cap: 'round', opacity: on ? 0.9 : 0.4 })
    if (data.pull >= 0) {
      out.push({ k: 'line', x1: x, y1: y - s, x2: x, y2: y + s, stroke: data.color, sw: 3, cap: 'round', opacity: on ? 0.9 : 0.4 })
    }
    return out
  },

  // Игрок может таскать источник, если это разрешили: поле едет за ним целиком
  pointer: {
    priority: -5,
    hit(rt, ctx, pt, data) {
      if (!data.movable || !rt?.well) return false
      return Math.hypot(pt.x - rt.well.x, pt.y - rt.well.y) <= Math.max(24, data.radius)
    },
    down(rt, ctx, pt) { rt.grab = { x: rt.well.x - pt.x, y: rt.well.y - pt.y } },
    move(rt, ctx, pt, data) {
      if (!rt.grab) return
      const [bx, by] = ctx.place(data.x, data.y)
      rt.off.x = pt.x + rt.grab.x - bx
      rt.off.y = pt.y + rt.grab.y - by
    },
    up(rt) { rt.grab = null },
  },

  editor: {
    create: {
      start: () => ({ x: 0, y: 0, ready: false }),
      click(d, pt) { d.x = pt.x; d.y = pt.y; d.ready = true; return 'done' },
      move(d, pt) { d.x = pt.x; d.y = pt.y },
      shapes: (d) => [
        { k: 'circle', x: d.x, y: d.y, r: 90, fill: 'rgba(142,166,255,.12)', stroke: '#8ea6ff', sw: 2, dash: '6 6' },
        { k: 'circle', x: d.x, y: d.y, r: 4, fill: '#8ea6ff' },
      ],
      finish: (d) => (d.ready ? { ...defaultsOf(), x: d.x, y: d.y } : null),
    },

    bounds: (d) => ({ x: d.x - d.radius, y: d.y - d.radius, w: d.radius * 2, h: d.radius * 2 }),
    hit: (d, pt) => Math.hypot(pt.x - d.x, pt.y - d.y) <= d.radius,
    move(d, dx, dy) { d.x += dx; d.y += dy },

    // ручка в центре двигает источник, ручка на кромке меняет радиус тела
    handles: (d) => [
      { id: 0, x: d.x, y: d.y },
      { id: 1, x: d.x + d.radius, y: d.y },
    ],
    moveHandles(d, ids, dx, dy) {
      if (ids.includes(1) && !ids.includes(0)) { d.radius = Math.max(8, d.radius + dx); return }
      if (ids.length) { d.x += dx; d.y += dy }
    },
    deleteHandles: () => false,   // ручку не удалить — мир уберёт сущность целиком

    props: () => [
      { key: 'pull', label: 'Тяга на поверхности', type: 'range', min: -4000, max: 4000, step: 50 },
      { key: 'radius', label: 'Радиус тела', type: 'range', min: 8, max: 400, step: 2 },
      { key: 'falloff', label: 'Спад (2 — обратные квадраты)', type: 'range', min: 0, max: 3, step: 0.25 },
      { key: 'range', label: 'Дальность (0 — без предела)', type: 'range', min: 0, max: 2400, step: 20 },
      { key: 'solid', label: 'Твёрдое тело', type: 'bool' },
      { key: 'movable', label: 'Игрок может таскать', type: 'bool' },
      { key: 'signal', label: 'Выключатель (сигнал)', type: 'text' },
      { key: 'invert', label: 'Работает, пока сигнала нет', type: 'bool' },
      { key: 'lines', label: 'Силовых линий', type: 'range', min: 0, max: 40, step: 1 },
      { key: 'smoothness', label: 'Гладкость', type: 'range', min: 0, max: 1, step: 0.05, global: true },
      { key: 'color', label: 'Цвет', type: 'color' },
      { key: 'fill', label: 'Заливка', type: 'color' },
    ],
  },
})

// значения по умолчанию для только что созданного источника
function defaultsOf() {
  return {
    pull: 1800, radius: 90, falloff: 2, range: 0, solid: true, movable: false,
    signal: '', invert: false, lines: 12, smoothness: 0.4, color: '#8ea6ff', fill: '#2c3450',
  }
}
