import polygonClipping from 'polygon-clipping'
import { defineEntity } from '../../core/registry.js'
import { LAYERS } from '../../core/globals.js'
import { insideRegion, bboxOfRings, nearestEdgeIndex } from '../../core/geom.js'

// Песок: сплошная статичная область, из которой игрок в игре вычитает ходы.
// Провёл курсором — из области вычлась «колбаса» от точки A до точки B
// заданного радиуса. Область хранится мультиполигоном, дырки поддерживает
// и решатель (граница = все кольца), и отрисовка (fill-rule: evenodd).

const CAP = 12 // граней на скругление торца

// прямоугольник от A до B, раздутый на r, с полукруглыми торцами
function capsule(ax, ay, bx, by, r) {
  let dx = bx - ax, dy = by - ay
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) { dx = 1; dy = 0 } else { dx /= len; dy /= len }
  const nx = -dy, ny = dx
  const ring = []
  const base = Math.atan2(ny, nx)
  for (let i = 0; i <= CAP; i++) {   // торец у B
    const a = base - Math.PI * (i / CAP)
    ring.push([bx + Math.cos(a) * r, by + Math.sin(a) * r])
  }
  for (let i = 0; i <= CAP; i++) {   // торец у A
    const a = base + Math.PI - Math.PI * (i / CAP)
    ring.push([ax + Math.cos(a) * r, ay + Math.sin(a) * r])
  }
  ring.push(ring[0])
  return [[ring]]
}

const asMulti = (data) => (data.polys?.length ? data.polys : (data.points?.length >= 3 ? [[[...data.points, data.points[0]]]] : []))
const ringsOfData = (data) => asMulti(data).flat()

function pathOf(polys) {
  let d = ''
  for (const poly of polys) {
    for (const ring of poly) {
      if (ring.length < 2) continue
      d += `M${ring[0][0]},${ring[0][1]}`
      for (let i = 1; i < ring.length; i++) d += `L${ring[i][0]},${ring[i][1]}`
      d += 'Z'
    }
  }
  return d
}

export default defineEntity({
  type: 'sand',
  title: 'Песок',
  z: LAYERS.ground + 1,
  icon: '<svg viewBox="0 0 24 24"><path d="M3 17h18v4H3z" fill="currentColor"/><path d="M5 17c2-5 5-8 7-8s5 3 7 8" fill="none" stroke="currentColor" stroke-width="2"/></svg>',

  defaults: () => ({
    points: [],
    polys: null,
    dig: 14,
    smoothness: 0.25,
    fill: '#c9a86a',
    edge: '#8a6f3e',
  }),

  spawn(ctx, data) {
    const polys = asMulti(data)
    if (!polys.length) return {}
    const c = ctx.addCollider({ polys, smoothness: data.smoothness, restitution: 0.02 })
    return { c, polys, dug: 0 }
  },

  shapes(data, rt) {
    const polys = rt?.polys || asMulti(data)
    if (!polys.length) return []
    return [
      { k: 'path', d: pathOf(polys), fill: data.fill, stroke: data.edge, sw: 3, fillRule: 'evenodd', join: 'round' },
    ]
  },

  // Копать можно начиная откуда угодно, не обязательно с самого песка.
  // Поэтому hit всегда true, но с самым низким приоритетом: любая другая
  // сущность под курсором (шар, например) забирает жест себе.
  pointer: {
    priority: -10,
    hit: () => true,
    down(rt, ctx, pt, data) { rt.last = { x: pt.x, y: pt.y }; carve(rt, ctx, pt, pt, data) },
    move(rt, ctx, pt, data) {
      const a = rt.last || pt
      carve(rt, ctx, a, pt, data)
      rt.last = { x: pt.x, y: pt.y }
    },
    up(rt) { rt.last = null },
  },

  // Самая узкая щель, какую здесь можно проделать: подкоп идёт капсулой этого
  // радиуса, значит канал выходит вдвое шире. Среда прочтёт это число и выберет
  // себе шаг частиц так, чтобы в такой канал затекать (см. EntityContext.detail).
  detail: (data) => 2 * (data.dig ?? 14),

  editor: {
    create: {
      start: () => ({ points: [], cursor: null }),
      click(draft, pt) { draft.points.push([pt.x, pt.y]) },
      move(draft, pt) { draft.cursor = pt },
      shapes(draft) {
        const pts = draft.cursor ? [...draft.points, [draft.cursor.x, draft.cursor.y]] : draft.points
        if (!pts.length) return []
        const out = [{ k: 'poly', pts, closed: pts.length > 2, fill: 'rgba(201,168,106,.35)', stroke: '#c9a86a', sw: 2, dash: '6 6' }]
        for (const [x, y] of draft.points) out.push({ k: 'circle', x, y, r: 5, fill: '#c9a86a' })
        return out
      },
      finish: (draft) => (draft.points.length >= 3
        ? { points: draft.points, polys: null, dig: 14, smoothness: 0.25, fill: '#c9a86a', edge: '#8a6f3e' }
        : null),
    },

    bounds: (data) => bboxOfRings(ringsOfData(data)),
    hit: (data, pt) => insideRegion(pt.x, pt.y, asMulti(data)),
    move(data, dx, dy) {
      // до раскопок форма живёт в points, после — в polys
      if (data.polys) { for (const ring of data.polys.flat()) for (const p of ring) { p[0] += dx; p[1] += dy } }
      else for (const p of data.points) { p[0] += dx; p[1] += dy }
    },

    // вершины правим только у неразрытого контура — после раскопок форма живёт в polys
    handles: (data) => (data.polys ? [] : data.points.map(([x, y], i) => ({ id: i, x, y }))),
    moveHandles(data, ids, dx, dy) {
      for (const i of ids) { data.points[i][0] += dx; data.points[i][1] += dy }
    },
    deleteHandles(data, ids) {
      const keep = data.points.filter((_, i) => !ids.includes(i))
      if (keep.length < 3) return false
      data.points = keep
      return true
    },
    addHandle(data, pt) {
      if (data.polys) return
      const i = nearestEdgeIndex(pt.x, pt.y, data.points, true)
      data.points.splice(i + 1, 0, [pt.x, pt.y])
    },

    props: () => [
      { key: 'dig', label: 'Радиус подкопа', type: 'range', min: 4, max: 60, step: 1 },
      { key: 'smoothness', label: 'Гладкость', type: 'range', min: 0, max: 1, step: 0.05, global: true },
      { key: 'fill', label: 'Заливка', type: 'color' },
      { key: 'edge', label: 'Кромка', type: 'color' },
    ],
  },
})

// Жест достаётся одной куче песка, а копать надо во всех: соседи своего типа
// доступны через ctx.peers(), чужие сущности по-прежнему невидимы.
function carve(rt, ctx, a, b, data) {
  const cut = capsule(a.x, a.y, b.x, b.y, data.dig ?? 14)
  dig(ctx, rt, cut)
  for (const peer of ctx.peers()) if (peer.rt) dig(ctx, peer.rt, cut)
}

function dig(ctx, rt, cut) {
  if (!rt.polys || !rt.polys.length || !rt.c) return
  let left
  try { left = polygonClipping.difference(rt.polys, cut) } catch { return }
  if (!left) return
  if (!left.length) { rt.polys = []; ctx.removeCollider(rt.c); rt.c = null; return }
  rt.polys = left
  ctx.setRegion(rt.c, left)
  rt.dug = (rt.dug || 0) + 1
}
