// Контакты: тело — тело и тело — область.
//
// Позиционная часть живёт внутри цикла проекции, скоростная — после него.
// Разделение принципиальное. Пока контакт с землёй «сохранял» скорость внутри
// цикла, треугольник из трёх шаров на земле разъезжался с 70 до 141 px и
// разваливался: любая позиционная поправка внутри цикла обязана оставаться
// позиционной, а скорость берётся из положений один раз, в конце.
//
// Нормальный импульс контакта здесь — накопленный множитель ограничения
// (store.lamN), а не служебная сумма выталкиваний. По нему считается кулоново
// трение: сила трения пропорциональна нормальному импульсу, и брать его из
// скоростного прохода нельзя — к тому моменту нормальная скорость уже погашена
// позиционной коррекцией, и трение считало бы нуль.

import { clamp, closestOnSegmentInto, insideRegion } from '../geom.js'
import { HashGrid, PAIRS_MIN } from '../nsearch.js'
import { F_POINTS, F_WORLD, F_FLUID } from '../particles.js'
import { StaticField } from '../sdfield.js'

// Во сколько раз сопротивление качению меньше трения скольжения при той же
// шершавости. У катка по грунту это примерно одна десятая, у стального шара по
// стали — на два порядка меньше; берём середину и позволяем гладкости
// поверхности развести эти случаи.
const ROLL_RESIST = 0.08

// Глубже этого за подшаг не разлипаем: глубокое взаимопроникновение должно
// расходиться постепенно, а не выстреливать.
const MAX_DEPTH = 16

// Рамка, которую должно накрыть поле: объединение всех неподвижных тел.
function boundsOf(phys) {
  // Мир, а не рамка тел: за её пределами поля нет, а частицы туда попадают —
  // вода стоит НАД полом, и её выносило бы за край поля.
  if (phys.bounds) return phys.bounds
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const c of phys.colliders) {
    const b = c.bbox
    if (!b) continue
    if (b.x < x0) x0 = b.x
    if (b.y < y0) y0 = b.y
    if (b.x + b.w > x1) x1 = b.x + b.w
    if (b.y + b.h > y1) y1 = b.y + b.h
  }
  if (x0 === Infinity) return { x: 0, y: 0, w: 1, h: 1 }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

// Отбор точек — отдельной функцией по той же причине, что и циклы подшага:
// внутри большого prepare тот же самый проход идёт на порядок медленнее.
//
//   solid — кто участвует в парах. Берём и тех, кто с телами не сталкивается,
//     но в среде тонет: ходячий шар нарочно проходит сквозь другие шары, а
//     проваливаться сквозь воду не должен;
//   src — кто пары ИЩЕТ. Контакт симметричен, пару довольно найти с одной
//     стороны, а частицы среды друг с другом не сталкиваются вовсе —
//     расстояние им держит давление. Шар найдёт их сам, в сетке они остаются.
const _st = { k: 0, q: 0, reach: 0, sumR: 0 }
function collect(s, solid, src, coh) {
  const FL = s.flags, GR = s.group, RD = s.radius, RC = s.reach, n = s.n
  const anyCoh = coh.size > 0
  let k = 0, q = 0, reach = 0, sumR = 0
  for (let i = 0; i < n; i++) {
    if (!(FL[i] & (F_POINTS | F_FLUID))) continue
    solid[k] = i
    sumR += RD[i]
    const r = RC[i]
    if (r > reach) reach = r
    if (!(anyCoh && coh.has(GR[i]))) src[q++] = k
    k++
  }
  _st.k = k; _st.q = q; _st.reach = reach; _st.sumR = sumR
  return _st
}

export class Contacts {
  constructor() {
    this.name = 'contacts'
    this.order = 40
    this.grid = new HashGrid()
    // Поле расстояний до неподвижной геометрии. Нужно тем, кто спрашивает её
    // тысячами запросов в кадр, — частицам среды. Телам оставляем точный путь
    // по полигонам: их единицы, и менять им поведение незачем.
    this.field = new StaticField(8)
    this.solid = new Int32Array(0)   // все, кто участвует в парах
    this.solidCount = 0
    this.src = new Int32Array(0)     // из них — те, кто пары ИЩЕТ
    this.srcCount = 0
    this._cand = []
    this._seg = { x: 0, y: 0, t: 0 }
    this._hit = { q: null, x: 0, y: 0, qx: 0, qy: 0, d: 0, edge: 0, t: 0 }
    this._out = { qx: 0, qy: 0, nx: 0, ny: 0, depth: 0, i: 0, t: 0 }
  }

  prepare(phys) {
    const s = phys.store
    // Ближайшую стенку ищем заново каждый подшаг: она только уменьшается,
    // пока её не сбросишь, а тела за подшаг разъезжаются.
    s.bs.fill(1e9, 0, s.n)
    if (this.solid.length < s.n) this.solid = new Int32Array(Math.max(s.n, 64))
    if (this.src.length < s.n) this.src = new Int32Array(Math.max(s.n, 64))
    // Группы частиц среды. Читаем их здесь, а не при заведении среды: группу
    // точке мир переустанавливает при привязке сущности, и раньше этого
    // момента она ещё не та.
    const coh = s.groups.cohesive
    coh.clear()
    for (const m of phys.mediums) {
      for (const p of m.points) { if (!p.removed) { coh.add(s.group[p._i]); break } }
    }
    const st = collect(s, this.solid, this.src, coh)
    const k = st.k
    this.solidCount = k
    this.srcCount = st.q
    // Группу коллайдера интернируем один раз на подшаг: в горячем цикле
    // сравниваются числа, а не строки.
    for (const c of phys.colliders) c._gid = s.groups.id(c.group)
    // Поле пересобирается, только если неподвижная геометрия изменилась —
    // мир сообщает об этом сам, увеличивая метку коллайдера.
    const reach = st.reach
    this.useField = reach > 0 && this.field.sync(phys.colliders, boundsOf(phys), reach + 8)
    this._anyDynamic = phys.colliders.some((c) => c.dynamic && !c.removed)
    // Сетку перекладываем раз на подшаг, а не на каждую итерацию: за итерацию
    // тела сдвигаются на доли пикселя, и запас в несколько пикселей
    // гарантирует, что в кандидатах окажется всё, что могло сойтись.
    // Если искать пары некому, сетка не нужна вовсе.
    if (k >= PAIRS_MIN) {
      this.grid.build(s, this.solid.subarray(0, k), ((st.sumR / k) + 6) * 2, null, 6)
      this.gridReady = true
    } else this.gridReady = false
  }

  project(phys, h, it = 0) {
    this._syncColliders(phys)
    this._pairs(phys)
    this._region(phys, h, it)
  }

  // --- тело против тела -----------------------------------------------------
  _pairs(phys) {
    const s = phys.store
    const ids = this.solid, n = this.solidCount
    if (n < PAIRS_MIN) {
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) this._push(s, ids[a], ids[b])
      }
      return
    }
    const src = this.src, sn = this.srcCount
    // Группы частиц среды. Читаем их здесь, а не при заведении среды: группу
    // точке мир переустанавливает при привязке сущности, и раньше этого
    // момента она ещё не та.
    const coh = s.groups.cohesive
    const anyCoh = coh.size > 0
    const cand = this._cand
    const X = s.x, Y = s.y, R = s.radius
    for (let q = 0; q < sn; q++) {
      const a = src[q], i = ids[a]
      // Ищущий спрашивает всех, кто дальше по списку, — так пара «ищущий и
      // ищущий» находится ровно один раз. А тех, кто сам не ищет, приходится
      // спрашивать и позади себя: иначе половина таких пар потеряется.
      this.grid.gather(X[i], Y[i], R[i], cand, anyCoh ? -1 : a)
      // Вставками, а не sort(): кандидатов единицы, и постоянные расходы
      // библиотечной сортировки тут дороже самой сортировки в разы. Порядок
      // обязан совпадать с полным перебором — проход последовательный.
      for (let u = 1; u < cand.length; u++) {
        const v = cand[u]
        let b = u - 1
        while (b >= 0 && cand[b] > v) { cand[b + 1] = cand[b]; b-- }
        cand[b + 1] = v
      }
      for (let u = 0; u < cand.length; u++) {
        const b = cand[u]
        if (b === a) continue
        if (anyCoh && b < a && !coh.has(s.group[ids[b]])) continue
        this._push(s, i, ids[b])
      }
    }
  }

  _push(s, a, b) {
    // Пара имеет право на контакт, если оба толкаются с телами — либо если
    // один из них частица среды, а второй в среде тонет.
    const fa = s.flags[a], fb = s.flags[b]
    if (!((fa & F_POINTS) && (fb & F_POINTS))) {
      const coh = s.groups.cohesive
      const ma = coh.has(s.group[a]), mb = coh.has(s.group[b])
      if (!(ma !== mb && (ma ? (fb & F_FLUID) : (fa & F_FLUID)))) return
    }
    const wa = s.w[a], wb = s.w[b]
    const sum = wa + wb
    if (!sum) return
    const dx = s.x[b] - s.x[a], dy = s.y[b] - s.y[a]
    const min = s.radius[a] + s.radius[b]
    if (dx > min || dx < -min || dy > min || dy < -min) return
    const d = Math.hypot(dx, dy)
    if (d >= min || d < 1e-9) return
    const push = (min - d) / d
    s.x[a] -= dx * push * (wa / sum); s.y[a] -= dy * push * (wa / sum)
    s.x[b] += dx * push * (wb / sum); s.y[b] += dy * push * (wb / sum)
  }

  _syncColliders(phys) {
    for (const c of phys.colliders) {
      if (!c.dynamic) continue
      for (let i = 0; i < c.verts.length; i++) {
        c.points[i][0] = c.verts[i].x
        c.points[i][1] = c.verts[i].y
      }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const ring of c.rings) {
        for (const p of ring) {
          if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]
          if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]
        }
      }
      c.bbox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
      if (c.index) c.index.build(c.polys)
      c.stamp++
    }
  }

  // --- тело против области --------------------------------------------------
  // Со статикой просто выталкиваем, с живым телом делим поправку по обратным
  // массам — тело получает отдачу: шар, упавший на край, разворачивает объект.
  _region(phys, h, it = 0) {
    const s = phys.store
    const inv = 1 / h
    const X = s.x, Y = s.y, W = s.w, F = s.flags, R = s.radius
    // Поле читаем прямо здесь, а не вызовом: вызов с массивом-ответом стоил
    // больше самой выборки — 124 нс на точку вместо десятка операций.
    const fld = this.useField ? this.field : null
    const FD = fld ? fld.d : null, FSM = fld ? fld.sm : null
    const fnx = fld ? fld.nx : 0, fny = fld ? fld.ny : 0
    const fx0 = fld ? fld.x0 : 0, fy0 = fld ? fld.y0 : 0
    const finv = fld ? 1 / fld.cell : 0
    const anyDyn = this._anyDynamic
    for (let i = 0; i < s.n; i++) {
      if (!W[i] || !(F[i] & F_WORLD)) continue
      const gi = s.group[i]
      const reach = s.reach[i]
      // Частица среды спрашивает поле, а не полигоны: тот же ответ за две
      // операции вместо проверки принадлежности и поиска ближайшего ребра.
      if (reach > 0 && fld) {
        const px = (X[i] - fx0) * finv, py = (Y[i] - fy0) * finv
        let cx = px | 0, cy = py | 0
        if (cx < 0) cx = 0; else if (cx > fnx - 2) cx = fnx - 2
        if (cy < 0) cy = 0; else if (cy > fny - 2) cy = fny - 2
        const tx = px - cx, ty = py - cy
        const kk = cy * fnx + cx
        const d00 = FD[kk], d10 = FD[kk + 1], d01 = FD[kk + fnx], d11 = FD[kk + fnx + 1]
        const ta = d00 + (d10 - d00) * tx, tb = d01 + (d11 - d01) * tx
        const dist = ta + (tb - ta) * ty
        let gx = (d10 - d00) * (1 - ty) + (d11 - d01) * ty
        let gy = (d01 - d00) * (1 - tx) + (d11 - d10) * tx
        const gl = Math.sqrt(gx * gx + gy * gy)
        if (gl < 1e-9) { gx = 0; gy = -1 } else { gx /= gl; gy /= gl }
        if (it === 0 && dist < s.bs[i]) {
          s.bs[i] = dist > 0 ? dist : 0
          s.bnx[i] = gx; s.bny[i] = gy
          s.brg[i] = 1 - FSM[kk]
        }
        if (dist < R[i]) {
          const push = R[i] - dist
          X[i] += gx * push; Y[i] += gy * push
          s.lamN[i] += push * inv
        }
        // Неподвижную геометрию поле уже закрыло. Подвижную, если она есть,
        // по-прежнему обходим точно — её мало.
        if (!anyDyn) continue
      }
      // Кто знает расстояние до ближайшей поверхности (то есть щупает её
      // издалека) и заведомо до неё не достаёт — коллайдеры не обходит.
      // Внутри подшага частица сдвигается на доли пикселя, запас в пиксель
      // это покрывает с избытком.
      // Кто знает расстояние до ближайшей поверхности и заведомо до неё не
      // достаёт — коллайдеры не обходит. Внутри подшага частица сдвигается на
      // доли пикселя, запас в пиксель это покрывает.
      if (it > 0 && reach > 0 && s.bs[i] > R[i] + 1) continue
      const sense0 = it === 0 && reach > 0
      const far = R[i] + (sense0 ? reach : 0)
      const xi = X[i], yi = Y[i]
      // Рамку проверяем ЗДЕСЬ, а не внутри _contact. Из 28 800 запросов за
      // кадр до настоящей работы доходили 583 — остальные отсеивались рамкой,
      // но платили за вызов метода и за итератор по коллайдерам. Индексный
      // цикл и проверка на месте убирают эту плату.
      const cols = phys.colliders
      const skipStatic = reach > 0 && fld
      for (let ci = 0; ci < cols.length; ci++) {
        const c = cols[ci]
        if (skipStatic && !c.dynamic) continue
        if (gi && c._gid === gi) continue
        const bb = c.bbox
        if (!bb || !c.rings || !c.rings.length) continue
        if (xi + far < bb.x || xi - far > bb.x + bb.w) continue
        if (yi + far < bb.y || yi - far > bb.y + bb.h) continue
        // Два РАЗНЫХ вопроса к одной геометрии, и стоят они по-разному.
        //
        // Оттолкнуться — вопрос на каждой итерации: положение за итерацию
        // меняется. Достаточно радиуса точки, и поиск выходит дешёвым.
        //
        // Почуять стенку издалека (reach — частице среды нужен радиус ядра,
        // иначе у борта она выглядит разреженной) — вопрос РАЗ В ПОДШАГ:
        // внутри подшага стенка не движется, а искать её в радиусе ядра втрое
        // дороже. Спрашиваем на первой итерации, дальше пользуемся ответом.
        const sense = sense0
        const ct = this._contact(s, i, c, sense ? reach : 0)
        if (!ct) continue
        if (sense) {
          const gap = R[i] - ct.depth      // расстояние до поверхности со знаком
          if (gap < s.bs[i]) {
            s.bs[i] = gap > 0 ? gap : 0
            s.bnx[i] = ct.nx; s.bny[i] = ct.ny
            s.brg[i] = 1 - (c.smoothness ?? 0.5)
          }
        }
        if (ct.depth <= 0) continue        // стенку почуяли, но не коснулись
        if (!c.dynamic) {
          const tx = ct.qx + ct.nx * R[i], ty = ct.qy + ct.ny * R[i]
          const dx = tx - X[i], dy = ty - Y[i]
          s.lamN[i] += Math.hypot(dx, dy) * inv
          X[i] = tx; Y[i] = ty
          continue
        }
        const a = c.verts[ct.i], b = c.verts[(ct.i + 1) % c.verts.length]
        const t = ct.t
        const ia = a._i, ib = b._i
        const wp = W[i]
        const wa = W[ia], wb = W[ib]
        const we = (1 - t) * (1 - t) * wa + t * t * wb
        const sum = wp + we
        if (!sum) continue
        const d = Math.min(ct.depth, MAX_DEPTH)
        s.lamN[i] += d * (wp / sum) * inv
        X[i] += ct.nx * d * (wp / sum); Y[i] += ct.ny * d * (wp / sum)
        if (wa) { X[ia] -= ct.nx * d * ((1 - t) * wa) / sum; Y[ia] -= ct.ny * d * ((1 - t) * wa) / sum }
        if (wb) { X[ib] -= ct.nx * d * (t * wb) / sum; Y[ib] -= ct.ny * d * (t * wb) / sum }
      }
    }
  }

  // --- скоростная часть -----------------------------------------------------
  velocity(phys) {
    const s = phys.store
    const VX = s.vx, VY = s.vy, W = s.w, F = s.flags, R = s.radius
    for (let i = 0; i < s.n; i++) {
      if (!W[i] || !(F[i] & F_WORLD)) continue
      // Не коснулся — не трётся. Расстояние до ближайшей поверхности уже
      // найдено проекцией, и заново опрашивать геометрию незачем.
      if (s.reach[i] > 0 && s.bs[i] > R[i] + 0.5) continue
      const gi = s.group[i]
      for (const c of phys.colliders) {
        if (gi && c._gid === gi) continue
        const ct = this._contact(s, i, c, 0.5)
        if (!ct) continue
        const { nx, ny } = ct

        let sx = 0, sy = 0
        if (c.dynamic) { // скорость самой поверхности в точке касания
          const a = c.verts[ct.i], b = c.verts[(ct.i + 1) % c.verts.length]
          sx = VX[a._i] * (1 - ct.t) + VX[b._i] * ct.t
          sy = VY[a._i] * (1 - ct.t) + VY[b._i] * ct.t
        }
        const vx = VX[i] - sx, vy = VY[i] - sy
        const vn = vx * nx + vy * ny

        const rest = (s.rest[i] + c.restitution) * 0.5
        // Гладкость 0 — шершавая поверхность, 1 — лёд.
        const avg = clamp((s.smooth[i] + c.smoothness) * 0.5, 0, 1)
        const mu = 1 - avg
        const tx = -ny, ty = nx
        const vt = vx * tx + vy * ty
        const nvn = vn < 0 ? -vn * rest : vn
        const j = s.lamN[i] + (vn < 0 ? -vn * (1 + rest) : 0)

        let nvt
        if (!s.rigid[i] && R[i] > 1e-3) {
          // Свободный диск катится. Трение действует не на центр, а на точку
          // касания: проскальзывание там равно vt − ω·r. Импульс J меняет и
          // скорость (J/m), и вращение (−J·r/I); для диска I = ½mr², поэтому
          // проскальзывание убывает втрое быстрее скорости центра и быстро
          // обнуляется — дальше шар катится почти без потерь.
          const slip = vt - s.spin[i] * R[i]
          const sg = slip < 0 ? -1 : slip > 0 ? 1 : 0
          const dv = Math.min(Math.abs(slip) / 3, mu * j)
          nvt = vt - sg * dv
          s.spin[i] += (sg * dv * 2) / R[i]

          // Сопротивление качению: пятно контакта мнётся тем сильнее, чем мягче
          // и шершавее опора, то есть его задаёт та же гладкость. Считается
          // относительно самой опоры, поэтому на едущей платформе оно не
          // тормозит груз, а подтягивает его к её скорости.
          const brake = Math.min(Math.abs(nvt), mu * ROLL_RESIST * j)
          if (brake > 0) {
            const rs = nvt < 0 ? -1 : 1
            nvt -= rs * brake
            s.spin[i] -= (rs * brake) / R[i]
          }
        } else {
          const drop = Math.min(Math.abs(vt), mu * j)
          nvt = vt - Math.sign(vt) * drop
        }
        VX[i] = nvn * nx + nvt * tx + sx
        VY[i] = nvn * ny + nvt * ty + sy
      }
    }
  }

  // Граница области — это все её кольца, включая дырки. У крупных областей
  // спрашиваем индекс, у мелких перебираем: ответ обязан быть один и тот же.
  //
  // Раньше эти две функции создавались замыканиями внутри _contact — то есть
  // по два объекта на каждую проверку каждой частицы против каждой области.
  // На тысяче частиц среды это заметная доля кадра, поэтому они здесь.
  _inside(c, x, y) {
    return c.index ? c.index.inside(x, y) : insideRegion(x, y, c.polys)
  }

  // limit > 0 — «дальше не интересно»: тому, кто снаружи, граница дальше
  // собственного радиуса не нужна, он её не касается.
  _closest(c, x, y, limit) {
    if (c.index) return c.index.closest(x, y, limit)
    const seg = this._seg, out = this._hit
    let best = Infinity, edge = 0
    out.q = null
    for (const ring of c.rings) {
      for (let k = 0, n = ring.length; k < n; k++) {
        const a = ring[k], b = ring[(k + 1) % n]
        closestOnSegmentInto(seg, x, y, a[0], a[1], b[0], b[1])
        const d = Math.hypot(x - seg.x, y - seg.y)
        if (d < best) { best = d; out.qx = seg.x; out.qy = seg.y; out.q = out; edge = k; out.t = seg.t }
      }
    }
    out.x = out.qx; out.y = out.qy
    out.d = best; out.edge = edge
    return out
  }

  // Ближайшая точка границы и внешняя нормаль, если тело её касается.
  _contact(s, i, c, slack) {
    const rings = c.rings
    if (!rings || !rings.length) return null
    const bb = c.bbox
    const px = s.x[i], py = s.y[i], r = s.radius[i]
    // Рамку раздуваем на ВЕСЬ интерес точки, а не на один её радиус.
    //
    // Иначе рамка отсекает строже самого запроса: скоростной проход
    // спрашивает геометрию с запасом 0.5, но точка в зазоре от r до r+0.5
    // отсеивалась здесь же — хотя проверка расстояния её бы приняла. Тому, кто
    // щупает стенку издалека (reach), это и вовсе закрывало обзор.
    //
    // Правка меняет поведение тел: трение теперь прикладывается там, где
    // контакт по логике есть. Тест holelevel показывает другой переходный
    // процесс (шар на 3-й секунде идёт иначе), но приходит туда же.
    const far = r + slack
    if (px + far < bb.x || px - far > bb.x + bb.w) return null
    if (py + far < bb.y || py - far > bb.y + bb.h) return null

    // Снаружи граница интересна только в пределах своего радиуса — этим
    // ограничением индекс живёт одним просмотром вместо расширяющегося поиска.
    const inside = this._inside(c, px, py)
    const near = inside ? this._closest(c, px, py, 0) : this._closest(c, px, py, r + slack)
    if (!near || !near.q) return null
    let q = near.q, d = near.d, edge = near.edge, t = near.t
    if (!inside && d >= r + slack) return null

    let nx, ny
    if (inside && !this._inside(c, s.sx[i], s.sy[i])) {
      // влетел за один подшаг — выталкиваем туда, откуда пришёл
      const prev = this._closest(c, s.sx[i], s.sy[i], 0)
      q = prev.q; edge = prev.edge; t = prev.t
      const dx = s.sx[i] - q.x, dy = s.sy[i] - q.y
      const len = Math.hypot(dx, dy) || 1e-9
      nx = dx / len; ny = dy / len
    } else if (d < 1e-6) { nx = 0; ny = -1 } else {
      nx = (px - q.x) / d; ny = (py - q.y) / d
      if (inside) { nx = -nx; ny = -ny }
    }

    const o = this._out
    o.qx = q.x; o.qy = q.y; o.nx = nx; o.ny = ny
    o.depth = inside ? r + d : r - d
    o.i = edge; o.t = t
    return o
  }
}
