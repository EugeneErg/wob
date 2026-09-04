import { defineEntity } from '../../core/registry.js'
import { clamp, closestOnSegment } from '../../core/geom.js'
import { LAYERS, EVENTS } from '../../core/globals.js'

// Игровой шар.
// Глобально: attachable = true только когда шар уже часть конструкции.
// Приватно: min/max связей, дальность, состояние.
//
// Состояния:
//   free  — падает, ползёт и прыгает к ближайшей конструкции
//   walk  — идёт по связям, при всасывании — кратчайшим путём к нему
//   drag  — свободный шар в руке игрока
//   pull  — шар вынимают из конструкции: настоящий остаётся на месте и держит
//           конструкцию, но не виден; в руке — копия, которая ни на что не влияет
//   built — часть конструкции

const other = (l, p) => (l.a === p ? l.b : l.a)
const llen = (l) => Math.hypot(l.a.x - l.b.x, l.a.y - l.b.y) || 1e-9

export default defineEntity({
  type: 'game-ball',
  title: 'Game ball',
  z: LAYERS.body,
  icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="currentColor"/><circle cx="9.7" cy="10.5" r="2" fill="#fff"/><circle cx="14.3" cy="10.5" r="2" fill="#fff"/></svg>',

  defaults: () => ({
    x: 0, y: 0,
    r: 13,          // свободный
    builtR: 13,     // в конструкции
    sleepR: 13,     // спящий
    mass: 1,        // свободный
    builtMass: 1,   // в конструкции
    sleepMass: 1,   // спящий
    opacity: 1,
    anchorable: true, // можно ли цепляться к нему самому
    asleep: false,    // спит: игроку недоступен, будит касание конструкции
    minLinks: 2,
    maxLinks: 3,
    range: 165,
    jump: 470,
    speed: 95,
    dropMax: 190,
    color: '#e2704a',
    linkColor: '#f0b48c',
  }),

  spawn(ctx, data) {
    const p = ctx.addPoint({
      x: data.x, y: data.y,
      radius: data.r,
      mass: data.mass ?? 1,
      restitution: 0.12,
      smoothness: 0.55,
      // спящие живут по обычной физике и толкают друг друга,
      // активные проходят сквозь всё, кроме статики
      collision: { world: true, points: !!data.asleep },
      attachable: false,
    })
    return {
      p, state: 'free', walk: null, climb: null, links: [], preview: [], ghost: null,
      asleep: !!data.asleep, hover: false,
      cd: 0, dir: ctx.rng.sign(), pause: 0, retreat: 0, look: { x: 0, y: 1 },
      phase: ctx.rng.range(0, Math.PI * 2), rate: ctx.rng.range(3.0, 4.8), gait: 1,
    }
  },

  update(rt, ctx, dt, data) {
    const p = rt.p
    rt.links = rt.links.filter((l) => !l.removed)
    if (p.y > ctx.bounds.y + ctx.bounds.h + 400) { ctx.emit('ball:lost'); ctx.despawnSelf(); return }

    rt.hover = !!ctx.pointer && Math.hypot(ctx.pointer.x - p.x, ctx.pointer.y - p.y) < p.radius + 14
    const inStructure = rt.state === 'built' || rt.state === 'pull'
    // цепляться можно только к тому, кто это разрешает
    p.attachable = inStructure && data.anchorable !== false
    applyProfile(rt, ctx, data, inStructure)
    rt.cd = Math.max(0, rt.cd - dt)
    // у подъёмной силы есть потолок: у верхней кромки уровня она сходит на нет
    if (p.lift) p.gravityScale = -clamp((p.y - (ctx.bounds.y + 40)) / 150, -1, 1)

    // шар вынимают: он всё ещё держит конструкцию, но его не видно
    if (rt.state === 'pull') {
      for (const l of p.links) l.visible = false
      return
    }
    // Живой шар держит себя сам: он круглый, но упирается и не катится.
    // Это не свойство физики, а то, что он делает — как всякое живое тело.
    if (rt.state === 'drag') { ctx.setSpin(p, 0); return }
    if (rt.state === 'built') {
      ctx.setSpin(p, 0)
      if (p.links.length === 0) { rt.state = 'free'; p.pinned = false }
      return
    }
    if (rt.state === 'walk') return walk(rt, ctx, dt, data)
    if (rt.state === 'climb') return climb(rt, ctx, dt, data)

    // спящий шар ничего не делает, пока его не коснётся конструкция
    if (rt.asleep) {
      p.pinned = false
      rt.look = { x: 0, y: 1 }
      const touch = ctx.nearest(p, (q) => q !== p && q.attachable, p.radius + 90)
      const near = touch && Math.hypot(touch.x - p.x, touch.y - p.y) < p.radius + touch.radius + 6
      const rail = ctx.closestOnLinks(p, (l) => passable(l.a) && passable(l.b))
      if (near || (rail && rail.dist < p.radius + 6)) {
        rt.asleep = false
        p.collision.points = false   // проснулся — стал проходить сквозь своих
      }
      return
    }

    return roam(rt, ctx, dt, data)
  },

  shapes(data, rt) {
    const p = rt?.p
    const st = rt?.state
    const r = p ? p.radius : data.r
    const lift = p ? p.lift : data.mass < 0
    const out = []

    // связи рисует тот, кто их построил; невидимые пропускаем
    for (const l of rt?.links || []) {
      if (l.visible === false) continue
      const strain = clamp(l.tension / (l.breakForce || 1), 0, 1)
      out.push({
        k: 'line', layer: LAYERS.structure,
        x1: l.a.x, y1: l.a.y, x2: l.b.x, y2: l.b.y,
        stroke: data.linkColor, sw: 8 - strain * 4, cap: 'round',
      })
      out.push({
        k: 'line', layer: LAYERS.structure,
        x1: l.a.x, y1: l.a.y, x2: l.b.x, y2: l.b.y,
        stroke: strain > 0.55 ? '#ffd9a0' : '#a34a26', sw: 2, cap: 'round', opacity: 0.5 + strain * 0.5,
      })
    }

    // тело: настоящее или копия в руке
    const ghost = (st === 'pull' || st === 'drag') && rt.ghost
    if (st === 'pull' && !ghost) return out
    const x = ghost ? rt.ghost.x : p ? p.x : data.x
    const y = ghost ? rt.ghost.y : p ? p.y : data.y
    const ok = !ghost || rt.preview.length >= data.minLinks

    for (const q of rt?.preview || []) {
      out.push({ k: 'line', layer: LAYERS.overlay, x1: x, y1: y, x2: q.x, y2: q.y, stroke: '#ffd9a0', sw: 3, dash: '8 8', opacity: 0.9 })
    }

    const layer = ghost ? LAYERS.overlay : undefined
    const bodyFrom = out.length
    if (lift) {
      out.push({ k: 'circle', layer, x, y, r: r + 5, fill: 'none', stroke: data.color, sw: 1.5, opacity: 0.5 })
      for (const s of [-1, 1]) {
        out.push({ k: 'line', layer, x: 0, y: 0, x1: x + s * r * 0.5, y1: y + r * 1.0, x2: x + s * r * 0.25, y2: y + r * 1.7, stroke: data.color, sw: 2, cap: 'round', opacity: 0.55 })
      }
    }
    if (st === 'walk' || ghost) {
      out.push({ k: 'circle', layer, x, y, r: r + 4, fill: 'none', stroke: ok ? '#ffd9a0' : '#c0563a', sw: 2, opacity: 0.55 })
    }
    const _body = []
    const alpha = data.opacity ?? 1
    const moving = st === 'walk' || (st === 'free' && !rt?.asleep)
    const sq = moving ? ((rt?.gait ?? 1) - 0.5) * 0.26 : 0
    out.push(sq
      ? { k: 'ellipse', layer, x, y, rx: r * (1 + sq), ry: r * (1 - sq), fill: data.color, stroke: '#7a2f14', sw: 2.5, opacity: ghost && !ok ? 0.65 : 1 }
      : { k: 'circle', layer, x, y, r, fill: data.color, stroke: '#7a2f14', sw: 2.5, opacity: ghost && !ok ? 0.65 : 1 })

    // прозрачность красит только тело: глаза остаются видимыми
    if (alpha < 1) for (const sh of out.slice(bodyFrom)) sh.opacity = (sh.opacity ?? 1) * alpha

    const look = rt?.look || { x: 0, y: 1 }
    const ex = r * 0.36, ey = -r * 0.18
    if (rt?.asleep) {
      // спит: закрытые глаза и zZ
      for (const s of [-1, 1]) {
        out.push({ k: 'line', layer, x1: x + s * ex - r * 0.22, y1: y + ey, x2: x + s * ex + r * 0.22, y2: y + ey, stroke: '#20140d', sw: 2, cap: 'round' })
      }
      out.push({ k: 'text', layer, x: x + r * 1.1, y: y - r * 1.0, text: 'zZ', size: r * 1.1, fill: '#cfe0e8', anchor: 'start', opacity: 0.75 })
      return out
    }
    // в конструкции глаза показываем только под курсором
    if (st !== 'built' || rt?.hover) {
      for (const s of [-1, 1]) {
        out.push({ k: 'circle', layer, x: x + s * ex, y: y + ey, r: r * 0.33, fill: '#fff' })
        out.push({ k: 'circle', layer, x: x + s * ex + look.x * r * 0.12, y: y + ey + look.y * r * 0.12, r: r * 0.15, fill: '#20140d' })
      }
    }
    return out
  },

  pointer: {
    hit(rt, ctx, pt, data) {
      if (rt.asleep) return false // спящим управлять нельзя
      const at = (rt.state === 'pull' || rt.state === 'drag') && rt.ghost ? rt.ghost : rt.p
      return Math.hypot(pt.x - at.x, pt.y - at.y) <= rt.p.radius + 12
    },
    down(rt, ctx, pt, data) {
      rt.ghost = { x: rt.p.x, y: rt.p.y }
      if (rt.state === 'built') {
        rt.state = 'pull'                       // настоящий шар остаётся в конструкции
        for (const l of rt.p.links) l.visible = false
      } else {
        rt.state = 'drag'
        rt.walk = null
        rt.p.pinned = true
      }
      rt.preview = candidatesAt(rt, ctx, rt.ghost, data)
    },
    move(rt, ctx, pt, data) {
      rt.ghost = { x: pt.x, y: pt.y }
      rt.preview = candidatesAt(rt, ctx, rt.ghost, data)
      if (rt.state === 'drag') {
        const p = rt.p
        ctx.placeAt(p, pt.x, pt.y)
      }
    },
    up(rt, ctx, pt, data) {
      const p = rt.p
      const at = rt.ghost || pt
      const cands = candidatesAt(rt, ctx, at, data)
      rt.preview = []
      rt.ghost = null

      if (rt.state === 'pull') {
        for (const l of [...p.links]) ctx.removeLink(l) // только теперь покидает конструкцию
        rt.links = []
      }
      // телепорт в точку, где отпустили
      ctx.placeAt(p, at.x, at.y)
      p.pinned = false

      if (cands.length >= data.minLinks) {
        rt.links = cands.map((q) => ctx.addLink(p, q, {
          spring: 1600,
          damping: 0.25,
          breakForce: 26000,
          width: 8,
          color: data.linkColor,
        }))
        rt.state = 'built'
      } else {
        rt.state = 'free'
      }
    },
  },

  editor: {
    create: {
      start: () => ({ x: 0, y: 0, ready: false }),
      click(draft, pt) { draft.x = pt.x; draft.y = pt.y; draft.ready = true; return 'done' },
      move(draft, pt) { draft.x = pt.x; draft.y = pt.y },
      shapes: (draft) => [{ k: 'circle', x: draft.x, y: draft.y, r: 13, fill: 'rgba(226,112,74,.5)', stroke: '#e2704a', sw: 2, dash: '4 4' }],
      finish: (draft) => (draft.ready
        ? { x: draft.x, y: draft.y, r: 13, builtR: 13, sleepR: 13, mass: 1, builtMass: 1, sleepMass: 1, opacity: 1, anchorable: true, asleep: false, minLinks: 2, maxLinks: 3, range: 165, jump: 470, speed: 95, dropMax: 190, color: '#e2704a', linkColor: '#f0b48c' }
        : null),
    },

    bounds: (data) => ({ x: data.x - data.r, y: data.y - data.r, w: data.r * 2, h: data.r * 2 }),
    hit: (data, pt) => Math.hypot(pt.x - data.x, pt.y - data.y) <= data.r,
    move(data, dx, dy) { data.x += dx; data.y += dy },

    handles: (data) => [{ id: 0, x: data.x, y: data.y }],
    moveHandles(data, ids, dx, dy) { if (ids.length) { data.x += dx; data.y += dy } },
    deleteHandles: () => false,

    props: () => [
      { key: 'mass', label: 'Weight when free', type: 'range', min: -4, max: 6, step: 0.1, global: true },
      { key: 'builtMass', label: 'Weight in a structure (negative floats)', type: 'range', min: -8, max: 6, step: 0.1, global: true },
      { key: 'sleepMass', label: 'Weight when asleep', type: 'range', min: -8, max: 20, step: 0.1, global: true },
      { key: 'anchorable', label: 'Can be linked to', type: 'bool', global: true },
      { key: 'asleep', label: 'Asleep', type: 'bool' },
      { key: 'minLinks', label: 'Minimum links', type: 'number', min: 1, max: 6, step: 1 },
      { key: 'maxLinks', label: 'Maximum links', type: 'number', min: 1, max: 6, step: 1 },
      { key: 'range', label: 'Link range', type: 'range', min: 60, max: 400, step: 5 },
      { key: 'jump', label: 'Jump', type: 'range', min: 0, max: 900, step: 10 },
      { key: 'speed', label: 'Walking speed', type: 'range', min: 20, max: 300, step: 5 },
      { key: 'dropMax', label: 'Will not drop further than', type: 'range', min: 0, max: 600, step: 10 },
      { key: 'r', label: 'Radius when free', type: 'range', min: 8, max: 40, step: 1 },
      { key: 'builtR', label: 'Radius in a structure', type: 'range', min: 8, max: 60, step: 1 },
      { key: 'sleepR', label: 'Radius when asleep', type: 'range', min: 6, max: 60, step: 1 },
      { key: 'opacity', label: 'Opacity', type: 'range', min: 0.15, max: 1, step: 0.05 },
      { key: 'color', label: 'Color', type: 'color' },
    ],
  },
})

// Вес и размер у свободного шара и у встроенного разные: пока шар в руках игрока он
// обычный, а в конструкции может стать, например, легче воздуха и раздуться.
function applyProfile(rt, ctx, data, inStructure) {
  const want = inStructure ? 'built' : rt.asleep ? 'sleep' : 'free'
  if (rt.profile === want) return
  rt.profile = want
  const p = rt.p
  const mass = want === 'built' ? (data.builtMass ?? data.mass)
    : want === 'sleep' ? (data.sleepMass ?? data.mass)
      : data.mass
  const r = want === 'built' ? (data.builtR ?? data.r)
    : want === 'sleep' ? (data.sleepR ?? data.r)
      : data.r
  ctx.setMass(p, mass)
  p.radius = r
}

// Заход на конструкцию: выбираем ближайшую точку проходимой связи и доходим
// до неё по прямой — без рывка на месте.
function startClimb(rt, ctx, target) {
  const p = rt.p
  let best = null
  for (const l of target.links) {
    if (!passable(other(l, target))) continue
    const q = closestOnSegment(p.x, p.y, l.a.x, l.a.y, l.b.x, l.b.y)
    const dist = Math.hypot(p.x - q.x, p.y - q.y)
    if (!best || dist < best.dist) best = { link: l, t: q.t, dist }
  }
  if (!best) return false
  rt.state = 'climb'
  rt.climb = { link: best.link, t: best.t, k: 0, dur: Math.max(0.1, best.dist / 220), fx: p.x, fy: p.y }
  p.pinned = true
  return true
}

function climb(rt, ctx, dt, data) {
  const p = rt.p
  const c = rt.climb
  if (!c || !c.link || c.link.removed) { rt.state = 'free'; p.pinned = false; return }
  c.k = Math.min(1, c.k + dt / c.dur)
  const a = c.link.a, b = c.link.b
  const tx = a.x + (b.x - a.x) * c.t, ty = a.y + (b.y - a.y) * c.t
  const e = c.k * c.k * (3 - 2 * c.k)
  ctx.placeAt(p, c.fx + (tx - c.fx) * e, c.fy + (ty - c.fy) * e)
  rt.look = { x: tx - c.fx, y: ty - c.fy }
  const n = Math.hypot(rt.look.x, rt.look.y) || 1
  rt.look.x /= n; rt.look.y /= n
  if (c.k >= 1) {
    rt.state = 'walk'
    rt.walk = { link: c.link, from: a, t: c.t }
    rt.climb = null
  }
}

// Улиточная походка: шар не едет с постоянной скоростью, а подтягивается
// толчками — своя фаза и свой темп у каждого.
function gait(rt, ctx) {
  const s = 0.5 + 0.5 * Math.sin(ctx.time * rt.rate + rt.phase)
  // делим на среднее значение профиля, чтобы средний темп остался прежним,
  // а движение стало рывками: от четверти скорости до двух с половиной
  rt.gait = (0.1 + 0.9 * Math.pow(s, 1.9)) / 0.42
  return rt.gait
}

// По чьим связям вообще можно ползать: узел должен разрешать зацеп,
// а всасывание — это законный конец пути.
const passable = (q) => q.attachable || q.suction > 0

// Свободный шар: идёт к конструкции, прыгает, тормозит у обрыва и не стоит на месте.
// Конструкция — это точка, к которой можно лепить связи И у которой уже есть связи:
// одинокий шар конструкцией не считается.
function roam(rt, ctx, dt, data) {
  const p = rt.p
  p.pinned = false
  if (p.lift) return drift(rt, ctx, dt, data)

  // «Низ» у шара не мировой, а свой: он там, куда тянет поле именно здесь.
  // Всё дальше считается в этой опорной паре: dn — вниз, tg — вдоль опоры.
  // Поэтому вокруг планеты шар ходит так же, как по ровной земле, и никакого
  // отдельного «режима круглого мира» для этого не нужно.
  const g = ctx.gravityAt(p.x, p.y)
  const gm = Math.hypot(g.x, g.y)
  // тянуть некуда — значит невесомость: ходить не по чему, шар плывёт
  if (gm < 1) return drift(rt, ctx, dt, data)
  const dn = { x: g.x / gm, y: g.y / gm }
  const tg = { x: -dn.y, y: dn.x }
  const along = (ax, ay) => ax * tg.x + ay * tg.y     // вдоль опоры, «вбок»
  const under = (ax, ay) => ax * dn.x + ay * dn.y     // по «низу», вниз плюс

  const vx = p.vx, vy = p.vy
  const grounded = Math.abs(under(vx, vy)) < 144
  // упёрся ногами — не катится; оторвался от земли — крутится как все
  if (grounded) ctx.setSpin(p, 0)
  const target = ctx.nearest(p, (q) => q !== p && q.attachable && q.links.length > 0)

  let side = 0, up = 0
  if (target) {
    const dx = target.x - p.x, dy = target.y - p.y
    const d = Math.hypot(dx, dy) || 1e-9
    side = along(dx, dy); up = under(dx, dy)
    rt.look = { x: dx / d, y: dy / d }
    if (rt.retreat <= 0 && Math.abs(side) > p.radius * 1.5) rt.dir = Math.sign(side)

    // дошёл — лезем по конструкции, но только по проходимым связям
    if (d < p.radius + target.radius + 10 && startClimb(rt, ctx, target)) return
  } else {
    rt.look = { x: tg.x * rt.dir + dn.x * 0.25, y: tg.y * rt.dir + dn.y * 0.25 }
  }

  // щупаем землю перед собой — тоже вдоль своей опоры
  const step = p.radius + 10
  const fx = p.x + tg.x * rt.dir * step + dn.x * (p.radius + 3)
  const fy = p.y + tg.y * rt.dir * step + dn.y * (p.radius + 3)
  const floor = ctx.solidAt(fx, fy)
  const wall = ctx.solidAt(
    p.x + tg.x * rt.dir * (p.radius + 5) - dn.x * p.radius * 0.3,
    p.y + tg.y * rt.dir * (p.radius + 5) - dn.y * p.radius * 0.3,
  )
  let drop = null
  if (!floor) {
    for (let d = 12; d <= (data.dropMax ?? 190); d += 12) {
      if (ctx.solidAt(fx + dn.x * d, fy + dn.y * d)) { drop = d; break }
    }
  }

  rt.retreat = Math.max(0, rt.retreat - dt)
  let go = rt.dir
  if (rt.pause > 0) {
    rt.pause -= dt
    go = 0
    if (rt.pause <= 0) rt.dir = -rt.dir   // постояли у края и развернулись
  } else if (grounded && !floor) {
    // за краем: спрыгнуть можно, если внизу есть дно и конструкция в той стороне
    const toward = !target || Math.sign(side) === rt.dir
    if (!(drop !== null && toward)) {
      rt.pause = ctx.rng.range(0.35, 0.65)
      rt.retreat = ctx.rng.range(1.1, 1.9)   // отходим от края, потом вернёмся
      go = 0
    }
  }

  // Прыгаем только ради цели: без конструкции у стены просто разворачиваемся.
  if (wall && grounded && !target) rt.dir = -rt.dir
  if (target && grounded && rt.cd === 0) {
    const reached = Math.hypot(side, up) <= p.radius + target.radius + 10
    // цель выше и до неё не дотянуться — пробуем допрыгнуть, даже если не выйдет
    const near = Math.abs(side) < Math.max(150, p.radius + target.radius + 70)
    if (!reached && ((up < -20 && near) || wall)) {
      // прыжок — толчок против «низа», а не вверх по экрану
      // прыжок теперь буквально прыжок: скорость против «низа», px/с
      const j = data.jump ?? 470
      p.vx = -dn.x * j
      p.vy = -dn.y * j
      rt.cd = ctx.rng.range(0.45, 0.8)
    }
  }

  // ход: в воздухе управляем слабее, скорость ограничена
  const v = along(vx, vy)
  const air = grounded ? 1 : 0.3
  const cap = data.speed ?? 95
  const push = go && Math.abs(v) < cap ? go * 1400 * air * gait(rt, ctx) : 0
  const brake = go === 0 && grounded ? -v * 6 : 0
  const f = push + brake
  ctx.applyAccel(p, f * tg.x, f * tg.y)
}

// Летающий шар (отрицательный вес): плывёт к конструкции по прямой,
// прыгать и щупать землю ему незачем, но улететь за уровень он не должен.
function drift(rt, ctx, dt, data) {
  const p = rt.p
  const target = ctx.nearest(p, (q) => q !== p && q.attachable && q.links.length > 0)
  if (target) {
    const dx = target.x - p.x, dy = target.y - p.y
    const d = Math.hypot(dx, dy) || 1e-9
    rt.look = { x: dx / d, y: dy / d }
    ctx.applyAccel(p, clamp(dx * 6, -700, 700), clamp(dy * 6, -700, 700))
    if (d < p.radius + target.radius + 10 && startClimb(rt, ctx, target)) return
  } else {
    rt.look = { x: rt.dir, y: -1 }
    ctx.applyAccel(p, rt.dir * 90, 0)
  }
  // мягкий потолок и стены уровня
  const b = ctx.bounds
  const m = p.radius + 8
  if (p.y < b.y + m) { p.y = b.y + m; if (p.vy < 0) p.vy = 0 }
  if (p.x < b.x + m) { ctx.applyAccel(p, (b.x + m - p.x) * 30, 0); rt.dir = 1 }
  if (p.x > b.x + b.w - m) { ctx.applyAccel(p, (b.x + b.w - m - p.x) * 30, 0); rt.dir = -1 }
}

// Кандидаты на связь из точки at — только глобальные свойства чужих тел
function candidatesAt(rt, ctx, at, data) {
  const p = rt.p
  return ctx
    .query((q) => q !== p && q.attachable && Math.hypot(q.x - at.x, q.y - at.y) <= data.range)
    .filter((q) => !ctx.isBlocked(at, q))
    .sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y))
    .slice(0, data.maxLinks)
}

function walk(rt, ctx, dt, data) {
  const p = rt.p
  const w = rt.walk
  if (!w || !w.link || w.link.removed) { rt.state = 'free'; p.pinned = false; return }

  const ahead = other(w.link, w.from)
  if (!passable(ahead)) { rt.state = 'free'; p.pinned = false; return }
  const path = ctx.pathFrom(ahead, (q) => q.suction > 0, passable)
  const suck = path ? path[path.length - 1].suction : 0
  const speed = (path ? 80 + 150 * clamp(suck, 0, 3) : 55) * gait(rt, ctx)

  w.t += (speed * dt) / llen(w.link)
  rt.look = { x: ahead.x - w.from.x, y: ahead.y - w.from.y }
  const nl = Math.hypot(rt.look.x, rt.look.y) || 1
  rt.look.x /= nl; rt.look.y /= nl

  if (w.t >= 1) {
    const node = ahead
    if (node.suction > 0) { ctx.emit(EVENTS.progress, { delta: 1 }); ctx.despawnSelf(); return }
    const next = nextLink(ctx, node, w.link)
    if (!next) { rt.state = 'free'; p.pinned = false; return }
    w.link = next
    w.from = node
    w.t = 0
  }

  // идём ровно по связи, как по рельсу
  const a = w.from, b = other(w.link, w.from)
  ctx.placeAt(p, a.x + (b.x - a.x) * w.t, a.y + (b.y - a.y) * w.t)
  p.pinned = true

  // но вес свой конструкции отдаём: концы связи получают его по долям.
  // Вес считаем по полю в том месте, где шар сейчас, а не по уровню целиком.
  const g = ctx.gravityAt(p.x, p.y)
  const s = 1 - w.t
  if (!a.pinned) ctx.applyAccel(a, (g.x * p.mass * s) / a.mass, (g.y * p.mass * s) / a.mass)
  if (!b.pinned) ctx.applyAccel(b, (g.x * p.mass * w.t) / b.mass, (g.y * p.mass * w.t) / b.mass)
}

function nextLink(ctx, node, curLink) {
  const ok = node.links.filter((l) => passable(other(l, node)))
  const path = ctx.pathFrom(node, (q) => q.suction > 0, passable)
  if (path && path.length > 1) {
    const want = path[1]
    const l = ok.find((ln) => other(ln, node) === want)
    if (l) return l
  }
  const opts = ok.filter((l) => l !== curLink)
  if (opts.length) return ctx.rng.pick(opts)
  return ok.includes(curLink) ? curLink : null
}
