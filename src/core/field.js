// Гравитационное поле мира.
//
// Гравитация здесь — не вектор, а поле: у каждой точки пространства своё
// значение. Источников может быть сколько угодно, их вклады складываются.
// Это и есть «полноценное поле»: суперпозиция, а не выбор ближайшего.
// Нет ни одного источника и однородная составляющая нулевая — значит
// невесомость, и это не особый случай, а сумма пустого списка.

import { clamp } from './geom.js'

let UID = 1

// Источник — шар радиуса radius, у поверхности которого тяга равна pull.
// Снаружи она падает по закону обратных квадратов, внутри — линейно к нулю
// в центре. Внутри именно так по теореме о слоях: шаровой слой не притягивает
// то, что внутри него, поэтому у центра тяги нет. Заодно исчезает
// бесконечность в нуле — без всяких «смягчений» и обрезаний.
//
//   pull   — ускорение на поверхности, px/с². Минус — отталкивание.
//   radius — радиус тела источника, px.
//   falloff — показатель степени снаружи: 2 — Ньютон, 1 — плоский мир, 0 — ровно.
//   range  — дальше этого расстояния источника нет вовсе (0 — без предела).
//            Край не рубится ножом: последняя четверть плавно сходит на нет,
//            иначе тело на границе получало бы скачок ускорения.
export function makeWell(o = {}) {
  return {
    id: 'w' + UID++,
    x: o.x || 0,
    y: o.y || 0,
    pull: o.pull ?? 1800,
    radius: Math.max(1, o.radius ?? 80),
    falloff: o.falloff ?? 2,
    range: Math.max(0, o.range ?? 0),
    enabled: o.enabled !== false,
    owner: o.owner || null,
    removed: false,
  }
}

const smooth = (t) => t * t * (3 - 2 * t)

// Величина ускорения от одного источника на расстоянии r (со знаком pull)
export function wellMagnitude(w, r) {
  if (!w.enabled || !w.pull) return 0
  if (w.range && r >= w.range) return 0
  const R = w.radius
  let a
  if (r <= R) {
    a = w.pull * (r / R)              // внутри тела — линейно к центру
  } else {
    a = w.pull * Math.pow(R / r, w.falloff)
  }
  if (w.range) {
    const edge = w.range * 0.75
    if (r > edge) a *= smooth(clamp((w.range - r) / (w.range - edge), 0, 1))
  }
  return a
}

// Вклад одного источника в ускорение в точке — прибавляется к out
export function addWellAccel(w, x, y, out) {
  if (!w.enabled || !w.pull) return out
  const dx = w.x - x, dy = w.y - y
  const r = Math.hypot(dx, dy)
  if (r < 1e-6) return out            // ровно в центре тяги нет ни в какую сторону
  const a = wellMagnitude(w, r)
  if (!a) return out
  out.x += (dx / r) * a
  out.y += (dy / r) * a
  return out
}

// Полное поле: однородная составляющая уровня плюс все источники.
// Сущностям она нужна той же формулой, что и физике, — поэтому функция
// отдельная и чистая: ею считают и силу, и картинку силовых линий.
export function fieldAt(wells, uniform, x, y, out = { x: 0, y: 0 }) {
  out.x = uniform ? uniform.x || 0 : 0
  out.y = uniform ? uniform.y || 0 : 0
  for (let i = 0; i < wells.length; i++) addWellAccel(wells[i], x, y, out)
  return out
}

export class GravityField {
  constructor(uniform) {
    this.uniform = { x: 0, y: 0, ...(uniform || {}) }
    this.wells = []
  }

  add(o) {
    const w = o && o.id && o.pull !== undefined ? o : makeWell(o)
    this.wells.push(w)
    return w
  }

  remove(w) {
    if (!w || w.removed) return
    w.removed = true
    const i = this.wells.indexOf(w)
    if (i >= 0) this.wells.splice(i, 1)
  }

  // Ускорение свободного падения в точке (x, y)
  at(x, y, out = { x: 0, y: 0 }) {
    if (!this.wells.length) {
      out.x = this.uniform.x
      out.y = this.uniform.y
      return out
    }
    return fieldAt(this.wells, this.uniform, x, y, out)
  }
}
