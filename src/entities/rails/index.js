import { defineEntity } from '../../core/registry.js'
import { LAYERS } from '../../core/globals.js'
import { bboxOfPoints, distToPolyline, nearestEdgeIndex } from '../../core/geom.js'

// Рельсы: ломаная, которую можно замкнуть. У каждого отрезка своя скорость и
// своя пауза в конце. Коллизии у рельсов нет — они только возят.
//
// Едет по ним тот, кого сделали дочерней сущностью: у рельсов нет жёсткого тела,
// поэтому мир возит ребёнка кинематически, сохраняя его смещение относительно
// каретки. Каретка — одна точка, значит перенос без поворота: платформа едет
// плашмя, как ей и положено.

const segCount = (data) => Math.max(0, data.closed ? data.points.length : data.points.length - 1)

// Отрезков ровно столько, сколько рёбер: вершины добавляют и удаляют, список едет следом
function sync(data) {
  const n = segCount(data)
  data.segs ||= []
  while (data.segs.length < n) data.segs.push({ speed: 120, wait: 0 })
  if (data.segs.length > n) data.segs.length = n
  return n
}

const at = (data, i) => data.points[i % data.points.length]

export default defineEntity({
  type: 'rails',
  title: 'Рельсы',
  z: LAYERS.midground,
  icon: '<svg viewBox="0 0 24 24"><path d="M7 3 4 21M17 3l3 18" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 8h18M3 14h18" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',

  defaults: () => ({
    points: [],
    closed: false,
    segs: [],
    color: '#8d93a1',
    show: true,
  }),

  spawn(ctx, data) {
    sync(data)
    const [x, y] = ctx.place(...(data.points[0] || [0, 0]))
    const p = ctx.addPoint({
      x, y,
      radius: 3, pinned: true,
      attachable: false,
      collision: { world: false, points: false },   // рельсы ничего не задевают
    })
    return { p, i: 0, t: 0, dir: 1, wait: 0 }
  },

  update(rt, ctx, dt, data) {
    const n = sync(data)
    if (n < 1) return
    if (rt.i >= n) { rt.i = 0; rt.t = 0 }

    if (rt.wait > 0) rt.wait -= dt
    else {
      const a = at(data, rt.i), b = at(data, rt.i + 1)
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      const speed = data.segs[rt.i]?.speed ?? 120
      rt.t += (rt.dir * speed * dt) / len

      if (rt.t >= 1) {
        rt.t = 1
        rt.wait = data.segs[rt.i]?.wait ?? 0
        if (data.closed) { rt.i = (rt.i + 1) % n; rt.t = 0 }
        else if (rt.i + 1 < n) { rt.i++; rt.t = 0 }
        else rt.dir = -1              // до конца доехали — поедем обратно
      } else if (rt.t <= 0) {
        rt.t = 0
        if (data.closed) {
          rt.i = (rt.i - 1 + n) % n; rt.t = 1
          rt.wait = data.segs[rt.i]?.wait ?? 0
        } else if (rt.i > 0) {
          rt.i--; rt.t = 1
          rt.wait = data.segs[rt.i]?.wait ?? 0
        } else rt.dir = 1
      }
    }

    // путь задан в координатах родителя — переводим в мировые
    const a = at(data, rt.i), b = at(data, rt.i + 1)
    const p = rt.p
    const prevX = p.x, prevY = p.y
    const [wx, wy] = ctx.place(a[0] + (b[0] - a[0]) * rt.t, a[1] + (b[1] - a[1]) * rt.t)
    p.x = wx; p.y = wy
    p.px = p.x; p.py = p.y
    p.kx = (wx - prevX) * 60; p.ky = (wy - prevY) * 60
  },

  shapes(data, rt, ctx) {
    if (data.points.length < 2) return []
    const pts = ctx ? ctx.placePoints(data.points) : data.points
    const out = []
    if (data.show) {
      const line = data.closed ? [...pts, pts[0]] : pts
      out.push({ k: 'poly', pts: line, stroke: '#22282f', sw: 9, cap: 'round', join: 'round' })
      out.push({ k: 'poly', pts: line, stroke: data.color, sw: 3, cap: 'round', join: 'round', dash: '10 8' })
      // шпалы на концах отрезков
      for (const [x, y] of pts) out.push({ k: 'circle', x, y, r: 4.5, fill: data.color, opacity: 0.8 })
    }
    const p = rt?.p
    if (p) {
      const waiting = rt.wait > 0
      out.push({ k: 'circle', x: p.x, y: p.y, r: 7, fill: waiting ? '#c58a4b' : data.color, stroke: '#22282f', sw: 2 })
    }
    return out
  },

  editor: {
    create: {
      start: () => ({ points: [], cursor: null }),
      click(d, pt) { d.points.push([pt.x, pt.y]) },
      move(d, pt) { d.cursor = pt },
      shapes(d) {
        const pts = d.cursor ? [...d.points, [d.cursor.x, d.cursor.y]] : d.points
        if (!pts.length) return []
        const out = [{ k: 'poly', pts, stroke: '#8d93a1', sw: 3, dash: '8 6', cap: 'round' }]
        for (const [x, y] of d.points) out.push({ k: 'circle', x, y, r: 5, fill: '#8d93a1' })
        return out
      },
      finish: (d) => (d.points.length >= 2
        ? { points: d.points, closed: false, segs: [], color: '#8d93a1', show: true }
        : null),
    },

    bounds: (d) => bboxOfPoints(d.points),
    hit: (d, pt) => distToPolyline(pt.x, pt.y, d.points, d.closed) <= 14,
    move(d, dx, dy) { for (const p of d.points) { p[0] += dx; p[1] += dy } },

    handles: (d) => d.points.map(([x, y], i) => ({ id: i, x, y })),
    moveHandles(d, ids, dx, dy) {
      for (const i of ids) { d.points[i][0] += dx; d.points[i][1] += dy }
    },
    deleteHandles(d, ids) {
      const keep = d.points.filter((_, i) => !ids.includes(i))
      if (keep.length < 2) return false
      d.points = keep
      sync(d)
      return true
    },
    addHandle(d, pt) {
      const i = nearestEdgeIndex(pt.x, pt.y, d.points, d.closed)
      d.points.splice(i + 1, 0, [pt.x, pt.y])
      sync(d)
    },

    props: (data) => {
      if (data) sync(data)
      return [
        { key: 'closed', label: 'Замкнуть путь', type: 'bool' },
        {
          key: 'segs', type: 'list', label: 'Отрезки',
          note: 'Скорость в px/с, пауза в секундах в конце отрезка',
          fields: [
            { key: 'speed', label: 'скорость', min: -600, max: 600, step: 10 },
            { key: 'wait', label: 'пауза', min: 0, max: 20, step: 0.25 },
          ],
        },
        { key: 'show', label: 'Показывать путь', type: 'bool' },
        { key: 'color', label: 'Цвет', type: 'color' },
      ]
    },
  },
})
