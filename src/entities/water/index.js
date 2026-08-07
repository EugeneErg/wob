import { defineEntity } from '../../core/registry.js'
import { LAYERS } from '../../core/globals.js'
import { bboxOfPoints, pointInPoly } from '../../core/geom.js'
import { contours } from '../../core/contour.js'

// Среда: вода, масло, мёд, кисель.
//
// Сущность задаёт область, которую при старте заполняет частицами, и числа
// вещества. Дальше она в физику не вмешивается совсем: объём держит ограничение
// плотности, поверхность считается по тому же полю, а с миром среда
// взаимодействует ровно так же, как всё остальное, — расталкиванием по обратным
// массам. Поэтому вода сама выталкивает лёгкое, топит тяжёлое, стекает в
// свежую лунку и рябит от вентилятора: ничего из этого тут не написано.
//
// Вода и мёд — не разные сущности, а разные числа: вязкость и сцепление.
// Одинаковое «вещество» у двух луж — одна фаза, они смешиваются. Разное —
// расслаиваются сами, по плотности.

const MATERIALS = {
  вода: { viscosity: 0.06, mass: 1, color: '#3d7fb5', edge: '#7fc4e8' },
  масло: { viscosity: 0.3, mass: 0.55, color: '#8a6a2f', edge: '#d0a84e' },
  мёд: { viscosity: 0.9, mass: 1.4, color: '#8a5a12', edge: '#e0a63a' },
  кисель: { viscosity: 0.6, mass: 1.1, color: '#7a2f52', edge: '#c9678f' },
}

// Шаг частиц — не свойство вещества, а разрешение расчёта, и выбирать его
// пользователю незачем. Считаем сами: столько, чтобы на область пришлось около
// TARGET частиц. Маленькая лужа получит мелкий шаг и будет гладкой даром,
// большая — крупный и не съест кадр. Границы не дают уйти в крайности.
const TARGET = 750, MIN_STEP = 8, MAX_STEP = 18
function stepFor(poly) {
  const bb = bboxOfPoints(poly)
  let area = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    area += a[0] * b[1] - b[0] * a[1]
  }
  area = Math.abs(area) / 2 || bb.w * bb.h
  return Math.max(MIN_STEP, Math.min(MAX_STEP, Math.sqrt(area / TARGET)))
}

// Шестиугольная укладка: у неё расстояние до всех шести соседей одинаковое,
// поэтому именно её и «ожидает» измеренная плотность покоя.
function lattice(poly, step, place) {
  const bb = bboxOfPoints(poly)
  const dy = step * Math.sqrt(3) / 2
  const out = []
  let row = 0
  for (let y = bb.y + step * 0.5; y < bb.y + bb.h; y += dy, row++) {
    for (let x = bb.x + (row & 1 ? step : step * 0.5); x < bb.x + bb.w; x += step) {
      if (!pointInPoly(x, y, poly)) continue
      out.push(place ? place(x, y) : [x, y])
    }
  }
  return out
}

export default defineEntity({
  type: 'liquid',
  title: 'Жидкость',
  z: LAYERS.ground - 1,   // под рельефом: край воды честно уходит под берег
  icon: '<svg viewBox="0 0 24 24"><path d="M12 3c4 5 6 7.5 6 10a6 6 0 0 1-12 0c0-2.5 2-5 6-10z" fill="currentColor"/></svg>',

  defaults: () => ({
    points: [],
    material: 'вода',
    spacing: 0,        // 0 — подобрать по размеру области
    viscosity: 0.06,
    mass: 1,
    color: '#3d7fb5',
    edge: '#7fc4e8',
    opacity: 0.82,
  }),

  spawn(ctx, data) {
    const poly = data.points.map(([x, y]) => ctx.place(x, y))
    const step = data.spacing > 0 ? data.spacing : stepFor(poly)
    const phase = ctx.addPhase({
      key: data.material || 'вода',
      spacing: step,
      viscosity: data.viscosity,
      mass: data.mass,
    })
    const rt = { phase, ps: [], rings: [], edges: [], step, solid: (x, y) => ctx.solidAt(x, y) }
    rt.step = step
    for (const [x, y] of lattice(poly, step)) {
      rt.ps.push(ctx.addPoint({
        x, y,
        // Радиус ровно в полшага: расталкивание не держит объём — это работа
        // сетки, — но не даёт частицам сбиваться комками, а от равномерной
        // раскладки и зависит гладкость поверхности.
        radius: step * 0.5,
        mass: data.mass,
        phase: phase.id,
        smoothness: 1,
        restitution: 0,
        attachable: false,
      }))
    }
    return rt
  },

  update(rt, ctx, dt, data) {
    // Убежавшее за пределы уровня удаляем: иначе оно навсегда останется в
    // расчёте, продолжая падать в никуда.
    const b = ctx.bounds, m = 300
    let moved = 0
    for (let i = rt.ps.length - 1; i >= 0; i--) {
      const p = rt.ps[i]
      if (p.x < b.x - m || p.x > b.x + b.w + m || p.y < b.y - m || p.y > b.y + b.h + m) {
        ctx.removePoint(p)
        rt.ps.splice(i, 1)
        moved = 1
        continue
      }
    }
    // Поверхность пересчитываем, только когда она могла заметно измениться.
    // У лежащей воды остаточное дрожание — сотые доли пикселя за кадр, и
    // считать по нему заново тот же самый контур незачем.
    const n = rt.ps.length
    if (rt.X?.length !== n) { rt.X = new Float64Array(n); rt.Y = new Float64Array(n); moved = 1 }
    let far = 0
    for (let i = 0; i < n; i++) {
      const dx = rt.ps[i].x - rt.X[i], dy = rt.ps[i].y - rt.Y[i]
      const d = dx * dx + dy * dy
      if (d > far) far = d
    }
    // Порог маленький нарочно: с большим поверхность подолгу стоит и потом
    // разом перескакивает на новое место — это заметно сильнее, чем плавное
    // движение, которое он экономил.
    if (moved || far > 0.09 || !rt.rings.length) {
      for (let i = 0; i < n; i++) { rt.X[i] = rt.ps[i].x; rt.Y[i] = rt.ps[i].y }
      rt.rings = contours(rt.X, rt.Y, n, rt.step, { solid: rt.solid })
      // Светлая кромка — это блик свободной поверхности. Там, где вода лежит на
      // камне, ей взяться неоткуда: контур в этом месте уходит в берег, и
      // подсвечивать его — значит рисовать светлую черту посреди воды.
      rt.edges = []
      for (const ring of rt.rings) {
        let run = null
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length]
          // Щупаем не только середину отрезка, но и вокруг неё: иначе блик
          // остаётся крючком там, где кромка уже подошла к берегу вплотную,
          // но формально ещё в воде.
          const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
          if (rt.solid(mx, my) || rt.solid(mx - 5, my) || rt.solid(mx + 5, my) ||
              rt.solid(mx, my - 5) || rt.solid(mx, my + 5)) { run = null; continue }
          if (!run) { run = [a]; rt.edges.push(run) }
          run.push(b)
        }
      }
    }
  },

  shapes(data, rt, ctx) {
    if (!rt) {
      // в редакторе показываем область и то, чем она заполнится
      const poly = data.points.map(([x, y]) => ctx.place(x, y))
      if (poly.length < 3) return []
      // Показываем область и укладку, но не все частицы: их бывает под тысячу,
      // и тысяча кружков в редакторе тормозит сильнее, чем сама вода в игре.
      const step = data.spacing > 0 ? data.spacing : stepFor(poly)
      const dots = lattice(poly, step)
      const every = Math.ceil(dots.length / 140)
      const out = [{ k: 'poly', pts: poly, closed: true, fill: data.color, opacity: 0.3, stroke: data.edge, sw: 2, dash: '7 6' }]
      for (let i = 0; i < dots.length; i += every) {
        out.push({ k: 'circle', x: dots[i][0], y: dots[i][1], r: step * 0.4, fill: data.color, opacity: 0.55 })
      }
      out.push({ k: 'text', x: (poly[0][0] + poly[2][0]) / 2, y: (poly[0][1] + poly[2][1]) / 2, text: `${dots.length} частиц, шаг ${step.toFixed(0)}`, size: 20, fill: data.edge })
      return out
    }
    if (!rt.rings.length) return []
    return [
      ...rt.rings.map((ring) => ({
        k: 'poly', pts: ring, closed: true, fill: data.color, opacity: data.opacity,
      })),
      ...rt.edges.map((run) => ({
        k: 'poly', pts: run, closed: false, fill: 'none',
        stroke: data.edge, sw: 2, cap: 'round', join: 'round',
      })),
    ]
  },

  editor: {
    create: {
      start: () => ({ points: [], cursor: null }),
      click(d, pt) { d.points.push([pt.x, pt.y]) },
      move(d, pt) { d.cursor = pt },
      shapes(d) {
        const pts = d.cursor ? [...d.points, [d.cursor.x, d.cursor.y]] : d.points
        if (!pts.length) return []
        const out = [{ k: 'poly', pts, closed: pts.length > 2, fill: 'rgba(61,127,181,.3)', stroke: '#7fc4e8', sw: 2, dash: '6 6' }]
        for (const [x, y] of d.points) out.push({ k: 'circle', x, y, r: 5, fill: '#7fc4e8' })
        return out
      },
      finish(d) {
        if (d.points.length < 3) return null
        return { points: d.points, material: 'вода', spacing: 0, ...MATERIALS['вода'], opacity: 0.82 }
      },
    },

    bounds: (d) => bboxOfPoints(d.points),
    hit: (d, pt) => pointInPoly(pt.x, pt.y, d.points),
    move(d, dx, dy) { for (const p of d.points) { p[0] += dx; p[1] += dy } },
    handles: (d) => d.points.map(([x, y], i) => ({ id: i, x, y })),
    moveHandles(d, ids, dx, dy) { for (const i of ids) { d.points[i][0] += dx; d.points[i][1] += dy } },
    deleteHandles(d, ids) {
      const keep = d.points.filter((_, i) => !ids.includes(i))
      if (keep.length < 3) return false
      d.points = keep
      return true
    },

    props: () => [
      { key: 'material', label: 'Вещество (общее имя — общая среда)', type: 'text' },
      { key: 'spacing', label: 'Шаг частиц (0 — подобрать самому)', type: 'range', min: 0, max: 24, step: 1 },
      { key: 'mass', label: 'Плотность', type: 'range', min: 0.3, max: 2, step: 0.05 },
      { key: 'viscosity', label: 'Вязкость', type: 'range', min: 0, max: 1, step: 0.02 },
      { key: 'color', label: 'Цвет', type: 'color' },
      { key: 'edge', label: 'Кромка', type: 'color' },
      { key: 'opacity', label: 'Плотность цвета', type: 'range', min: 0.2, max: 1, step: 0.02 },
    ],
  },
})

export { MATERIALS }
