import { Physics } from './verlet.js'
import { getEntity } from './registry.js'
import { closestOnSegment, pointInPoly } from './geom.js'
import { composeShapes } from './scene.js'

let UID = 1
export const newId = (prefix = 'e') => `${prefix}${UID++}${Math.random().toString(36).slice(2, 6)}`

// Фасад мира для сущности. Сущность видит только глобальные свойства чужих тел:
// radius / mass / restitution / smoothness / collision / attachable / suction.
// Тип и данные чужой сущности отсюда недоступны.
class EntityContext {
  constructor(world, inst) {
    this.world = world
    this.id = inst.id
    this._inst = inst
    this._points = []
    this._links = []
    this._colliders = []
  }

  get gravity() { return this.world.physics.gravity }
  get time() { return this.world.time }
  get bounds() { return this.world.bounds }
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
  removePoint(p) { this.world.physics.removePoint(p) }
  removeLink(l) { this.world.physics.removeLink(l) }
  applyAccel(p, ax, ay) { this.world.physics.applyAccel(p, ax, ay) }

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
    for (const c of this.world.physics.colliders) if (pointInPoly(x, y, c.points)) return true
    return false
  }

  // Кратчайший путь по графу связей до любой точки, удовлетворяющей pred.
  pathFrom(start, pred) {
    if (pred(start)) return [start]
    const prev = new Map([[start, null]])
    const queue = [start]
    while (queue.length) {
      const cur = queue.shift()
      for (const l of cur.links) {
        const nx = l.a === cur ? l.b : l.a
        if (prev.has(nx)) continue
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
        if (pointInPoly(x, y, c.points)) return true
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

  destroy() {
    for (const l of this._links) this.world.physics.removeLink(l)
    for (const p of this._points) this.world.physics.removePoint(p)
    for (const c of this._colliders) this.world.physics.removeCollider(c)
    this._links = []; this._points = []; this._colliders = []
  }
}

export class World {
  constructor(level) {
    this.level = level
    this.bounds = { x: 0, y: 0, w: level.width || 1600, h: level.height || 900 }
    this.physics = new Physics({ gravity: level.gravity || { x: 0, y: 1800 } })
    this.instances = []
    this.time = 0
    this._listeners = {}
    this._drag = null
    for (const e of level.entities || []) this.spawn(e.type, e.data, e.id)
  }

  on(name, fn) {
    (this._listeners[name] ||= []).push(fn)
    return () => { this._listeners[name] = this._listeners[name].filter((f) => f !== fn) }
  }
  emit(name, payload) { for (const fn of this._listeners[name] || []) fn(payload) }

  spawn(type, data, id) {
    const def = getEntity(type)
    if (!def) { console.warn('Неизвестная сущность:', type); return null }
    const inst = {
      id: id || newId(type + '-'),
      type, def,
      data: structuredClone(data ?? def.defaults()),
      rt: null,
    }
    inst.ctx = new EntityContext(this, inst)
    inst.rt = (def.spawn ? def.spawn(inst.ctx, inst.data) : null) || {}
    this.instances.push(inst)
    return inst
  }

  despawn(inst) {
    inst.ctx.destroy()
    const i = this.instances.indexOf(inst)
    if (i >= 0) this.instances.splice(i, 1)
    if (this._drag === inst) this._drag = null
  }

  step(dt) {
    // сначала сущности выставляют силы и своё состояние, потом мир их интегрирует
    this.time += dt
    for (const inst of [...this.instances]) {
      inst.def.update?.(inst.rt, inst.ctx, dt, inst.data)
    }
    this.physics.step(dt)
  }

  scene() {
    return composeShapes(this.instances)
  }

  // Ввод: мир не знает, кто как реагирует — просто спрашивает сущности.
  pointerDown(pt) {
    for (let i = this.instances.length - 1; i >= 0; i--) {
      const it = this.instances[i]
      if (it.def.pointer?.hit?.(it.rt, it.ctx, pt, it.data)) {
        this._drag = it
        it.def.pointer.down?.(it.rt, it.ctx, pt, it.data)
        return true
      }
    }
    return false
  }
  pointerMove(pt) {
    const it = this._drag
    if (it) it.def.pointer?.move?.(it.rt, it.ctx, pt, it.data)
  }
  pointerUp(pt) {
    const it = this._drag
    if (!it) return
    this._drag = null
    it.def.pointer?.up?.(it.rt, it.ctx, pt, it.data)
  }
}
