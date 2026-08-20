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

// Шаг частиц — не свойство вещества, а разрешение расчёта, и в редакторе его нет.
//
// Раньше он считался «столько частиц, чтобы не съесть кадр»: большой пруд получал
// крупный шаг и становился зернистым. Это молчаливый размен качества на
// производительность, причём сделанный за дизайнера и вслепую — он не знает ни что
// разменивает, ни на что.
//
// Считаем от геометрии. Требование ровно одно и оно проверяемое: вода обязана
// затекать в самую узкую щель, какая на этом уровне возможна. Меряется это прямо —
// роем канал и считаем, сколько частиц в нём осело:
//
//   ширина щели / шаг частиц     3.6   2.5   2.2   1.7
//   осело от нормальной укладки  1.0   1.0   0.5   0.1
//
// То есть двух с половиной частиц поперёк хватает, полутора — нет. Отсюда ACROSS.
// Саму щель объявляют те, кто её создаёт (ctx.detail), а не вода: ей всё равно,
// от кого щель взялась.
//
// Второе требование — тоже абсолютное, а не «сколько потянем»: неровность стоячей
// поверхности должна быть меньше пикселя, то есть невидимой. Замер на уровне
// «Заводь»: шаг 14 даёт 2.4 px, шаг 11 — 0.6 px, и стоит это 4.0 против 4.3 мс на
// кадр. Двух десятых миллисекунды такая разница стоит, а дальше улучшать нечего:
// шаг 8 даёт 0.1 px и уже 7.8 мс. Отсюда MAX_STEP.
// MIN_STEP — предохранитель от нечаянного нуля в объявлении щели.
// ACROSS выведен, а не подобран. Предел ставит СЕТКА, а не частицы: щель уже одной
// клетки решатель давления просто не видит, и вода в неё не идёт ни при каком
// расталкивании — проверено вплоть до полного его отключения. Клетка равна двум
// шагам частиц (fluid.cellRatio), запас на то, что щель ляжет между узлами, — ещё
// четверть. Отсюда 2.5, и если поменять cellRatio, это число обязано поехать следом.
const MIN_STEP = 8, MAX_STEP = 11, CELL_RATIO = 2, ACROSS = 1.25 * CELL_RATIO

// Самая узкая щель в уже нарисованной геометрии.
//
// Объявления (ctx.detail) хватает только на то, чего ещё нет: подкоп появится
// когда-нибудь потом, и объявить его может лишь тот, кто копает. А рельеф, объект и
// узко нарисованный песок лежат в уровне прямо сейчас — их надо мерить, а не
// спрашивать, и тогда тип сущности не при чём вовсе.
//
// Меряем по хребту поля расстояний: точка, где до камня дальше, чем у соседей слева
// и справа (или сверху и снизу), лежит посередине прохода, и удвоенное расстояние
// там и есть его ширина. Считается один раз при рождении лужи.
function measured(ctx, poly) {
  const bb = bboxOfPoints(poly)
  const pad = 60, s = 5
  const x0 = bb.x - pad, x1 = bb.x + bb.w + pad
  const y0 = bb.y - pad, y1 = bb.y + bb.h + pad
  const nx = Math.min(220, Math.ceil((x1 - x0) / s)), ny = Math.min(220, Math.ceil((y1 - y0) / s))
  if (nx < 3 || ny < 3) return Infinity
  // В редакторе мира нет, поле расстояний спрашивать не у кого — там эта мерка
  // молчит, и предпросмотр честно говорит «≈», а не выдумывает число.
  if (!Number.isFinite(ctx.clearance(bb.x + bb.w / 2, bb.y + bb.h / 2, 200))) return Infinity
  const dx = (x1 - x0) / nx, dy = (y1 - y0) / ny
  const d = new Float64Array(nx * ny)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) d[i + j * nx] = ctx.clearance(x0 + i * dx, y0 + j * dy, 200)
  }
  let best = Infinity
  for (let j = 1; j < ny - 1; j++) {
    for (let i = 1; i < nx - 1; i++) {
      const k = i + j * nx, v = d[k]
      // Точку ровно на кромке камня пропускаем: расстояние там около нуля, и вдоль
      // самой кромки оно постоянно, так что формально она выглядит хребтом нулевой
      // ширины. Меньше шага выборки мы всё равно ничего не различаем.
      if (v <= Math.max(dx, dy)) continue
      // Строго больше обоих соседей. Нестрогое сравнение ловит и ровную стенку:
      // вдоль неё расстояние до камня постоянно, и вся полоса выглядит хребтом.
      const ridgeX = v > d[k - 1] && v > d[k + 1]
      const ridgeY = v > d[k - nx] && v > d[k + nx]
      if (!ridgeX && !ridgeY) continue           // не середина прохода, а просто у стенки
      if (v * 2 < best) best = v * 2
    }
  }
  return best
}

function stepFor(detail) {
  const want = (detail > 0 ? detail : Infinity) / ACROSS
  return Math.max(MIN_STEP, Math.min(MAX_STEP, want))
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
    viscosity: 0.06,
    mass: 1,
    color: '#3d7fb5',
    edge: '#7fc4e8',
    opacity: 0.82,
  }),

  spawn(ctx, data) {
    const poly = data.points.map(([x, y]) => ctx.place(x, y))
    const step = stepFor(Math.min(ctx.detail(), measured(ctx, poly)))
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
      const step = stepFor(Math.min(ctx.detail(), measured(ctx, poly)))
      const dots = lattice(poly, step)
      const every = Math.ceil(dots.length / 140)
      const out = [{ k: 'poly', pts: poly, closed: true, fill: data.color, opacity: 0.3, stroke: data.edge, sw: 2, dash: '7 6' }]
      for (let i = 0; i < dots.length; i += every) {
        out.push({ k: 'circle', x: dots[i][0], y: dots[i][1], r: step * 0.4, fill: data.color, opacity: 0.55 })
      }
      // Шаг в предпросмотре — верхняя граница: узкие щели уровня его ещё уменьшат,
      // а поля расстояний в редакторе нет. Врать точным числом хуже, чем показать «до».
      out.push({ k: 'text', x: (poly[0][0] + poly[2][0]) / 2, y: (poly[0][1] + poly[2][1]) / 2, text: `до ${dots.length} частиц, шаг ${step.toFixed(0)} и мельче`, size: 20, fill: data.edge })
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
        return { points: d.points, material: 'вода', ...MATERIALS['вода'], opacity: 0.82 }
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
      { key: 'mass', label: 'Плотность', type: 'range', min: 0.3, max: 2, step: 0.05 },
      { key: 'viscosity', label: 'Вязкость', type: 'range', min: 0, max: 1, step: 0.02 },
      { key: 'color', label: 'Цвет', type: 'color' },
      { key: 'edge', label: 'Кромка', type: 'color' },
      { key: 'opacity', label: 'Плотность цвета', type: 'range', min: 0.2, max: 1, step: 0.02 },
    ],
  },
})

export { MATERIALS }
