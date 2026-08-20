// Собственный решатель. Знает только о глобальных свойствах (см. core/globals.js)
// и ничего — о сущностях.
//
// ЧЕМ ЭТО ОТЛИЧАЕТСЯ ОТ ПРЕЖНЕГО ВЕРЛЕ И ЗАЧЕМ
//
// В верле скорости нет: она вычисляется как разность двух положений, x − px.
// Пока мир состоит из палок и шаров, это удобно — любая позиционная поправка
// сама превращается в изменение скорости, и импульс сохраняется даром. Но у
// такой записи есть обратная сторона: НЕЛЬЗЯ подвинуть тело, не разогнав его.
//
// Для среды этого мало сразу по трём причинам.
//
// Первая: единицы. x − px — это смещение за подшаг, а не px/с. Вязкость, возврат
// объёма, сопротивление воздуха приходится задавать в долях на подшаг, и их сила
// молча меняется вместе с частотой подшагов.
//
// Вторая: APIC. Частица среды несёт не только скорость, но и аффинную часть поля
// вокруг себя — матрицу 2×2 (см. core/fluid.js). Приделать её не к чему, если
// «скорость» меняется от каждой позиционной поправки: C перестаёт соответствовать v.
//
// Третья: порядок. Проекция давления обязана считаться ДО переноса, по скоростям,
// уже получившим тяжесть, — иначе гидростатика уравновешивается с отставанием на
// подшаг. В верле проекции просто некуда встать: скорости как отдельной величины,
// которую можно поправить, не существует.
//
// Поэтому здесь скорость — состояние:
//
//   p.vx, p.vy   настоящая скорость, px/с, не зависит от величины подшага
//   p.sx, p.sy   положение в начале подшага (служебное)
//
// Позиционные ограничения решаются по-прежнему (XPBD), и в конце подшага скорость
// берётся как (x − sx)/h — то есть всякая поправка переносит импульс, ровно как в
// верле. Отдельного сорта «поправка без импульса» здесь НЕТ, и попытка его завести
// описана в шаге 5: она стоила дорого.

import { clamp, closestOnSegment, closestOnSegmentInto, insideRegion, ringsOf, bboxOfRings } from './geom.js'
import { PointGrid, EdgeIndex, PAIRS_MIN, EDGES_MIN } from './grid.js'
import { Fluid } from './fluid.js'
import { GravityField } from './field.js'

let UID = 1
const SOLID_CELL = 96
const nid = (p) => p + UID++

// Во сколько раз сопротивление качению меньше трения скольжения при той же
// шершавости. У катка по грунту это примерно одна десятая, у стального шара
// по стали — на два порядка меньше; берём середину и позволяем гладкости
// поверхности развести эти случаи.
const ROLL_RESIST = 0.08

export class Physics {
  constructor(opts = {}) {
    // Гравитация — поле, а не вектор: однородная составляющая уровня плюс
    // сколько угодно источников притяжения (см. core/field.js).
    this.field = new GravityField({ x: 0, y: 1800, ...(opts.gravity || {}) })
    this._g = { x: 0, y: 0 }
    this.grid = new PointGrid()   // широкая фаза: кто с кем вообще может встретиться
    this._push = (a, b) => this._pushApart(a, b)
    this._skip = (p) => this._needsPairs(p)
    this._solidCells = new Set()
    this.fluid = new Fluid(this)   // среда: объём без формы (см. core/fluid.js)
    this._seg = { x: 0, y: 0, t: 0 }                       // рабочие объекты контакта:
    this._hit = { q: null, x: 0, y: 0, qx: 0, qy: 0, d: 0, edge: 0, t: 0 }  // создавать их в цикле дорого
    // Сопротивление среды — теперь скорость затухания в 1/с, а не множитель на
    // подшаг: v ← v·e^(−drag·h). От величины подшага результат больше не зависит.
    this.drag = opts.drag ?? 0.072
    this.iterations = opts.iterations ?? 3
    this.fixed = 1 / 120
    this.maxSub = 8
    this._acc = 0

    this.points = []
    this.links = []
    this.colliders = []
    this.bodies = []
  }

  // Прежняя настройка задавалась множителем на подшаг 1/120. Оставляем вход,
  // но переводим в скорость затухания: уровни и проверки не переписывать.
  get damping() { return Math.exp(-this.drag / 120) }
  set damping(v) { this.drag = v > 0 && v < 1 ? -Math.log(v) * 120 : 0 }

  // Однородная составляющая поля. Раньше это была вся гравитация целиком,
  // поэтому имя осталось прежним: уровень задаёт её одним вектором.
  get gravity() { return this.field.uniform }
  set gravity(v) { this.field.uniform = { x: v?.x || 0, y: v?.y || 0 } }

  // ---- источники притяжения ------------------------------------------------
  addWell(o) { return this.field.add(o) }
  removeWell(w) { this.field.remove(w) }
  // Ускорение свободного падения именно здесь — «низ» у каждой точки свой
  gravityAt(x, y, out) { return this.field.at(x, y, out) }

  // ---- точки ---------------------------------------------------------------
  addPoint(o = {}) {
    const x = o.x || 0
    const y = o.y || 0
    // отрицательный вес — это подъёмная сила: инерция остаётся, гравитация переворачивается
    let mass = o.mass ?? 1
    let gravityScale = o.gravityScale ?? 1
    if (mass < 0) { gravityScale = -gravityScale; mass = -mass }
    mass = Math.max(mass, 0.05)
    const p = {
      id: nid('p'),
      x, y,
      vx: o.vx || 0, vy: o.vy || 0,   // скорость, px/с — состояние, а не разность
      sx: x, sy: y,   // где точка была в начале подшага
      ax: 0, ay: 0,   // ускорение от сущностей (живёт весь кадр)
      fx: 0, fy: 0,   // сила от связей (пересчитывается каждый подшаг)
      cn: 0,          // нормальный импульс контакта за подшаг, px/с
      // глобальные свойства
      radius: o.radius ?? 8,
      mass,
      lift: (o.mass ?? 1) < 0,
      restitution: o.restitution ?? 0.2,   // упругость
      smoothness: o.smoothness ?? 0.5,     // гладкость: 1 — лёд, 0 — липучка
      collision: {                         // коллизия
        world: o.collision?.world ?? true, // со статической геометрией
        points: o.collision?.points ?? true, // с другими точками
        // Со средой отношения отдельные. Ходячий шар нарочно проходит сквозь
        // других шаров — но не сквозь воду: «не толкаться» и «не тонуть» это
        // разные вещи, и одним флагом их путать нельзя.
        fluid: o.collision?.fluid ?? true,
      },
      attachable: o.attachable ?? false,   // можно ли прилепить связь
      phase: o.phase || 0,                 // вещество: 0 — обычное тело, иначе среда (см. core/fluid.js)
      suction: o.suction ?? 0,             // всасывание
      // Аффинная часть скорости частицы среды (APIC): два градиента поля
      // скоростей, по одному на составляющую. Обычному телу не нужны и остаются
      // нулями. Именно они несут вращение и сдвиг ВНУТРИ клетки, которые прежде
      // терялись при переносе на сетку и обратно.
      cux: 0, cuy: 0, cvx: 0, cvy: 0,
      // Точка — это диск радиуса radius, а у диска есть момент инерции ½mr².
      // Поэтому трение её крутит: spin — угловая скорость (рад/с),
      // angle — накопленный поворот. Отдельного «умеет катиться» нет: катится
      // всё круглое. Не крутится в одиночку только вершина жёсткого тела —
      // за её вращение отвечает само тело (см. rigid).
      spin: 0,
      angle: 0,
      rigid: 0,   // в скольких жёстких телах состоит: пока состоит — сама не крутится
      pinned: !!o.pinned,
      gravityScale,
      owner: o.owner || null,              // id инстанса-владельца
      group: o.group || o.owner || null,   // сборка: внутри неё не сталкиваются
      links: [],
      removed: false,
    }
    this.points.push(p)
    return p
  }

  removePoint(p) {
    if (!p || p.removed) return
    for (const b of this.bodies) if (b.verts.includes(p)) this.detachFromBody(b, [p])
    for (const l of [...p.links]) this.removeLink(l)
    p.removed = true
    const i = this.points.indexOf(p)
    if (i >= 0) this.points.splice(i, 1)
  }

  applyAccel(p, ax, ay) { p.ax += ax; p.ay += ay }

  // Скорость теперь можно задать прямо — раньше для этого приходилось двигать
  // «прошлое положение», и телепорт был неотличим от разгона.
  setVelocity(p, vx, vy) { p.vx = vx; p.vy = vy }
  addImpulse(p, ix, iy) { if (!p.pinned) { p.vx += ix / p.mass; p.vy += iy / p.mass } }
  // Переставить тело, не разгоняя его: положение меняется, скорость — нет.
  place(p, x, y, keepVelocity = false) {
    p.x = x; p.y = y; p.sx = x; p.sy = y
    if (!keepVelocity) { p.vx = 0; p.vy = 0 }
  }
  // Закрепить/отпустить. Закреплённая точка не интегрируется, её скорость —
  // то, что ей задали снаружи; поэтому при закреплении её надо обнулить, иначе
  // трение о неё будет тащить груз по памяти о прошлом движении.
  setPinned(p, on) {
    p.pinned = !!on
    if (on) { p.vx = 0; p.vy = 0 }
  }

  // Вес можно менять по ходу игры; знак так же означает подъёмную силу
  setMass(p, m) {
    p.lift = m < 0
    p.mass = Math.max(Math.abs(m), 0.05)
    p.gravityScale = p.lift ? -1 : 1
  }

  // Вращение можно задать снаружи: живое тело держит себя само — ползущий шар
  // упирается и не катится, хотя круглый. Это его дело, а не свойство физики.
  // Угловая скорость в рад/с, как и всё остальное.
  setSpin(p, w) { p.spin = w }

  // ---- связи ---------------------------------------------------------------
  addLink(a, b, o = {}) {
    const l = {
      id: nid('l'), a, b,
      rest: o.rest ?? Math.hypot(a.x - b.x, a.y - b.y),
      spring: o.spring ?? 2500,        // сила на пиксель растяжения
      damping: clamp(o.damping ?? 0.2, 0, 1), // доля гасимой скорости вдоль связи
      breakForce: o.breakForce ?? Infinity,   // рвётся, когда натяжение превысит порог
      lambda: 0,                       // множитель ограничения за подшаг
      tension: 0,                      // натяжение (сила), сглаженное
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

  // ---- жёсткая форма (вращается) -------------------------------------------
  // Подгонка формы: каждый подшаг ищем оптимальные поворот и сдвиг исходной
  // формы и подтягиваем к ним вершины. Даёт настоящее твёрдое тело с вращением,
  // не засоряя граф связей.
  addBody(o = {}) {
    const verts = [...(o.points || [])]  // своя копия: тело может дорастать
    let cx = 0, cy = 0, m = 0
    for (const p of verts) { cx += p.x * p.mass; cy += p.y * p.mass; m += p.mass }
    if (m) { cx /= m; cy /= m }
    const b = {
      id: nid('b'),
      verts,
      rest: verts.map((p) => ({ x: p.x - cx, y: p.y - cy })),
      stiffness: clamp(o.stiffness ?? 1, 0, 1),
      removed: false,
    }
    for (const p of verts) p.rigid++
    this.bodies.push(b)
    return b
  }

  // Прирастить точки к телу: их текущее расположение становится частью формы
  attachToBody(b, points) {
    if (!b || !points.length) return
    for (const p of points) if (!b.verts.includes(p)) { b.verts.push(p); p.pinned = false; p.rigid++ }
    let cx = 0, cy = 0, m = 0
    for (const p of b.verts) { cx += p.x * p.mass; cy += p.y * p.mass; m += p.mass }
    if (!m) return
    cx /= m; cy /= m
    b.rest = b.verts.map((p) => ({ x: p.x - cx, y: p.y - cy }))
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

  _solveBodies() {
    for (const b of this.bodies) {
      const n = b.verts.length
      if (n < 2) continue
      let cx = 0, cy = 0, m = 0
      for (const p of b.verts) { cx += p.x * p.mass; cy += p.y * p.mass; m += p.mass }
      if (!m) continue
      cx /= m; cy /= m
      let num = 0, den = 0
      for (let i = 0; i < n; i++) {
        const q = b.rest[i], p = b.verts[i]
        const dx = p.x - cx, dy = p.y - cy
        num += q.x * dy - q.y * dx
        den += q.x * dx + q.y * dy
      }
      const th = Math.atan2(num, den)
      const co = Math.cos(th), si = Math.sin(th)
      for (let i = 0; i < n; i++) {
        const p = b.verts[i]
        if (p.pinned) continue
        const q = b.rest[i]
        const gx = cx + q.x * co - q.y * si
        const gy = cy + q.x * si + q.y * co
        p.x += (gx - p.x) * b.stiffness
        p.y += (gy - p.y) * b.stiffness
      }
    }
  }

  // ---- статическая геометрия ----------------------------------------------
  addCollider(o = {}) {
    const c = {
      id: nid('c'),
      verts: o.verts ? [...o.verts] : null,        // если заданы — геометрия живая
      points: o.verts ? o.verts.map((p) => [p.x, p.y]) : (o.points || []),
      polys: null,                                  // мультиполигон: область может быть с дырками
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

  // Заменить область коллайдера (песок после раскопки, разрушаемая стена и т. д.)
  setRegion(c, polys) {
    c.polys = polys
    c.rings = ringsOf(polys)
    c.points = c.rings[0] || []
    c.bbox = bboxOfRings(c.rings)
    // У песка после раскопки кольца бывают на сотни вершин — тогда границу
    // индексируем. Восьми вершинам рельефа индекс дороже перебора.
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
    while (this._acc >= this.fixed && n < this.maxSub) {
      this._sub(this.fixed)
      this._acc -= this.fixed
      n++
    }
    if (n === this.maxSub) this._acc = 0
    for (const p of this.points) { p.ax = 0; p.ay = 0 }
  }

  // Подшаг. Порядок здесь и есть главная разница с верле: сначала силы кладутся
  // в скорость, потом среда решает несжимаемость ПО СКОРОСТЯМ, и только затем
  // перенос и позиционные ограничения.
  _sub(h) {
    const g = this._g
    const kd = Math.exp(-this.drag * h)

    // 1. силы → скорость. Закреплённую не трогаем: её скорость задают снаружи.
    for (const p of this.points) {
      if (p.pinned) continue
      // поле спрашиваем в том месте, где точка сейчас: у каждой свой «низ»
      this.field.at(p.x, p.y, g)
      p.vx = (p.vx + (g.x * p.gravityScale + p.ax) * h) * kd
      p.vy = (p.vy + (g.y * p.gravityScale + p.ay) * h) * kd
    }

    // 2. среда: давление правит поле скоростей ДО переноса. Тяжесть уже внутри,
    //    поэтому гидростатика уравновешивается в этом же подшаге, а не следующем.
    const hasFluid = this.fluid.prepare()
    if (hasFluid) this.fluid.project(h)

    // 3. перенос
    for (const p of this.points) {
      p.sx = p.x; p.sy = p.y
      p.cn = 0
      if (p.pinned) continue
      p.x += p.vx * h
      p.y += p.vy * h
    }

    // 4. позиционные ограничения
    for (const l of this.links) l.lambda = 0
    this._rebuildGrid()
    for (let i = 0; i < this.iterations; i++) {
      this._solveLinks(h)
      this._solveBodies()
      this._solvePairs()
      if (hasFluid && i === 0) this.fluid.separate(2)
      this._syncColliders()
      this._collide(h, i === this.iterations - 1)
    }

    // 5. скорость из положений. Любая позиционная поправка — связь, контакт,
    //    расталкивание частиц среды — переносит импульс, как ей и полагается.
    //
    //    Здесь был отдельный канал «поправка, не несущая импульса»: она двигала
    //    тело, не меняя скорости. Заводился он ради среды — растаскивание частиц
    //    казалось обслуживанием дискретизации, которое решателю давления видеть
    //    нельзя. Оказалось, что это ошибка, и притом дорогая: кинетическая
    //    энергия при такой поправке сохраняется, а ПОТЕНЦИАЛЬНАЯ нет. Подняли
    //    частицу на пиксель против тяжести — энергия взялась из ниоткуда. Пока
    //    поправки мелки и симметричны, это шум; но у берега, срезающего клетку
    //    сетки наискось, перекос становится систематическим, и получается
    //    храповик: лужа медленно раскачивается и разбухает. Замер показал 6018
    //    из 6158 единиц лишней энергии именно на работе этих поправок против
    //    тяжести.
    //
    //    А нужен канал был только потому, что решатель давления работал неверно
    //    и растаскиванию приходилось держать вес. С правильным решателем стоячая
    //    вода не растаскивается вовсе: остаточная скорость 0.02 px/с.
    const inv = 1 / h
    for (const p of this.points) {
      if (p.pinned) continue
      p.vx = (p.x - p.sx) * inv
      p.vy = (p.y - p.sy) * inv
    }

    // 6. контакты по скорости: упругость, трение, качение
    this._contactVelocity(h)
    this._dampLinks()

    // 6a. накопленный поворот — чтобы вращение было видно на экране
    for (const p of this.points) {
      if (p.rigid || p.pinned) { p.spin = 0; continue }
      p.angle += p.spin * h
    }

    // 7. натяжение = сила в связи; сглаживаем, чтобы не рвать от случайного всплеска
    let broken = null
    const k = 1 / (h * h)
    for (const l of this.links) {
      const f = Math.max(0, -l.lambda * k)
      l.tension += (f - l.tension) * 0.05
      if (l.tension > l.breakForce) (broken ||= []).push(l)
    }
    if (broken) for (const l of broken) this.removeLink(l)
  }

  // Податливое ограничение (XPBD): позиционная коррекция с податливостью
  // 1/spring. Устойчиво при любой жёсткости, связь растягивается пропорционально
  // нагрузке, а lambda даёт настоящую силу.
  _solveLinks(h) {
    const inv = 1 / (h * h)
    for (const l of this.links) {
      const { a, b } = l
      const w1 = a.pinned ? 0 : 1 / a.mass
      const w2 = b.pinned ? 0 : 1 / b.mass
      const w = w1 + w2
      if (!w) continue
      const dx = b.x - a.x, dy = b.y - a.y
      const d = Math.hypot(dx, dy) || 1e-9
      const nx = dx / d, ny = dy / d
      const C = d - l.rest
      const alpha = inv / l.spring
      const dl = (-C - alpha * l.lambda) / (w + alpha)
      l.lambda += dl
      a.x -= nx * dl * w1; a.y -= ny * dl * w1
      b.x += nx * dl * w2; b.y += ny * dl * w2
    }
  }

  // Гашение — фильтр скорости, а не сила: не может накачать энергию.
  // Теперь буквально фильтр скорости, а не сдвиг «прошлого положения».
  _dampLinks() {
    for (const l of this.links) {
      if (!l.damping) continue
      const { a, b } = l
      const w1 = a.pinned ? 0 : 1 / a.mass
      const w2 = b.pinned ? 0 : 1 / b.mass
      const w = w1 + w2
      if (!w) continue
      const dx = b.x - a.x, dy = b.y - a.y
      const d = Math.hypot(dx, dy) || 1e-9
      const nx = dx / d, ny = dy / d
      const vrel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
      const k = l.damping * vrel
      a.vx += (k * nx * w1) / w; a.vy += (k * ny * w1) / w
      b.vx -= (k * nx * w2) / w; b.vy -= (k * ny * w2) / w
    }
  }

  // Расталкивание двух тел. Проход последовательный: каждая пара видит уже
  // исправленные предыдущими положения — поэтому порядок пар важен и сетка
  // обязана отдавать их в том же порядке, что и перебор всех со всеми.
  _pushApart(a, b) {
    if (a.phase && a.phase === b.phase) return    // своих среда расталкивает сама
    const mixed = a.phase || b.phase
    if (mixed) {
      const solid = a.phase ? b : a, drop = a.phase ? a : b
      if (!solid.collision.fluid || !drop.collision.points) return
    } else if (!a.collision.points || !b.collision.points) return
    const dx = b.x - a.x, dy = b.y - a.y
    const min = a.radius + b.radius
    if (Math.abs(dx) > min || Math.abs(dy) > min) return
    const d = Math.hypot(dx, dy)
    if (d >= min || d < 1e-9) return
    const ima = a.pinned ? 0 : 1 / a.mass
    const imb = b.pinned ? 0 : 1 / b.mass
    const s = ima + imb
    if (!s) return
    const push = (min - d) / d
    const ax = -dx * push * (ima / s), ay = -dy * push * (ima / s)
    const bx = dx * push * (imb / s), by = dy * push * (imb / s)
    a.x += ax; a.y += ay
    b.x += bx; b.y += by
  }

  // Сетку перекладываем раз на подшаг, а не на каждую итерацию: за итерацию
  // тела сдвигаются на доли пикселя, и запас в несколько пикселей гарантирует,
  // что в кандидатах окажется всё, что могло сойтись. Лишнее в списке
  // безвредно — расстояние всё равно проверяется точно.
  _rebuildGrid() {
    if (this.points.length < PAIRS_MIN) return
    this.grid.build(this.points, 6)
    // Своих среда расталкивает сама, своей же сеткой (core/fluid.js). Общему
    // проходу остаётся только встреча среды с обычным телом — а обычных тел на
    // уровне единицы. Отмечаем крупные клетки, где они есть, и частица
    // проверяет одну ячейку вместо сбора двух десятков соседей.
    const near = this._solidCells
    near.clear()
    let big = 0
    for (const p of this.points) if (!p.phase && p.radius > big) big = p.radius
    const c = SOLID_CELL
    for (const p of this.points) {
      if (p.phase || !(p.collision.points || p.collision.fluid)) continue
      const r = p.radius + big + 12
      const x0 = Math.floor((p.x - r) / c), x1 = Math.floor((p.x + r) / c)
      const y0 = Math.floor((p.y - r) / c), y1 = Math.floor((p.y + r) / c)
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) near.add(cx * 100003 + cy)
    }
  }

  _needsPairs(p) {
    if (!p.phase) return true
    const c = SOLID_CELL
    return this._solidCells.has(Math.floor(p.x / c) * 100003 + Math.floor(p.y / c))
  }

  _solvePairs() {
    const pts = this.points
    if (pts.length < PAIRS_MIN) {
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]
        if (!a.collision.points) continue
        for (let j = i + 1; j < pts.length; j++) this._pushApart(a, pts[j])
      }
      return
    }
    this.grid.pairs(this._push, this._skip)
  }

  _syncColliders() {
    for (const c of this.colliders) {
      if (!c.dynamic) continue
      for (let i = 0; i < c.verts.length; i++) {
        c.points[i][0] = c.verts[i].x
        c.points[i][1] = c.verts[i].y
      }
      c.bbox = bboxOfRings(c.rings)
      if (c.index) c.index.build(c.polys)
      c.stamp++
    }
  }

  // Позиционная часть контакта. Со статикой просто выталкиваем,
  // с живым телом делим поправку по обратным массам — тело получает отдачу.
  //
  // Разлипание частицы среды со СТАТИКОЙ импульса не несёт: нормальную скорость
  // ей погасит скоростная часть, а выталкивание здесь — следствие того, что её
  // подпихнули соседи. В верле разделить это было нечем, и каждый такой пиксель
  // уходил в решатель давления как выдуманная скорость.
  // last — последняя ли это итерация решателя. Тела разлипаем каждый раз: у них
  // контакт и связи сходятся вместе, и пропуск прохода расшатывает стопку. Частицам
  // среды хватает одного раза в конце — их между итерациями двигает только
  // расталкивание, а оно теперь тоже проходит однажды. На полутора тысячах частиц
  // это 4 мс на кадр, и ни одна частица при этом в камне не остаётся.
  _collide(h, last) {
    const inv = 1 / h
    for (const p of this.points) {
      if (p.pinned || !p.collision.world) continue
      if (p.phase && !last) continue
      for (const c of this.colliders) {
        if (c.group && c.group === p.group) continue // внутри одной сборки не толкаемся
        const ct = this._contact(p, c)
        if (!ct) continue
        if (!c.dynamic) {
          const tx = ct.qx + ct.nx * p.radius, ty = ct.qy + ct.ny * p.radius
          const dx = tx - p.x, dy = ty - p.y
          p.cn += Math.hypot(dx, dy) * inv
          p.x = tx; p.y = ty
          continue
        }
        const a = c.verts[ct.i], b = c.verts[(ct.i + 1) % c.verts.length]
        const t = ct.t
        const wp = 1 / p.mass
        const wa = a.pinned ? 0 : 1 / a.mass
        const wb = b.pinned ? 0 : 1 / b.mass
        const we = (1 - t) * (1 - t) * wa + t * t * wb
        const sum = wp + we
        if (!sum) continue
        const d = Math.min(ct.depth, 16) // разлипаем постепенно, а не рывком
        p.cn += d * (wp / sum) * inv
        p.x += ct.nx * d * (wp / sum); p.y += ct.ny * d * (wp / sum)
        if (wa) { a.x -= ct.nx * d * ((1 - t) * wa) / sum; a.y -= ct.ny * d * ((1 - t) * wa) / sum }
        if (wb) { b.x -= ct.nx * d * (t * wb) / sum; b.y -= ct.ny * d * (t * wb) / sum }
      }
    }
  }

  // Скоростная часть контакта: упругость по нормали, гладкость по касательной
  _contactVelocity(h) {
    for (const p of this.points) {
      if (p.pinned || !p.collision.world) continue
      for (const c of this.colliders) {
        if (c.group && c.group === p.group) continue
        const ct = this._contact(p, c, 0.5)
        if (!ct) continue
        const { nx, ny } = ct
        let sx = 0, sy = 0
        if (c.dynamic) { // скорость самой поверхности в точке касания
          const a = c.verts[ct.i], b = c.verts[(ct.i + 1) % c.verts.length]
          sx = a.vx * (1 - ct.t) + b.vx * ct.t
          sy = a.vy * (1 - ct.t) + b.vy * ct.t
        }
        const vx = p.vx - sx, vy = p.vy - sy
        const vn = vx * nx + vy * ny

        // У среды трения о стенку нет вовсе, какой бы шершавой стенка ни была:
        // сопротивление жидкости о берег — это вязкость внутри неё самой, а не
        // сухое трение. С кулоновым трением вода прилипает к дну и не может
        // растечься — поверхность так и застывает волнами. Гасим только вход
        // в стенку; всё остальное решает давление.
        if (p.phase) {
          if (vn < 0) { p.vx -= vn * nx; p.vy -= vn * ny }
          continue
        }

        const rest = (p.restitution + c.restitution) * 0.5
        // гладкость 0 — шершавая поверхность, 1 — лёд.
        const avg = clamp((p.smoothness + c.smoothness) * 0.5, 0, 1)
        const mu = 1 - avg
        const tx = -ny, ty = nx
        const vt = vx * tx + vy * ty
        const nvn = vn < 0 ? -vn * rest : vn
        // Кулоново трение: касательную скорость гасит не постоянная доля, а сила,
        // пропорциональная нормальному импульсу. Сам импульс берём из позиционной
        // коррекции — к этому месту нормальная скорость уже погашена ею же.
        const j = p.cn + (vn < 0 ? -vn * (1 + rest) : 0)
        let nvt
        if (!p.rigid && p.radius > 1e-3) {
          // Свободный диск катится. Трение действует не на центр, а на точку касания:
          // проскальзывание там равно vt − ω·r. Импульс J меняет и скорость (J/m),
          // и вращение (−J·r/I); для диска I = ½mr², поэтому проскальзывание
          // убывает втрое быстрее скорости центра. Пока сцепления хватает, оно
          // обнуляется — дальше шар катится без потерь и несёт инерцию по дуге.
          const slip = vt - p.spin * p.radius
          const sg = slip < 0 ? -1 : slip > 0 ? 1 : 0
          const dv = Math.min(Math.abs(slip) / 3, mu * j)
          nvt = vt - sg * dv
          p.spin += (sg * dv * 2) / p.radius

          // Сопротивление качению. Шар и опора мнутся в пятне контакта, и
          // отпускает она его позади центра — получается тормозящий момент.
          // Он тем больше, чем мягче и шершавее поверхность, то есть та же
          // гладкость, что задаёт скольжение: по льду катится долго, по песку
          // встаёт быстро. Считается относительно самой опоры, поэтому на
          // едущей платформе оно не тормозит груз, а постепенно разгоняет его
          // до её скорости. Тормозит ход и вращение сразу, поэтому качение
          // не срывается в проскальзывание.
          const brake = Math.min(Math.abs(nvt), mu * ROLL_RESIST * j)
          if (brake > 0) {
            const rs = nvt < 0 ? -1 : 1
            nvt -= rs * brake
            p.spin -= (rs * brake) / p.radius
          }
        } else {
          const drop = Math.min(Math.abs(vt), mu * j)
          nvt = vt - Math.sign(vt) * drop
        }
        p.vx = nvn * nx + nvt * tx + sx
        p.vy = nvn * ny + nvt * ty + sy
      }
    }
  }

  // Ближайшая точка границы и внешняя нормаль, если тело её касается
  _contact(p, c, slack = 0) {
    const rings = c.rings
    if (!rings || !rings.length) return null
    const bb = c.bbox
    if (p.x + p.radius < bb.x || p.x - p.radius > bb.x + bb.w) return null
    if (p.y + p.radius < bb.y || p.y - p.radius > bb.y + bb.h) return null

    // Граница области — это все её кольца, включая дырки. У крупных областей
    // спрашиваем индекс, у мелких перебираем: ответ обязан быть один и тот же.
    const closest = c.index ? (x, y, limit) => c.index.closest(x, y, limit) : (x, y) => {
      const s = this._seg, out = this._hit
      let best = Infinity, edge = 0
      out.q = null
      for (const ring of rings) {
        for (let i = 0, n = ring.length; i < n; i++) {
          const a = ring[i], b = ring[(i + 1) % n]
          closestOnSegmentInto(s, x, y, a[0], a[1], b[0], b[1])
          const d = Math.hypot(x - s.x, y - s.y)
          if (d < best) { best = d; out.qx = s.x; out.qy = s.y; out.q = out; edge = i; out.t = s.t }
        }
      }
      out.x = out.qx; out.y = out.qy
      out.d = best; out.edge = edge
      return out
    }
    const has = c.index ? (x, y) => c.index.inside(x, y) : (x, y) => insideRegion(x, y, c.polys)

    // Снаружи граница интересна только в пределах своего радиуса — этим
    // ограничением индекс живёт одним просмотром вместо расширяющегося поиска.
    const inside = has(p.x, p.y)
    const near = inside ? closest(p.x, p.y) : closest(p.x, p.y, p.radius + slack)
    if (!near || !near.q) return null
    let { q, d, edge, t } = near
    if (!inside && d >= p.radius + slack) return null

    let nx, ny
    if (inside && !has(p.sx, p.sy)) {
      // влетел за один подшаг — выталкиваем туда, откуда пришёл
      const prev = closest(p.sx, p.sy)
      q = prev.q; edge = prev.edge; t = prev.t
      const dx = p.sx - q.x, dy = p.sy - q.y
      const len = Math.hypot(dx, dy) || 1e-9
      nx = dx / len; ny = dy / len
    } else if (d < 1e-6) { nx = 0; ny = -1 }
    else {
      nx = (p.x - q.x) / d; ny = (p.y - q.y) / d
      if (inside) { nx = -nx; ny = -ny }
    }

    const depth = inside ? p.radius + d : p.radius - d
    return { qx: q.x, qy: q.y, nx, ny, depth, i: edge, t }
  }
}
