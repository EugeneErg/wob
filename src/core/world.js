import { Physics } from './solver.js'
import { getEntity } from './registry.js'
import { EVENTS } from './globals.js'
import { closestOnSegment, bboxOfPoints } from './geom.js'
import { regionHas } from './grid.js'
import { composeShapes } from './scene.js'

let UID = 1
export const newId = (prefix = 'e') => `${prefix}${UID++}${Math.random().toString(36).slice(2, 6)}`

// Всё, что меняет мир: в редакторе этого нет, отрисовка обязана быть чистой.
export const CONTEXT_MUTATORS = [
  'setSignal', 'shared',
  'addPoint', 'addLink', 'addCollider', 'addBody', 'addWell', 'addMedium',
  'removeLink', 'removePoint', 'removeCollider', 'removeWell',
  'setRegion', 'applyAccel', 'setMass', 'setSpin',
  'setVelocity', 'addImpulse', 'placeAt', 'setPinned',
  'emit', 'despawnSelf', 'destroy',
]

// Фасад мира для сущности. Сущность видит только глобальные свойства чужих тел:
// radius / mass / restitution / smoothness / collision / attachable / suction.
// Тип и данные чужой сущности отсюда недоступны.
export class EntityContext {
  constructor(world, inst) {
    this.world = world
    this.id = inst.id
    this._inst = inst
    this._points = []
    this._links = []
    this._colliders = []
    this._bodies = []
    this._mediums = []
    this._wells = []
  }

  // Однородная составляющая поля — та, что задана уровню одним вектором
  get gravity() { return this.world.physics.gravity }
  // Полное ускорение свободного падения в этом месте: однородная составляющая
  // плюс все источники притяжения. Кто их поставил — не видно, как и положено.
  gravityAt(x, y) { return this.world.physics.gravityAt(x, y, { x: 0, y: 0 }) }

  get time() { return this.world.time }
  get bounds() { return this.world.bounds }
  get pointer() { return this.world.pointer }

  // Шина сигналов: одна сущность пишет значение по имени, другая читает.
  // Имя придумывает автор уровня в редакторе, поэтому сущности по-прежнему
  // ничего не знают друг о друге — только про строку, которую им написали.
  setSignal(name, value) { this.world.setSignal(name, value) }
  signal(name) { return this.world.signals.get(name) }

  // Общая среда по имени: воздух — то, что не принадлежит никому
  // и живёт, пока есть хоть один пользователь. Имя — такая же строка-договор,
  // как у сигналов, поэтому типы сущностей друг другу по-прежнему не видны.
  shared(name, factory) { return this.world.shared(name, factory, this.id) }
  get frame() { return this.world.frame }

  // Координаты из data — в координатах родителя. Эти три метода переводят их
  // в мировые; у сущности без родителя они ничего не меняют.
  place(x, y) {
    const m = this._inst.xform
    return [m.c * x - m.s * y + m.x, m.s * x + m.c * y + m.y]
  }
  dir(x, y) {
    const m = this._inst.xform
    return [m.c * x - m.s * y, m.s * x + m.c * y]
  }
  placePoints(pts) { return pts.map(([x, y]) => this.place(x, y)) }
  get angle() { const m = this._inst.xform; return Math.atan2(m.s, m.c) }
  get points() { return this.world.physics.points }
  get links() { return this.world.physics.links }

  addPoint(o) {
    const p = this.world.physics.addPoint({ ...o, owner: this.id })
    this._points.push(p)
    return p
  }
  addLink(a, b, o) {
    const l = this.world.physics.addLink(a, b, { ...o, owner: this.id })
    if (this._links.length > 64) this._links = this._links.filter((x) => !x.removed)
    this._links.push(l)
    return l
  }
  addCollider(o) {
    const c = this.world.physics.addCollider({ ...o, owner: this.id })
    this._colliders.push(c)
    return c
  }
  // Жёсткая форма: вершины держат взаимное расположение и вращаются как одно целое
  addBody(o) {
    const b = this.world.physics.addBody(o)
    this._bodies.push(b)
    return b
  }
  // Среда: частицы держат взаимную плотность и текут. Ровно такое же
  // ограничение, как жёсткая форма, только про несжимаемость, а не про форму.
  addMedium(o) {
    const m = this.world.physics.addMedium(o)
    this._mediums.push(m)
    return m
  }
  // Источник притяжения: тело, вокруг которого искривляется «низ».
  // Их вклады складываются — поле считает мир, а не сущность.
  addWell(o) {
    const w = this.world.physics.addWell({ ...o, owner: this.id })
    this._wells.push(w)
    return w
  }
  removeWell(w) {
    this.world.physics.removeWell(w)
    const i = this._wells.indexOf(w)
    if (i >= 0) this._wells.splice(i, 1)
  }
  removeCollider(c) { this.world.physics.removeCollider(c) }
  // Заменить область коллайдера — так копают песок и рушат стены
  setRegion(c, polys, dirty) { return this.world.physics.setRegion(c, polys, dirty) }
  removeLink(l) { this.world.physics.removeLink(l) }
  // Убрать свою точку. Симметрично addPoint — как removeLink к addLink.
  removePoint(p) {
    const i = this._points.indexOf(p)
    if (i >= 0) this._points.splice(i, 1)
    this.world.physics.removePoint(p)
  }
  applyAccel(p, ax, ay) { this.world.physics.applyAccel(p, ax, ay) }
  // Скорость — обычное состояние тела, и задавать её можно прямо. Раньше для
  // этого приходилось двигать «прошлое положение»: телепорт был неотличим от
  // разгона, и всякая перестановка тела молча превращалась в удар.
  setVelocity(p, vx, vy) { this.world.physics.setVelocity(p, vx, vy) }
  addImpulse(p, ix, iy) { this.world.physics.addImpulse(p, ix, iy) }
  // Переставить тело, не разгоняя его
  placeAt(p, x, y, keepVelocity = false) { this.world.physics.place(p, x, y, keepVelocity) }
  setPinned(p, on) { this.world.physics.setPinned(p, on) }
  setMass(p, m) { this.world.physics.setMass(p, m) }
  // угловая скорость точки, рад/с: живое тело может держать себя от вращения
  setSpin(p, w) { this.world.physics.setSpin(p, w) }

  // --- запросы к миру -------------------------------------------------------
  query(pred) { return this.world.physics.points.filter(pred) }

  nearest(pos, pred, maxDist = Infinity) {
    let best = null, bestD = maxDist
    for (const p of this.world.physics.points) {
      if (!pred(p)) continue
      const d = Math.hypot(p.x - pos.x, p.y - pos.y)
      if (d < bestD) { bestD = d; best = p }
    }
    return best
  }

  neighbors(p) { return p.links.map((l) => (l.a === p ? l.b : l.a)) }

  // Сущности одного типа видят друг друга — это всё ещё «знать только себя».
  // Чужие типы отсюда недоступны.
  peers() {
    return this.world.instances
      .filter((i) => i.type === this._inst.type && i !== this._inst)
      .map((i) => ({ id: i.id, data: i.data, rt: i.rt }))
  }
  peer(id) {
    const i = this.world.instances.find((x) => x.id === id && x.type === this._inst.type)
    return i ? { id: i.id, data: i.data, rt: i.rt } : null
  }

  // Есть ли в этой точке твёрдая статика — сущности этим щупают землю
  solidAt(x, y) {
    for (const c of this.world.physics.colliders) {
      const b = c.bbox
      if (b && (x < b.x || x > b.x + b.w || y < b.y || y > b.y + b.h)) continue
      if (regionHas(c, x, y)) return true
    }
    return false
  }

  // Занято ли место жидкостью — та же дверь, что solidAt, только про среду.
  // Спрашивают её те, для кого лужа такая же преграда, как камень: поток
  // воздуха не должен идти сквозь воду, будто её нет. Кто именно налил эту
  // воду и что она за вещество — по-прежнему не видно.
  liquidAt(x, y) {
    const f = this.world.physics.fluid
    return f.count ? f.occupiedAt(x, y) : false
  }

  // Кратчайший путь по графу связей до точки, удовлетворяющей pred.
  // via ограничивает, через какие узлы вообще можно идти.
  pathFrom(start, pred, via = null) {
    if (pred(start)) return [start]
    const prev = new Map([[start, null]])
    const queue = [start]
    while (queue.length) {
      const cur = queue.shift()
      for (const l of cur.links) {
        const nx = l.a === cur ? l.b : l.a
        if (prev.has(nx)) continue
        if (via && !via(nx) && !pred(nx)) continue
        prev.set(nx, cur)
        if (pred(nx)) {
          const path = [nx]
          let c = cur
          while (c) { path.unshift(c); c = prev.get(c) }
          return path
        }
        queue.push(nx)
      }
    }
    return null
  }

  // Мешает ли статическая геометрия отрезку a—b
  isBlocked(a, b, samples = 10) {
    for (const c of this.world.physics.colliders) {
      for (let i = 1; i < samples; i++) {
        const t = i / samples
        const x = a.x + (b.x - a.x) * t
        const y = a.y + (b.y - a.y) * t
        if (regionHas(c, x, y)) return true
      }
    }
    return false
  }

  // Ближайшая точка на любой связи (кроме исключённых) — общий примитив
  closestOnLinks(pos, filter = () => true) {
    let best = null, bestD = Infinity
    for (const l of this.world.physics.links) {
      if (!filter(l)) continue
      const q = closestOnSegment(pos.x, pos.y, l.a.x, l.a.y, l.b.x, l.b.y)
      const d = Math.hypot(pos.x - q.x, pos.y - q.y)
      if (d < bestD) { bestD = d; best = { link: l, x: q.x, y: q.y, t: q.t, dist: d } }
    }
    return best
  }

  emit(name, payload) { this.world.emit(name, { ...payload, from: this.id }) }
  despawnSelf() { this.world.despawn(this._inst) }

  // Что сущность создала. Мир пользуется этим сам (перенос, сборки, уборка),
  // сущностям поле не нужно.
  get owned() { return { points: this._points, links: this._links, colliders: this._colliders, bodies: this._bodies, wells: this._wells } }

  destroy() {
    this.world.releaseShared(this.id)
    for (const w of this._wells) this.world.physics.removeWell(w)
    this._wells = []
    for (const m of this._mediums) this.world.physics.removeMedium(m, this._points)
    for (const b of this._bodies) this.world.physics.removeBody(b)
    for (const l of this._links) this.world.physics.removeLink(l)
    for (const p of this._points) this.world.physics.removePoint(p)
    for (const c of this._colliders) this.world.physics.removeCollider(c)
    this._links = []; this._points = []; this._colliders = []; this._bodies = []; this._mediums = []
  }
}

// Накопленная система координат сущности: world = R·local + t.
// У дочерней она равна произведению переносов всех предков, поэтому данные
// сущности всегда читаются как координаты «от родителя».
const IDENT = { c: 1, s: 0, x: 0, y: 0 }
const composeX = (m2, m1) => ({
  c: m2.c * m1.c - m2.s * m1.s,
  s: m2.s * m1.c + m2.c * m1.s,
  x: m2.c * m1.x - m2.s * m1.y + m2.x,
  y: m2.s * m1.x + m2.c * m1.y + m2.y,
})
const asMatrix = (t) => ({
  c: t.co, s: t.si,
  x: t.bx - (t.co * t.ax - t.si * t.ay),
  y: t.by - (t.si * t.ax + t.co * t.ay),
})

// набор опорных координат сущности: точки + вершины её коллайдеров
function frameOf(inst) {
  const out = []
  for (const p of inst.ctx.owned.points) out.push(p.x, p.y)
  for (const c of inst.ctx.owned.colliders) for (const q of c.points) out.push(q[0], q[1])
  // источник притяжения — тоже геометрия сущности: иначе у сущности без точек
  // и коллайдеров не было бы своей системы координат и её нельзя было бы возить
  for (const w of inst.ctx.owned.wells) out.push(w.x, w.y)
  return out
}

// оптимальные поворот и сдвиг между двумя наборами координат
function transformOf(prev, cur) {
  const n = prev.length / 2
  if (!n || prev.length !== cur.length) return null
  let ax = 0, ay = 0, bx = 0, by = 0
  for (let i = 0; i < n; i++) { ax += prev[i * 2]; ay += prev[i * 2 + 1]; bx += cur[i * 2]; by += cur[i * 2 + 1] }
  ax /= n; ay /= n; bx /= n; by /= n
  let num = 0, den = 0
  for (let i = 0; i < n; i++) {
    const px = prev[i * 2] - ax, py = prev[i * 2 + 1] - ay
    const qx = cur[i * 2] - bx, qy = cur[i * 2 + 1] - by
    num += px * qy - py * qx
    den += px * qx + py * qy
  }
  const th = n > 1 ? Math.atan2(num, den) : 0
  if (Math.abs(bx - ax) < 1e-9 && Math.abs(by - ay) < 1e-9 && Math.abs(th) < 1e-9) return null
  return { ax, ay, bx, by, co: Math.cos(th), si: Math.sin(th) }
}

function applyTransform(inst, t, dt = 1 / 60) {
  const carryPoints = !inst.bound
  const map = (x, y) => {
    const dx = x - t.ax, dy = y - t.ay
    return [t.bx + dx * t.co - dy * t.si, t.by + dx * t.si + dy * t.co]
  }
  if (carryPoints) {
    for (const p of inst.ctx.owned.points) {
      const [x, y] = map(p.x, p.y)
      // Возить — значит переставлять, и скорость при этом надо сообщать, а не
      // получать побочно. Прежде для этого приходилось двигать «прошлое
      // положение» и заводить отдельное поле kx/ky, потому что у закреплённой
      // точки положений два, а скорости не было ни одной.
      p.vx = (x - p.x) / dt
      p.vy = (y - p.y) / dt
      p.x = x; p.y = y; p.sx = x; p.sy = y
    }
  }
  for (const c of inst.ctx.owned.colliders) {
    if (c.dynamic) continue // живая геометрия и так следует за своими точками
    for (const ring of c.rings || [c.points]) {
      for (const q of ring) { const [x, y] = map(q[0], q[1]); q[0] = x; q[1] = y }
    }
    c.bbox = bboxOfPoints(c.rings ? c.rings.flat() : c.points)
  }
  for (const w of inst.ctx.owned.wells) { const [x, y] = map(w.x, w.y); w.x = x; w.y = y }
}

function depth(inst, world, guard = 0) {
  if (!inst.parent || guard > 32) return 0
  const p = world.instances.find((i) => i.id === inst.parent)
  return p ? 1 + depth(p, world, guard + 1) : 0
}

export class World {
  constructor(level) {
    this.level = level
    this.bounds = { x: 0, y: 0, w: level.width || 1600, h: level.height || 900 }
    this.physics = new Physics({ gravity: level.gravity || { x: 0, y: 1800 }, bounds: this.bounds })
    this.instances = []
    this.time = 0
    this._listeners = {}
    this._drag = null
    this.pointer = null
    this.signals = new Map()
    this.sharedStore = new Map()
    this.frame = 0
    this.missing = []   // типы, которых нет в сборке — уровень их не потерял, но и не показал
    for (const e of level.entities || []) this.spawn(e.type, e.data, e.id, e.parent)
  }

  shared(name, factory, ownerId) {
    let e = this.sharedStore.get(name)
    if (!e) { e = { value: factory(), owners: new Set() }; this.sharedStore.set(name, e) }
    e.owners.add(ownerId)
    return e.value
  }

  // Заглянуть в общую среду, не заводя её и не становясь владельцем. Нужно
  // тем, кто хочет учесть чужую среду, если она есть, но не обязан её
  // создавать: воздух спрашивает про воду, вода — про воздух, и ни один из
  // них не тянет за собой второго.
  sharedPeek(name) {
    const e = this.sharedStore.get(name)
    return e ? e.value : null
  }

  releaseShared(ownerId) {
    for (const [k, e] of this.sharedStore) {
      e.owners.delete(ownerId)
      if (!e.owners.size) this.sharedStore.delete(k)
    }
  }

  setSignal(name, value) {
    if (!name) return
    if (this.signals.get(name) === value) return
    this.signals.set(name, value)
    this.emit(EVENTS.signal, { name, value })
  }

  on(name, fn) {
    (this._listeners[name] ||= []).push(fn)
    return () => { this._listeners[name] = this._listeners[name].filter((f) => f !== fn) }
  }
  emit(name, payload) { for (const fn of this._listeners[name] || []) fn(payload) }

  spawn(type, data, id, parent = null) {
    const def = getEntity(type)
    if (!def) {
      // молча терять часть уровня нельзя: сообщаем наверх
      if (!this.missing.includes(type)) this.missing.push(type)
      this.emit(EVENTS.missing, { type, id })
      return null
    }
    const inst = {
      id: id || newId(type + '-'),
      type, def, parent,
      data: structuredClone(data ?? def.defaults()),
      rt: null,
    }
    inst.xform = { ...IDENT }
    inst.ctx = new EntityContext(this, inst)
    inst.rt = (def.spawn ? def.spawn(inst.ctx, inst.data) : null) || {}
    inst.frame = frameOf(inst)
    this.instances.push(inst)
    this._bind(inst)
    // дети, созданные раньше родителя, прирастают только сейчас
    for (const child of this.instances) if (child.parent === inst.id && !child.bound) this._bind(child)
    return inst
  }

  despawn(inst) {
    this._unbind(inst)
    for (const child of this.instances) if (child.parent === inst.id) { this._unbind(child); child.parent = null }
    inst.ctx.destroy()
    const i = this.instances.indexOf(inst)
    if (i >= 0) this.instances.splice(i, 1)
    if (this._drag === inst) this._drag = null
  }

  step(dt) {
    // сначала сущности выставляют силы и своё состояние, потом мир их интегрирует
    this.time += dt
    this.frame++
    for (const inst of [...this.instances]) {
      inst.def.update?.(inst.rt, inst.ctx, dt, inst.data)
    }
    this.physics.step(dt)
    this._carry(dt)
  }

  // Дочерние сущности едут вместе с родительскими: берём сдвиг и поворот
  // родителя за кадр и применяем к геометрии ребёнка. Мир при этом не знает,
  // что за сущности он таскает — только их точки и коллайдеры.
  _carry(dt) {
    const order = [...this.instances].sort((a, b) => depth(a, this) - depth(b, this))
    const deltas = new Map()
    for (const inst of order) {
      const t = inst.parent ? deltas.get(inst.parent) : null
      if (t) {
        applyTransform(inst, t, dt)
        inst.xform = composeX(asMatrix(t), inst.xform)
      }
      // полное перемещение за кадр = собственное плюс унаследованное
      deltas.set(inst.id, transformOf(inst.frame, frameOf(inst)))
      inst.frame = frameOf(inst)
    }
  }

  // Сращивание с родителем. Если у родителя есть жёсткое тело, точки ребёнка
  // прирастают к нему: тогда усилие идёт в обе стороны — потянув за ребёнка,
  // можно поднять родителя. Если тела нет, ребёнка просто возит _carry().
  // Всё дерево привязок — одна сборка: её части не сталкиваются между собой,
  // поэтому шар, утопленный в объекте, не выстреливает.
  _regroup(inst) {
    let root = inst, guard = 0
    while (root.parent && guard++ < 32) {
      const up = this.instances.find((i) => i.id === root.parent)
      if (!up) break
      root = up
    }
    const g = root.id
    for (const p of inst.ctx.owned.points) p.group = g
    for (const c of inst.ctx.owned.colliders) c.group = g
  }

  _bind(inst) {
    this._regroup(inst)
    if (!inst.parent) return
    const parent = this.instances.find((i) => i.id === inst.parent)
    const body = parent?.ctx.owned.bodies[0]
    const points = inst.ctx.owned.points
    if (body && points.length) {
      this.physics.attachToBody(body, points)
      inst.bound = body
      return
    }
    // У родителя нет тела — значит ребёнка просто возят. Тогда он кинематический:
    // собственная физика его больше не двигает, иначе он «сползает» с траектории.
    for (const p of points) {
      if (p.carried) continue
      p.carried = true
      p.pinnedBefore = p.pinned
      p.pinned = true
      p.vx = 0; p.vy = 0   // закреплённая точка везёт свою скорость снаружи
    }
  }

  _unbind(inst) {
    if (inst.bound) { this.physics.detachFromBody(inst.bound, inst.ctx.owned.points); inst.bound = null }
    for (const p of inst.ctx.owned.points) {
      if (!p.carried) continue
      p.pinned = p.pinnedBefore
      p.carried = false
    }
    for (const p of inst.ctx.owned.points) p.group = inst.id
    for (const c of inst.ctx.owned.colliders) c.group = inst.id
  }

  setParent(inst, parentId) {
    this._unbind(inst)
    inst.parent = parentId || null
    inst.frame = frameOf(inst)
    this._bind(inst)
  }

  scene() {
    return composeShapes(this.instances)
  }

  // Ввод: мир не знает, кто как реагирует — просто спрашивает сущности.
  // Если попали в несколько, берём того, у кого выше pointer.priority,
  // затем выше слой отрисовки, затем кто создан позже.
  pointerDown(pt) {
    let best = null, key = -Infinity
    for (let i = 0; i < this.instances.length; i++) {
      const it = this.instances[i]
      if (!it.def.pointer?.hit?.(it.rt, it.ctx, pt, it.data)) continue
      const k = (it.def.pointer.priority ?? 0) * 1e6 + (it.def.z || 0) * 1e3 + i
      if (k > key) { key = k; best = it }
    }
    if (!best) return false
    this._drag = best
    best.def.pointer.down?.(best.rt, best.ctx, pt, best.data)
    return true
  }
  pointerMove(pt) {
    this.pointer = pt
    const it = this._drag
    if (it) it.def.pointer?.move?.(it.rt, it.ctx, pt, it.data)
  }
  pointerHover(pt) { this.pointer = pt }
  pointerUp(pt) {
    const it = this._drag
    if (!it) return
    this._drag = null
    it.def.pointer?.up?.(it.rt, it.ctx, pt, it.data)
  }
}
