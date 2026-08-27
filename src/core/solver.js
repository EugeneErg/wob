// Позиционный решатель мира. Знает только о глобальных свойствах
// (см. core/particles.js) и ничего — о сущностях.
//
// ЧТО ЗДЕСЬ ЗА АЛГОРИТМ И ПОЧЕМУ ИМЕННО ОН
//
// Подшаг устроен так:
//
//   1. внешние силы → скорость          v ← (v + a·h)·затухание
//   2. предсказание                     s ← x,  x ← x + v·h
//   3. поиск соседей                    (один раз на подшаг, с запасом)
//   4. K раз: спроецировать ограничения x ← x + Δx
//   5. скорость из положений            v ← (x − s)/h
//   6. проход по скоростям              упругость, трение, вязкость, завихрение
//
// Это буквально Algorithm 1 из Position Based Fluids (Macklin & Müller, 2013).
// Разница с прежним ядром не в том, что тут другая математика — она та же
// самая, XPBD, — а в том, что шаги 4 и 6 больше не зашиты в решатель списком
// вызовов. Ограничение стало объектом с четырьмя методами, и цикл идёт по
// списку модулей. Плотность среды — такое же ограничение на положения, как
// связь: у связи C = |x_a − x_b| − rest, у среды C = ρ/ρ₀ − 1. Ей нужны от мира
// ровно те же две вещи: место в цикле проекции и место в проходе по скоростям.
//
// Поэтому «интегрировать воду» больше не значит «пристроить сбоку второй
// решатель со своим шагом». Значит — включить модуль в тот же список. Вода
// расталкивается с шарами по обратным массам просто потому, что находится
// внутри одного цикла с ними, и Архимед получается сам, без единого слова о нём.
//
// ЧТО ИЗМЕНИЛОСЬ ПО СРАВНЕНИЮ С ПРЕЖНИМ ЯДРОМ
//
//   • состояние частиц лежит в типизированных массивах (core/particles.js),
//     объект остался только у игровых точек — иначе тысяча частиц среды
//     стоила бы тысячу объектов и промахов по кэшу;
//   • появились ЖИВУЩИЕ списки соседей (core/nsearch.js): PBF ходит по
//     окружению по три-четыре раза за подшаг, пересобирать его каждый раз
//     дороже самой физики;
//   • поправки умеют накапливаться по Якоби (store.accum/flush), а не только
//     применяться на месте по Гауссу — Зейделю. Плотность иначе не решается:
//     она связывает частицу разом со всеми соседями;
//   • нормальный импульс контакта стал настоящим множителем ограничения
//     (lamN), а не служебным полем cn.
//
// Скорость по-прежнему СОСТОЯНИЕ (px/с), а не разность двух положений.
// В верле нельзя подвинуть тело, не разогнав его: телепорт неотличим от удара,
// а доли-на-подшаг молча меняют смысл вместе с частотой подшагов.

import { clamp, ringsOf, bboxOfRings } from './geom.js'
import { EdgeIndex, EDGES_MIN } from './grid.js'
import { GravityField } from './field.js'
import { ParticleStore, Point, F_PINNED, F_WORLD, F_POINTS, F_FLUID } from './particles.js'
import { DistanceConstraints } from './constraints/distance.js'
import { ShapeMatching } from './constraints/shape.js'
import { Contacts } from './constraints/contact.js'
import { FluidDensity, makeMedium, sameSubstance } from './constraints/fluid.js'

let UID = 1
const nid = (p) => p + UID++

export class Physics {
  constructor(opts = {}) {
    this.store = new ParticleStore(opts.capacity ?? 1024)

    // Гравитация — поле, а не вектор: однородная составляющая уровня плюс
    // сколько угодно источников притяжения (см. core/field.js).
    this.field = new GravityField({ x: 0, y: 1800, ...(opts.gravity || {}) })
    this._g = { x: 0, y: 0 }

    // Сопротивление среды — скорость затухания в 1/с, а не множитель на подшаг:
    // от величины подшага результат не зависит.
    this.drag = opts.drag ?? 0.072

    // Мелкий подшаг и мало итераций сходится лучше, чем крупный шаг и много
    // итераций: жёсткость перестаёт зависеть от числа итераций, а ошибка падает
    // как h², а не как 1/K. Для среды это важнее, чем для связей.
    this.fixed = opts.fixed ?? 1 / 120
    this.iterations = opts.iterations ?? 3
    this.maxSub = opts.maxSub ?? 8
    this._acc = 0

    this.links = []
    this.bodies = []
    this.mediums = []
    this.colliders = []
    this.substep = 0

    this._points = []
    this._pgen = -1

    // Конвейер ограничений. Порядок задаётся полем order; состав меняется
    // снаружи — этим и отличается «условно PBF-движок» от движка, к которому
    // PBF пришит сбоку.
    this.modules = []
    this.fluid = new FluidDensity()
    this.use(new DistanceConstraints())
    this.use(new ShapeMatching())
    this.use(new Contacts())
  }

  use(mod) {
    this.modules.push(mod)
    this.modules.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    mod.attach?.(this)
    return mod
  }
  module(name) { return this.modules.find((m) => m.name === name) }

  // Прежняя настройка задавалась множителем на подшаг 1/120. Вход оставлен.
  get damping() { return Math.exp(-this.drag / 120) }
  set damping(v) { this.drag = v > 0 && v < 1 ? -Math.log(v) * 120 : 0 }

  get gravity() { return this.field.uniform }
  set gravity(v) { this.field.uniform = { x: v?.x || 0, y: v?.y || 0 } }

  addWell(o) { return this.field.add(o) }
  removeWell(w) { this.field.remove(w) }
  gravityAt(x, y, out) { return this.field.at(x, y, out) }

  // Игровые точки — те, у которых есть ручка. Частицы среды сюда не попадают:
  // сущность не должна перебирать пять тысяч капель воды, чтобы найти шар.
  get points() {
    if (this._pgen !== this.store.gen) {
      const s = this.store
      const out = []
      for (let i = 0; i < s.n; i++) { const h = s.handle[i]; if (h) out.push(h) }
      this._points = out
      this._pgen = s.gen
    }
    return this._points
  }

  // ---- точки ---------------------------------------------------------------
  addPoint(o = {}) {
    const s = this.store
    const i = s.alloc()
    const p = new Point(s, i, nid('p'))
    s.handle[i] = p

    s.x[i] = o.x || 0; s.y[i] = o.y || 0
    s.sx[i] = s.x[i]; s.sy[i] = s.y[i]
    s.vx[i] = o.vx || 0; s.vy[i] = o.vy || 0
    s.radius[i] = o.radius ?? 8
    s.rest[i] = o.restitution ?? 0.2
    s.smooth[i] = o.smoothness ?? 0.5
    // насколько далеко точке интересна стенка сверх собственного радиуса
    s.reach[i] = o.reach ?? 0
    // отрицательный вес — подъёмная сила: инерция та же, гравитация наоборот
    s.setMass(i, o.mass ?? 1)
    s.gscale[i] = (o.gravityScale ?? 1) * ((o.mass ?? 1) < 0 ? -1 : 1)

    let f = s.flags[i]
    if (o.collision?.world === false) f &= ~F_WORLD
    if (o.collision?.points === false) f &= ~F_POINTS
    if (o.collision?.fluid === false) f &= ~F_FLUID
    if (o.pinned) f |= F_PINNED
    s.flags[i] = f
    if (o.pinned) s.w[i] = 0
    s.group[i] = s.groups.id(o.group || o.owner || null)

    // приватное для игры, не физическое: живёт на ручке
    p.attachable = o.attachable ?? false
    p.suction = o.suction ?? 0
    p.owner = o.owner || null
    return p
  }

  removePoint(p) {
    if (!p || p.removed) return
    for (const b of this.bodies) if (b.verts.includes(p)) this.detachFromBody(b, [p])
    for (const l of [...p.links]) this.removeLink(l)
    p.removed = true
    this.store.free(p._i)
  }

  applyAccel(p, ax, ay) { const s = this.store, i = p._i; s.ax[i] += ax; s.ay[i] += ay }
  setVelocity(p, vx, vy) { const s = this.store, i = p._i; s.vx[i] = vx; s.vy[i] = vy }
  addImpulse(p, ix, iy) {
    const s = this.store, i = p._i
    if (s.w[i]) { s.vx[i] += ix * s.w[i]; s.vy[i] += iy * s.w[i] }
  }
  // Переставить тело, не разгоняя его: положение меняется, скорость — нет.
  place(p, x, y, keepVelocity = false) {
    const s = this.store, i = p._i
    s.x[i] = x; s.y[i] = y; s.sx[i] = x; s.sy[i] = y
    if (!keepVelocity) { s.vx[i] = 0; s.vy[i] = 0 }
  }
  setPinned(p, on) { this.store.setPinned(p._i, on) }
  setMass(p, m) { this.store.setMass(p._i, m) }
  setSpin(p, w) { this.store.spin[p._i] = w }

  // ---- связи ---------------------------------------------------------------
  addLink(a, b, o = {}) {
    const l = {
      id: nid('l'), a, b,
      rest: o.rest ?? Math.hypot(a.x - b.x, a.y - b.y),
      spring: o.spring ?? 2500,        // сила на пиксель растяжения
      damping: clamp(o.damping ?? 0.2, 0, 1),
      breakForce: o.breakForce ?? Infinity,
      lambda: 0,
      tension: 0,
      visible: o.visible !== false,
      width: o.width ?? 5,
      color: o.color || null,
      owner: o.owner || null,
      removed: false,
    }
    a.links.push(l); b.links.push(l)
    this.links.push(l)
    return l
  }

  removeLink(l) {
    if (!l || l.removed) return
    l.removed = true
    const ai = l.a.links.indexOf(l); if (ai >= 0) l.a.links.splice(ai, 1)
    const bi = l.b.links.indexOf(l); if (bi >= 0) l.b.links.splice(bi, 1)
    const i = this.links.indexOf(l); if (i >= 0) this.links.splice(i, 1)
  }

  // ---- жёсткая форма -------------------------------------------------------
  addBody(o = {}) {
    const verts = [...(o.points || [])]
    const b = {
      id: nid('b'), verts, rest: null,
      stiffness: clamp(o.stiffness ?? 1, 0, 1),
      removed: false,
    }
    for (const p of verts) p.rigid++
    this._rebase(b)
    this.bodies.push(b)
    return b
  }

  // Среда регистрируется списком, как тело: признака «жидкая» на частице нет,
  // принадлежность выражает сам список. Модуль плотности подключается лениво —
  // нет среды, нет и расходов на неё.
  addMedium(o = {}) {
    // Одинаковое вещество — ОДНА среда, сколько бы луж его ни налило. Иначе
    // две слившиеся лужи, физически ставшие одной кучей частиц, продолжали бы
    // считаться порознь и рисовались бы двумя блобами со швом на стыке.
    // Различает вещества не имя, а числа: у кого они совпали, тот и одно и то
    // же. Разные — остаются разными средами и расслаиваются.
    const same = this.mediums.find((x) => sameSubstance(x, o))
    if (same) {
      for (const p of o.points || []) same.points.push(p)
      return same
    }
    const m = makeMedium({ ...o, id: nid('m') })
    this.mediums.push(m)
    this.fluid.mediums = this.mediums
    if (!this.modules.includes(this.fluid)) this.use(this.fluid)
    return m
  }

  // Убираем не среду, а долю ушедшей сущности: среда общая, и у неё могут
  // остаться другие хозяева. Опустела — тогда и уходит.
  removeMedium(m, points) {
    if (!m) return
    if (points && points.length) {
      const gone = new Set(points)
      m.points = m.points.filter((p) => !gone.has(p))
    } else m.points.length = 0
    if (m.points.length) return
    m.removed = true
    const i = this.mediums.indexOf(m); if (i >= 0) this.mediums.splice(i, 1)
  }

  _rebase(b) {
    let cx = 0, cy = 0, m = 0
    for (const p of b.verts) { cx += p.x * p.mass; cy += p.y * p.mass; m += p.mass }
    if (m) { cx /= m; cy /= m }
    b.rest = b.verts.map((p) => ({ x: p.x - cx, y: p.y - cy }))
  }

  attachToBody(b, points) {
    if (!b || !points.length) return
    for (const p of points) if (!b.verts.includes(p)) { b.verts.push(p); p.pinned = false; p.rigid++ }
    this._rebase(b)
  }

  detachFromBody(b, points) {
    if (!b) return
    for (const p of points) if (b.verts.includes(p) && p.rigid > 0) p.rigid--
    const keep = b.verts.map((p, i) => [p, b.rest[i]]).filter(([p]) => !points.includes(p))
    b.verts = keep.map((x) => x[0])
    b.rest = keep.map((x) => x[1])
  }

  removeBody(b) {
    if (!b) return
    for (const p of b.verts) if (p.rigid > 0) p.rigid--
    b.removed = true
    const i = this.bodies.indexOf(b); if (i >= 0) this.bodies.splice(i, 1)
  }

  // ---- статическая геометрия ----------------------------------------------
  addCollider(o = {}) {
    const c = {
      id: nid('c'),
      verts: o.verts ? [...o.verts] : null,        // если заданы — геометрия живая
      points: o.verts ? o.verts.map((p) => [p.x, p.y]) : (o.points || []),
      polys: null,
      smoothness: o.smoothness ?? 0.5,
      restitution: o.restitution ?? 0.1,
      owner: o.owner || null,
      group: o.group || o.owner || null,
      removed: false,
    }
    c.dynamic = !!c.verts
    this.setRegion(c, o.polys || [[c.points]])
    this.colliders.push(c)
    return c
  }

  setRegion(c, polys) {
    c.polys = polys
    c.rings = ringsOf(polys)
    c.points = c.rings[0] || []
    c.bbox = bboxOfRings(c.rings)
    let n = 0
    for (const r of c.rings) n += r.length
    c.index = n > EDGES_MIN ? new EdgeIndex(polys) : null
    c.stamp = (c.stamp || 0) + 1   // граница изменилась: пересобрать призраков
    return c
  }

  removeCollider(c) {
    if (!c) return
    c.removed = true
    const i = this.colliders.indexOf(c); if (i >= 0) this.colliders.splice(i, 1)
  }

  // ---- шаг -----------------------------------------------------------------
  step(dt) {
    this._acc += Math.min(dt, 0.25)
    let n = 0
    // Сколько подшагов будет — известно заранее, и это стоит сказать модулям:
    // не всякая работа обязана повторяться на каждом. Силы, которые копятся
    // по соседям (вязкость, натяжение), достаточно приложить раз за кадр.
    const total = Math.min(this.maxSub, Math.floor(this._acc / this.fixed))
    while (this._acc >= this.fixed && n < this.maxSub) {
      this.lastSub = (n === total - 1)
      this._sub(this.fixed)
      this._acc -= this.fixed
      n++
    }
    if (n === this.maxSub) this._acc = 0
    const s = this.store
    s.ax.fill(0, 0, s.n)
    s.ay.fill(0, 0, s.n)
  }

  _sub(h) {
    const s = this.store
    const n = s.n
    const g = this._g
    const kd = Math.exp(-this.drag * h)
    this.substep++

    // 1. силы → скорость; 2. предсказание.
    // Закреплённую не интегрируем: её скорость задают снаружи (рельсы, мотор),
    // и она нужна контакту как скорость поверхности.
    // Все массивы — в локальные. Пока это свойства хранилища, их приходится
    // перечитывать на каждой точке: замерено 425 нс на точку там, где работы
    // на десяток операций.
    const X = s.x, Y = s.y, SX = s.sx, SY = s.sy, VX = s.vx, VY = s.vy
    const LN = s.lamN, WW = s.w, GS = s.gscale, AX = s.ax, AY = s.ay
    // Когда источников притяжения нет, «низ» у всех один и спрашивать его у
    // каждой точки незачем.
    const wells = this.field.wells.length
    const ug = this.field.uniform
    for (let i = 0; i < n; i++) {
      SX[i] = X[i]; SY[i] = Y[i]
      LN[i] = 0
      if (!WW[i]) continue
      let gx = ug.x, gy = ug.y
      if (wells) {
        // поле спрашиваем там, где частица сейчас: у каждой свой «низ»
        this.field.at(X[i], Y[i], g)
        gx = g.x; gy = g.y
      }
      const gsi = GS[i]
      VX[i] = (VX[i] + (gx * gsi + AX[i]) * h) * kd
      VY[i] = (VY[i] + (gy * gsi + AY[i]) * h) * kd
      X[i] += VX[i] * h
      Y[i] += VY[i] * h
    }

    // 3. соседи — один раз на подшаг, с запасом
    for (const m of this.modules) m.prepare?.(this, h)

    // 4. проекция ограничений
    for (let it = 0; it < this.iterations; it++) {
      for (const m of this.modules) m.project?.(this, h, it)
    }

    // 5. скорость из положений. Любая позиционная поправка — связь, контакт,
    //    давление среды — переносит импульс, как ей и полагается.
    const inv = 1 / h
    for (let i = 0; i < n; i++) {
      if (!WW[i]) continue
      VX[i] = (X[i] - SX[i]) * inv
      VY[i] = (Y[i] - SY[i]) * inv
    }

    // 6. проход по скоростям: упругость, трение, качение, вязкость, завихрение
    for (const m of this.modules) m.velocity?.(this, h)

    // накопленный поворот — чтобы вращение было видно на экране
    const SP = s.spin, AN = s.angle
    for (let i = 0; i < n; i++) {
      if (s.rigid[i] || !s.w[i]) { SP[i] = 0; continue }
      AN[i] += SP[i] * h
    }

    for (const m of this.modules) m.finish?.(this, h)
  }
}
