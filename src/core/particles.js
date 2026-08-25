// Хранилище частиц.
//
// ЗАЧЕМ ЭТО ПОЯВИЛОСЬ
//
// Пока мир состоит из двух десятков шаров, частица может быть объектом: читаемо,
// удобно, дёшево. У среды частиц тысячи, и объект перестаёт быть бесплатным —
// каждый проход решателя гоняет указатели по куче вместо того, чтобы идти по
// памяти подряд. А проходов у PBF на подшаг не один: плотность, поправка,
// вязкость, завихрение.
//
// Поэтому состояние лежит в типизированных массивах (SoA), а объект остаётся
// только там, где он и нужен, — у игровых точек, которые сущности держат в руках
// и вешают на них свои поля. Ручка (Point) не хранит ничего: её x/y — это
// аксессоры в те же массивы. Частицы среды ручек не получают вовсе, поэтому
// пять тысяч воды не создают ни одного объекта и не попадают в ctx.points.
//
// Индекс частицы не вечен: удаление переставляет последнюю на её место
// (swap-remove), чтобы массивы оставались плотными. Ручка при этом переезжает
// вместе с данными, поэтому снаружи ничего не видно.

// --- флаги (SoA-поле flags) --------------------------------------------------
export const F_PINNED = 1 << 0 // закреплена: обратная масса ноль, не интегрируется
export const F_WORLD = 1 << 1 // сталкивается со статической геометрией
export const F_POINTS = 1 << 2 // сталкивается с другими телами
export const F_LIFT = 1 << 3 // отрицательный вес: подъёмная сила

const F32 = ['x', 'y', 'sx', 'sy', 'vx', 'vy', 'w', 'mass', 'radius',
  'gscale', 'rest', 'smooth', 'ax', 'ay', 'spin', 'angle',
  'dx', 'dy', 'lamN']
const I32 = ['flags', 'group', 'rigid', 'nc']

const MIN_MASS = 0.05

// Группы (сборки) снаружи — строки id инстанса. В горячем цикле сравнивать
// строки нельзя, поэтому они интернируются в числа. Ноль — «без группы».
class Interner {
  constructor() { this.map = new Map([[null, 0]]); this.list = [null] }
  id(key) {
    if (key == null) return 0
    let v = this.map.get(key)
    if (v === undefined) { v = this.list.length; this.list.push(key); this.map.set(key, v) }
    return v
  }
  key(id) { return this.list[id] ?? null }
}

export class ParticleStore {
  constructor(cap = 512) {
    this.n = 0
    this.cap = 0
    this.gen = 0 // растёт при добавлении/удалении: по нему пересобираются кэши
    this.groups = new Interner()
    this.handle = [] // ручка или null, параллельно индексу
    this._grow(cap)
  }

  _grow(cap) {
    if (cap <= this.cap) return
    let c = Math.max(cap, 64)
    c = 1 << (32 - Math.clz32(c - 1))
    for (const f of F32) {
      const a = new Float32Array(c)
      if (this[f]) a.set(this[f])
      this[f] = a
    }
    for (const f of I32) {
      const a = new Int32Array(c)
      if (this[f]) a.set(this[f])
      this[f] = a
    }
    this.cap = c
  }

  // Сырое добавление. Возвращает индекс; ручку навешивает тот, кому она нужна.
  alloc() {
    if (this.n >= this.cap) this._grow(this.n + 1)
    const i = this.n++
    this.gen++
    this.handle[i] = null
    this.x[i] = 0; this.y[i] = 0; this.sx[i] = 0; this.sy[i] = 0
    this.vx[i] = 0; this.vy[i] = 0
    this.w[i] = 1; this.mass[i] = 1; this.radius[i] = 8
    this.gscale[i] = 1; this.rest[i] = 0.2; this.smooth[i] = 0.5
    this.ax[i] = 0; this.ay[i] = 0; this.spin[i] = 0; this.angle[i] = 0
    this.dx[i] = 0; this.dy[i] = 0; this.lamN[i] = 0
    this.flags[i] = F_WORLD | F_POINTS
    this.group[i] = 0; this.rigid[i] = 0; this.nc[i] = 0
    return i
  }

  // Удаление переставляет последнюю частицу на освободившееся место.
  free(i) {
    const last = --this.n
    if (i !== last) {
      for (const f of F32) this[f][i] = this[f][last]
      for (const f of I32) this[f][i] = this[f][last]
      const h = this.handle[last]
      this.handle[i] = h
      if (h) h._i = i
    }
    this.handle[last] = null
    this.gen++
  }

  // --- то, что нужно всем модулям сразу ------------------------------------
  setMass(i, m) {
    const lift = m < 0
    const mm = Math.max(Math.abs(m), MIN_MASS)
    this.mass[i] = mm
    // Знак веса — это направление тяжести, а не масса: инерция остаётся
    // прежней, переворачивается только гравитация.
    this.gscale[i] = lift ? -1 : 1
    this.flags[i] = lift ? this.flags[i] | F_LIFT : this.flags[i] & ~F_LIFT
    this.w[i] = this.flags[i] & F_PINNED ? 0 : 1 / mm
  }

  setPinned(i, on) {
    if (on) {
      this.flags[i] |= F_PINNED
      this.w[i] = 0
      this.vx[i] = 0; this.vy[i] = 0
    } else {
      this.flags[i] &= ~F_PINNED
      this.w[i] = 1 / this.mass[i]
    }
  }

  // Аккумулятор Якоби. Ничем в ядре пока не используется: связи, форма и
  // контакты решаются по Гауссу — Зейделю (правим на месте, следующий видит
  // исправленное), и для них это правильный выбор.
  //
  // Он здесь ради ограничений, которые связывают частицу не с одной другой, а
  // со всем окружением сразу, — плотность среды прежде всего. Для таких
  // «на месте» не годится: результат зависел бы от порядка обхода, а порядок у
  // частиц случайный. Тогда проход делается двухфазным: сначала ВСЕ считают
  // поправку через accum(), потом ВСЕ сдвигаются через flushList().
  accum(i, ddx, ddy) { this.dx[i] += ddx; this.dy[i] += ddy; this.nc[i]++ }

  // relax < 1 — ослабление. Полная якобиева поправка перелетает и раскачивает
  // сама себя, поэтому её всегда дают долей.
  flushList(ids, count, relax = 1) {
    for (let k = 0; k < count; k++) {
      const i = ids[k]
      if (!this.nc[i] || !this.w[i]) { this.dx[i] = 0; this.dy[i] = 0; this.nc[i] = 0; continue }
      this.x[i] += this.dx[i] * relax
      this.y[i] += this.dy[i] * relax
      this.dx[i] = 0; this.dy[i] = 0; this.nc[i] = 0
    }
  }
}

// --- ручка ------------------------------------------------------------------
// Обычный объект: сущность может вешать на него свои поля (carried, pinnedBefore
// и что угодно ещё), а x/y/mass/… читаются и пишутся прямо в SoA.

class Collision {
  constructor(h) { this._h = h }
  get world() { return (this._h._s.flags[this._h._i] & F_WORLD) !== 0 }
  set world(v) { this._h._bit(F_WORLD, v) }
  get points() { return (this._h._s.flags[this._h._i] & F_POINTS) !== 0 }
  set points(v) { this._h._bit(F_POINTS, v) }
}

let UID = 1

export class Point {
  constructor(store, i, id) {
    // Хранилище и индекс — служебные и НЕПЕРЕЧИСЛИМЫЕ: сущность видит про чужое
    // тело ровно то, что перечислено в globals, и внутренности ядра туда
    // попадать не должны (за этим следит tests/contract.mjs).
    Object.defineProperty(this, '_s', { value: store, writable: true })
    Object.defineProperty(this, '_i', { value: i, writable: true })
    this.id = id || 'p' + UID++
    this.links = []
    this.removed = false
    this.collision = new Collision(this)
  }
  _bit(mask, on) {
    const s = this._s
    if (on) s.flags[this._i] |= mask
    else s.flags[this._i] &= ~mask
  }
}

const acc = (name, field) => Object.defineProperty(Point.prototype, name, {
  get() { return this._s[field][this._i] },
  set(v) { this._s[field][this._i] = v },
})
acc('x', 'x'); acc('y', 'y'); acc('sx', 'sx'); acc('sy', 'sy')
acc('vx', 'vx'); acc('vy', 'vy'); acc('radius', 'radius')
acc('restitution', 'rest'); acc('smoothness', 'smooth')
acc('spin', 'spin'); acc('angle', 'angle')
acc('gravityScale', 'gscale')

Object.defineProperties(Point.prototype, {
  index: { get() { return this._i } },
  mass: {
    get() { return this._s.mass[this._i] },
    set(v) { this._s.setMass(this._i, v) },
  },
  pinned: {
    get() { return (this._s.flags[this._i] & F_PINNED) !== 0 },
    set(v) { this._s.setPinned(this._i, !!v) },
  },
  lift: {
    get() { return (this._s.flags[this._i] & F_LIFT) !== 0 },
    set(v) { this._bit(F_LIFT, v) },
  },
  rigid: {
    get() { return this._s.rigid[this._i] },
    set(v) { this._s.rigid[this._i] = v },
  },
  group: {
    get() { return this._s.groups.key(this._s.group[this._i]) },
    set(v) { this._s.group[this._i] = this._s.groups.id(v) },
  },
})
