import { defineEntity } from '../../core/registry.js'
import { LAYERS } from '../../core/globals.js'
import { insideRegion, bboxOfRings, nearestEdgeIndex } from '../../core/geom.js'
import { SurfaceMesher, bulkFieldValue } from './mesher.js'

// Жидкость: область, которая заполняется частицами среды.
//
// Частица среды — обычная точка мира. Из этого следует всё остальное, и
// следует само: ветер гонит её тем же законом, что и шар; тяжесть у неё своя в
// каждой точке поля; тело, упавшее в воду, расталкивает её и получает сдачи по
// обратным массам. Ни одной строчки про воду и ветер, воду и шар, воду и
// притяжение здесь нет. Сущность, которой ещё не написали, начнёт
// взаимодействовать с водой в тот день, когда научится действовать на точки.
//
// Сама вода — одно ограничение в общем списке: несжимаемость среды. Ровно
// такое же позиционное ограничение, как связь, контакт или жёсткая форма.

const SUBSTANCES = {
  water: { name: 'вода', density: 1.0, viscosity: 0.05, tension: 3.06, wetting: 1.02, fill: '#3fb2cf', edge: '#a8e9f7' },
  oil: { name: 'масло', density: 0.75, viscosity: 0.12, tension: 2.24, wetting: 1.43, fill: '#c08a3e', edge: '#f3d3a2' },
  honey: { name: 'мёд', density: 1.4, viscosity: 0.55, tension: 3.57, wetting: 2.65, fill: '#c9922b', edge: '#f0c380' },
  mercury: { name: 'ртуть', density: 2.9, viscosity: 0.06, tension: 6.12, wetting: 0.0, fill: '#9fb6c2', edge: '#dfeaf0' },
}

// Частица среды — точка того же мира, поэтому её вес задан в единицах мира.
// Плотность вещества — во сколько раз она тяжелее воды того же объёма.
const MASS_PER_PX2 = 1 / 100

const ISO = 0.45, BLOB = 1.8, SMOOTH = 2, MESH_CS = 0.45

const asMulti = (data) => (data.polys?.length
  ? data.polys
  : (data.points?.length >= 3 ? [[[...data.points, data.points[0]]]] : []))
const ringsOfData = (data) => asMulti(data).flat()

const substanceOf = (data) => {
  const base = SUBSTANCES[data.substance] || SUBSTANCES.water
  return {
    ...base,
    density: data.density ?? base.density,
    viscosity: data.viscosity ?? base.viscosity,
    tension: data.tension ?? base.tension,
  }
}

function pathOf(polys) {
  let d = ''
  for (const poly of polys) for (const ring of poly) {
    if (ring.length < 2) continue
    d += `M${ring[0][0]},${ring[0][1]}`
    for (let i = 1; i < ring.length; i++) d += `L${ring[i][0]},${ring[i][1]}`
    d += 'Z'
  }
  return d
}

export default defineEntity({
  type: 'liquid',
  title: 'Жидкость',
  z: LAYERS.ground - 1,
  icon: '<svg viewBox="0 0 24 24"><path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z" fill="currentColor"/></svg>',

  defaults: () => ({
    points: [], polys: null,
    substance: 'water',
    density: 1.0, viscosity: 0.05, tension: 3.06,
    grain: 11, limit: 2000,
  }),

  spawn(ctx, data) {
    const polys = asMulti(data)
    if (!polys.length) return { points: [] }
    const s = substanceOf(data)
    const d = data.grain || 11
    const dy = d * Math.sqrt(3) / 2
    const mass = s.density * d * d * MASS_PER_PX2
    const g = ringsOfData(data)
    const b = bboxOfRings(g)

    const pts = []
    const limit = data.limit ?? 2000
    let row = 0
    for (let y = b.y; y <= b.y + b.h && pts.length < limit; y += dy, row++) {
      for (let x = b.x + (row & 1 ? d * 0.5 : 0); x <= b.x + b.w; x += d) {
        if (pts.length >= limit) break
        if (!insideRegion(x, y, polys)) continue
        if (ctx.solidAt(x, y)) continue
        pts.push(ctx.addPoint({
          // Разброс по ОБЕИМ осям, а не только по горизонтали. Идеально ровная
          // укладка симметрична, и перевёрнутый слой (масло под водой) в ней
          // остаётся лежать вечно: опрокинуться ему нечем. В жизни такой
          // симметрии не бывает, и неустойчивость находит любую неровность.
          x: x + (ctx.rng.next() - 0.5) * d * 0.1,
          y: y + (ctx.rng.next() - 0.5) * d * 0.1,
          // Половина шага укладки — то расстояние, на котором частица стоит от
          // стенки в равновесии. Не «упор поменьше, чтобы не мешал»: возьмёшь
          // меньше — пристеночный слой сожмётся вдвое, плотность у борта уедет
          // и признак свободной поверхности начнёт врать. Друг о друга частицы
          // среды не толкаются вовсе — им это запрещает общая группа.
          radius: d * 0.5,
          mass,
          restitution: 0.02,
          smoothness: 0.9,
          // Стенка нужна ей на радиус ядра: иначе у борта частица выглядит
          // разреженной и её отжимает от берега.
          reach: d * 2.6,
          group: 'liquid',
        }))
      }
    }

    const gy = Math.abs(ctx.gravity.y) || 1800
    const medium = ctx.addMedium({
      points: pts,
      bounds: ctx.bounds,
      spacing: d,
      mass,
      viscosity: s.viscosity,
      // Натяжение и смачивание заданы в долях тяжести: вещество не меняет
      // характера от того, какая на уровне гравитация.
      cohesion: s.tension * gy,
      adhesion: s.wetting * gy,
      film: 0.5,
    })

    return { points: pts, medium, subst: s, grain: d }
  },

  update(rt, ctx, dt, data) {
    // Физики здесь нет и быть не должно: вода течёт потому, что она частицы
    // мира. Единственное дело — прибрать за улетевшими.
    //
    // Невидимых стен по краям мира нет намеренно: нет стены — значит улетит,
    // так честнее. Но улетевшая частица падает вечно и считается вечно, а
    // вернуться ей уже неоткуда. Отпускаем её, когда она ушла далеко за край.
    if ((ctx.frame & 31) !== 0) return
    const b = ctx.bounds, far = b.w + b.h
    const keep = []
    for (const p of rt.points) {
      if (p.removed) continue
      if (p.x < b.x - far || p.x > b.x + b.w + far || p.y > b.y + b.h + far || p.y < b.y - far) {
        ctx.removePoint(p)
        continue
      }
      keep.push(p)
    }
    if (keep.length !== rt.points.length) {
      rt.points = keep
      const m = rt.medium
      if (m) m.points = m.points.filter((p) => !p.removed)
    }
  },

  shapes(data, rt, ctx) {
    const s = substanceOf(data)
    // Контур области — это ПРЕВЬЮ РЕДАКТОРА, где рантайма нет вовсе. Проверять
    // «нет частиц» здесь нельзя: вода могла вытечь с уровня, и тогда на месте
    // былой лужи проступал бы призрак того, чего давно нет.
    if (!rt) {
      const polys = asMulti(data)
      if (!polys.length) return []
      return [{ k: 'path', d: pathOf(polys), fill: s.fill, stroke: s.edge, sw: 2, fillRule: 'evenodd', opacity: 0.55 }]
    }
    // Поверхность принадлежит СРЕДЕ, а не тому, кто её налил: рисует её одна
    // сущность за кадр, по всем частицам вещества. Иначе две слившиеся лужи
    // дали бы два блоба со швом на стыке — физически одна куча, а на вид две.
    const m = rt.medium
    if (!m || m.removed) return []
    const f = ctx.frame ?? 0
    if (m._drawnAt === f && m._drawnBy !== rt) return []
    m._drawnAt = f; m._drawnBy = rt
    const d = contour(rt, ctx, m.points)
    if (!d) return []
    return [{ k: 'path', d, fill: s.fill, stroke: s.edge, sw: 1.4, fillRule: 'evenodd', join: 'round', opacity: 0.92 }]
  },

  editor: {
    create: {
      start: () => ({ points: [], cursor: null }),
      click(draft, pt) { draft.points.push([pt.x, pt.y]) },
      move(draft, pt) { draft.cursor = pt },
      shapes(draft) {
        const pts = draft.cursor ? [...draft.points, [draft.cursor.x, draft.cursor.y]] : draft.points
        if (!pts.length) return []
        const out = [{ k: 'poly', pts, closed: pts.length > 2, fill: 'rgba(63,178,207,.3)', stroke: '#3fb2cf', sw: 2, dash: '6 6' }]
        for (const [x, y] of draft.points) out.push({ k: 'circle', x, y, r: 5, fill: '#3fb2cf' })
        return out
      },
      finish: (draft) => (draft.points.length >= 3
        ? { points: draft.points, polys: null, substance: 'water', density: 1.0, viscosity: 0.05, tension: 3.06, grain: 11, limit: 2000 }
        : null),
    },
    bounds: (data) => bboxOfRings(ringsOfData(data)),
    hit: (data, pt) => insideRegion(pt.x, pt.y, asMulti(data)),
    move(data, dx, dy) {
      if (data.polys) { for (const ring of data.polys.flat()) for (const p of ring) { p[0] += dx; p[1] += dy } }
      else for (const p of data.points) { p[0] += dx; p[1] += dy }
    },
    handles: (data) => (data.polys ? [] : data.points.map(([x, y], i) => ({ id: i, x, y }))),
    moveHandles(data, ids, dx, dy) { for (const i of ids) { data.points[i][0] += dx; data.points[i][1] += dy } },
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
      { key: 'substance', label: 'Вещество', type: 'select', options: Object.entries(SUBSTANCES).map(([k, v]) => ({ value: k, label: v.name })) },
      { key: 'density', label: 'Плотность (вода = 1)', type: 'range', min: 0.2, max: 3, step: 0.05 },
      { key: 'viscosity', label: 'Вязкость', type: 'range', min: 0, max: 0.9, step: 0.01 },
      { key: 'tension', label: 'Поверхностное натяжение', type: 'range', min: 0, max: 7, step: 0.1 },
      { key: 'grain', label: 'Шаг частиц, px', type: 'range', min: 6, max: 24, step: 1 },
      { key: 'limit', label: 'Предел частиц', type: 'range', min: 200, max: 5000, step: 100 },
    ],
  },
})

// Поверхность по тому же полю плотности, что решает физика: марширующие
// квадраты проводят линию по уровню и сшивают отрезки в замкнутые кольца.
// Отсюда само берётся всё, чего ждёшь от жидкости — струи сливаются, капля
// отрывается каплей.
function contour(rt, ctx, points) {
  const b = ctx.bounds
  if (!rt.mesher || rt.mesher.W !== b.w) {
    rt.mesher = new SurfaceMesher(b.w, b.h, rt.grain * MESH_CS, 1)
    rt.sim = { x: null, y: null, type: null, n: 0, bs: null, bnx: null, bny: null, inSolid: null }
  }
  // Зеркальные частицы за стенкой. Без них поле плотности у борта поддержано
  // только с одной стороны, изоповерхность не доходит до стенки, и берег
  // заворачивается вниз. Отражать есть от чего: контакт уже нашёл ближайшую
  // поверхность и записал её в точку. А попал ли призрак в твёрдое, спросим у
  // мира — он это и так умеет.
  rt.sim.inSolid = (gx, gy) => ctx.solidAt(gx, gy)
  const pts = points.filter((p) => !p.removed)
  const n = pts.length
  if (!n) return ''
  if (!rt.bufX || rt.bufX.length < n) {
    rt.bufX = new Float32Array(n * 2); rt.bufY = new Float32Array(n * 2)
    rt.bufT = new Int32Array(n * 2)
    rt.bufS = new Float32Array(n * 2)
    rt.bufNX = new Float32Array(n * 2); rt.bufNY = new Float32Array(n * 2)
  }
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    rt.bufX[i] = p.x; rt.bufY[i] = p.y; rt.bufT[i] = 0
    rt.bufS[i] = p.wallDist; rt.bufNX[i] = p.wallNx; rt.bufNY[i] = p.wallNy
  }
  rt.sim.x = rt.bufX; rt.sim.y = rt.bufY; rt.sim.type = rt.bufT; rt.sim.n = n
  rt.sim.bs = rt.bufS; rt.sim.bnx = rt.bufNX; rt.sim.bny = rt.bufNY
  const R = BLOB * rt.grain
  const used = rt.mesher.splat(rt.sim, 0, R)
  if (!used) return ''
  return rt.mesher.contour(ISO * bulkFieldValue(R, rt.grain), SMOOTH)
}
