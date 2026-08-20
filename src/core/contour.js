// Поверхность среды.
//
// Рисовать частицы кружками — врать: у воды нет частиц, у неё есть поверхность.
// Поэтому поверхность именно считается: раскладываем частицы в поле плотности и
// проводим линию по уровню. Поле то же самое по смыслу, что решает физика, —
// значит картинка не может разойтись с поведением. Тонкая плёнка нарисуется
// плёнкой, две струи, коснувшись, сольются в одну, капля оторвётся каплей, и
// ничего из этого не надо программировать отдельно.
//
// Способ — марширующие квадраты. Сетка узлов, в каждом сумма вклада соседних
// частиц; клетка, у которой одни углы выше уровня, а другие ниже, отдаёт отрезок;
// отрезки сшиваются в замкнутые кольца. Сшивать можно точно, без допусков:
// точка пересечения принадлежит ребру сетки, а у ребра есть номер, и соседняя
// клетка вычислит для того же ребра ровно то же число.

// Ядро для картинки берём простое и с конечным носителем: (1 − t²)², t = r/R.
// Гладкое на краю, поэтому и контур получается гладким.
// Радиус вклада в шагах решётки. Чем шире, тем меньше в контуре видно
// отдельную частицу: поверхность становится средним по многим, а не суммой
// бугорков. Платим тем, что тонкие струйки чуть толстеют, а близкие капли
// сливаются раньше.
const REACH = 2



export function contours(px, py, count, spacing, opts = {}) {
  if (!count) return []
  const R = spacing * (opts.reach ?? REACH)
  const cell = opts.cell ?? spacing * 0.75
  // Поверхность — там, где поле обращается в ноль. У Чжу — Бридсона это не порог,
  // подобранный под плотность, а само определение: phi = rср - |x - xср|. Прежняя
  // доля от «значения в толще» была нужна лишь потому, что сумма ядер зависит от
  // ширины ядра целиком, и порог приходилось таскать за ней следом.
  const iso = 0
  const pad = R + cell

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i < count; i++) {
    if (px[i] < x0) x0 = px[i]; if (px[i] > x1) x1 = px[i]
    if (py[i] < y0) y0 = py[i]; if (py[i] > y1) y1 = py[i]
  }
  // Узлы сетки прибиты к мировым координатам: иначе при малейшем сдвиге рамки
  // всё поле уезжает на долю клетки, и память между кадрами теряет смысл.
  x0 = Math.floor((x0 - pad) / cell) * cell
  y0 = Math.floor((y0 - pad) / cell) * cell
  x1 += pad; y1 += pad
  const nx = Math.ceil((x1 - x0) / cell) + 1
  const ny = Math.ceil((y1 - y0) / cell) + 1
  if (nx * ny > 400000) return []          // защита от абсурдных размеров

  // 1. Поле поверхности — по Чжу — Бридсону: phi = |x - xср| - rср, где xср это
  //    взвешенное СРЕДНЕЕ положение соседних частиц, а rср — их средний размер.
  //
  //    Здесь долго стояла сумма ядер с порогом (метаболы): F = sum w, поверхность там,
  //    где F = iso. Она кажется тем же самым, но ведёт себя иначе в одном решающем
  //    месте — у границы. Сумма падает всюду, где соседей меньше: у стенки вдвое, в
  //    углу вчетверо. Отсюда и просадка уровня у берега, и срезанные дугой углы —
  //    те самые «закруглённые пустоты» по нижним краям. Лечить это приходилось
  //    заливкой узлов, потом зеркальными частицами, потом делением на видимую долю
  //    окрестности: три подхода, и каждый требовал знать, где камень.
  //
  //    У Чжу — Бридсона делить не на что: формула НОРМИРОВАНА. Пропали соседи слева —
  //    уменьшились и числитель, и знаменатель, среднее осталось на месте. Поверхность
  //    у стенки, в углу и посреди лужи считается одинаково, и про камень поле не
  //    спрашивает вовсе. Это и есть ответ на вопрос «как алгоритм ищет берег»: никак,
  //    ему это не нужно.
  const F = new Float32Array(nx * ny)
  const WX = new Float32Array(nx * ny)
  const WY = new Float32Array(nx * ny)
  const WW = new Float32Array(nx * ny)
  const rad = Math.ceil(R / cell)
  const R2 = R * R
  for (let i = 0; i < count; i++) {
    const cx = (px[i] - x0) / cell, cy = (py[i] - y0) / cell
    const i0 = Math.max(0, Math.floor(cx) - rad), i1 = Math.min(nx - 1, Math.ceil(cx) + rad)
    const j0 = Math.max(0, Math.floor(cy) - rad), j1 = Math.min(ny - 1, Math.ceil(cy) + rad)
    for (let j = j0; j <= j1; j++) {
      const dy = y0 + j * cell - py[i]
      const dy2 = dy * dy
      for (let a = i0; a <= i1; a++) {
        const dx = x0 + a * cell - px[i]
        const r2 = dx * dx + dy2
        if (r2 >= R2) continue
        const t = 1 - r2 / R2
        const w = t * t * t
        const k = j * nx + a
        WW[k] += w
        WX[k] += w * px[i]
        WY[k] += w * py[i]
      }
    }
  }
  // Знак: внутри воды отрицательно, снаружи положительно. Дальше по коду ищется
  // линия уровня iso, поэтому переворачиваем — пусть «много воды» будет большим.
  const grain = spacing * 0.5      // средний размер частицы в укладке
  for (let k = 0; k < nx * ny; k++) {
    const w = WW[k]
    if (w <= 0) { F[k] = -R; continue }   // вне носителя поле обязано быть строго отрицательным,
                                          // иначе линия уровня цепляется за край носителя
    const dx = x0 + (k % nx) * cell - WX[k] / w
    const dy = y0 + ((k - (k % nx)) / nx) * cell - WY[k] / w
    F[k] = grain - Math.hypot(dx, dy)
  }

  // 1б. Берег: продлеваем поле внутрь камня вдоль нормали.
  //
  // Само поле про камень не спрашивает и не должно — формула нормирована, у стенки и в
  // углу она считается ровно так же, как посреди лужи. Но у поверхности воды есть край,
  // а у берега края быть не должно: вода касается камня, и линия уровня обязана уходить
  // ПОД него, а не обрываться перед ним. Иначе у дна между контуром и камнем остаётся
  // клин, а у стенки — щель.
  //
  // Здесь стоял разлив: узел внутри камня брал ЛУЧШЕЕ значение соседей, и так несколько
  // проходов. Разлив идёт во все стороны сразу, в том числе вверх, — и вода заползала по
  // стенке внутри камня выше своего уровня. Снаружи это видно как «по краям тянется
  // вверх»: у кромки берега контур задирается, а у дна всё равно не достаёт.
  //
  // Канон продлевает поле ВДОЛЬ НОРМАЛИ к берегу: узел внутри камня берёт значение
  // ближайшего к нему узла снаружи. Тогда узел на глубине воды получает воду и контур
  // уходит под берег, а узел выше уровня — воздух, и подняться ему не от кого.
  // Ближайший снаружи находится развёрткой по маске за два прохода: она же даёт и
  // расстояние, и направление.
  if (opts.solid) {
    const solid = new Uint8Array(nx * ny)
    for (let j = 0; j < ny; j++) {
      const y = y0 + j * cell
      for (let i = 0; i < nx; i++) if (opts.solid(x0 + i * cell, y)) solid[i + j * nx] = 1
    }
    const INF = 1 << 28
    const ox = new Int16Array(nx * ny), oy = new Int16Array(nx * ny)
    const dd = new Int32Array(nx * ny)
    for (let k = 0; k < nx * ny; k++) dd[k] = solid[k] ? INF : 0
    const relax = (k, kn, sx, sy) => {
      if (dd[kn] >= INF) return
      const ax = ox[kn] + sx, ay = oy[kn] + sy
      const t = ax * ax + ay * ay
      if (t < dd[k]) { dd[k] = t; ox[k] = ax; oy[k] = ay }
    }
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = i + j * nx
        if (!solid[k]) continue
        if (i > 0) relax(k, k - 1, 1, 0)
        if (j > 0) relax(k, k - nx, 0, 1)
        if (i > 0 && j > 0) relax(k, k - nx - 1, 1, 1)
        if (i < nx - 1 && j > 0) relax(k, k - nx + 1, -1, 1)
      }
    }
    for (let j = ny - 1; j >= 0; j--) {
      for (let i = nx - 1; i >= 0; i--) {
        const k = i + j * nx
        if (!solid[k]) continue
        if (i < nx - 1) relax(k, k + 1, -1, 0)
        if (j < ny - 1) relax(k, k + nx, 0, -1)
        if (i < nx - 1 && j < ny - 1) relax(k, k + nx + 1, -1, -1)
        if (i > 0 && j < ny - 1) relax(k, k + nx - 1, 1, -1)
      }
    }
    const src = F.slice(0, nx * ny)
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = i + j * nx
        if (!solid[k] || dd[k] >= INF) continue
        const mi = i + ox[k], mj = j + oy[k]
        if (mi < 0 || mi >= nx || mj < 0 || mj >= ny) continue
        F[k] = src[mi + mj * nx]
      }
    }
  }

  // 1в. Внутренние пустоты.
  //
  // В углу нехватка соседей остаётся и по ту сторону границы, уже в самой воде:
  // там получается ямка ниже уровня, замкнутая со всех сторон. Контур честно
  // обводит её отдельным кольцом — и в углу появляется дырка.
  //
  // Разлив от края сетки помечает всё, что связано с наружной пустотой.
  // Непомеченное ниже уровня — это и есть замкнутые ямки, их поднимаем.
  // Заодно исчезают любые другие мнимые пузыри внутри воды.
  if (opts.solid) {
    const seen = new Uint8Array(nx * ny)
    const stack = []
    for (let i = 0; i < nx; i++) { stack.push(i, (ny - 1) * nx + i) }
    for (let j = 0; j < ny; j++) { stack.push(j * nx, j * nx + nx - 1) }
    while (stack.length) {
      const k = stack.pop()
      if (seen[k] || F[k] >= iso) continue
      seen[k] = 1
      const i = k % nx, j = (k - i) / nx
      if (i > 0) stack.push(k - 1)
      if (i < nx - 1) stack.push(k + 1)
      if (j > 0) stack.push(k - nx)
      if (j < ny - 1) stack.push(k + nx)
    }
    for (let k = 0; k < F.length; k++) if (F[k] < iso && !seen[k]) F[k] = grain
  }

  // 2. точки пересечения на рёбрах сетки; у каждого ребра свой номер, поэтому
  //    соседние клетки получают одну и ту же точку без всяких сравнений с допуском
  const HN = (nx - 1) * ny            // горизонтальных рёбер
  const cross = new Map()
  const at = (i, j) => F[j * nx + i]
  const hEdge = (i, j) => {
    const k = j * (nx - 1) + i
    let p = cross.get(k)
    if (p === undefined) {
      const a = at(i, j), b = at(i + 1, j)
      const t = (iso - a) / (b - a)
      p = [x0 + (i + t) * cell, y0 + j * cell]
      cross.set(k, p)
    }
    return k
  }
  const vEdge = (i, j) => {
    const k = HN + j * nx + i
    let p = cross.get(k)
    if (p === undefined) {
      const a = at(i, j), b = at(i, j + 1)
      const t = (iso - a) / (b - a)
      p = [x0 + i * cell, y0 + (j + t) * cell]
      cross.set(k, p)
    }
    return k
  }

  // 3. марш по клеткам: каждая отдаёт от нуля до двух отрезков
  const next = new Map()   // от какого ребра к какому идёт контур
  const link = (a, b) => { next.set(a, b) }
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const tl = at(i, j), tr = at(i + 1, j), br = at(i + 1, j + 1), bl = at(i, j + 1)
      let code = 0
      if (tl > iso) code |= 8
      if (tr > iso) code |= 4
      if (br > iso) code |= 2
      if (bl > iso) code |= 1
      if (code === 0 || code === 15) continue
      const T = () => hEdge(i, j), B = () => hEdge(i, j + 1)
      const L = () => vEdge(i, j), Rt = () => vEdge(i + 1, j)
      // Обход по часовой стрелке: внутренность всегда слева. Из-за этого
      // кольца дырок получаются обойдёнными в обратную сторону, и заливка
      // с правилом чётности сама делает в воде дырку, где ей положено.
      switch (code) {
        case 1: link(B(), L()); break
        case 2: link(Rt(), B()); break
        case 3: link(Rt(), L()); break
        case 4: link(T(), Rt()); break
        case 5: { // седло
          const avg = (tl + tr + br + bl) / 4
          if (avg > iso) { link(T(), L()); link(B(), Rt()) } else { link(T(), Rt()); link(B(), L()) }
          break
        }
        case 6: link(T(), B()); break
        case 7: link(T(), L()); break
        case 8: link(L(), T()); break
        case 9: link(B(), T()); break
        case 10: { // седло
          const avg = (tl + tr + br + bl) / 4
          if (avg > iso) { link(L(), B()); link(Rt(), T()) } else { link(L(), T()); link(Rt(), B()) }
          break
        }
        case 11: link(Rt(), T()); break
        case 12: link(L(), Rt()); break
        case 13: link(B(), Rt()); break
        case 14: link(L(), B()); break
      }
    }
  }

  // 4. сшиваем в кольца
  const out = []
  const seen = new Set()
  for (const start of next.keys()) {
    if (seen.has(start)) continue
    const ring = []
    let e = start
    while (e !== undefined && !seen.has(e)) {
      seen.add(e)
      ring.push(cross.get(e))
      e = next.get(e)
    }
    if (ring.length > 2) out.push(ring)
  }

  // 5. Сглаживание кривой.
  //
  // Сетка даёт ступеньки, а частицы верхнего слоя — рябь в полшага: у свободной
  // поверхности давить нечем, и каждая частица стоит там, куда её положила
  // укладка. Это не физика, а разрешение, и лечится оно фильтром вдоль кривой.
  //
  // Простое усреднение по соседям кривую стягивает: чем больше проходов, тем
  // сильнее вода отползает от берегов и теряет объём. Поэтому по Таубину —
  // каждый второй проход с отрицательным весом, то есть обратно наружу. Низкие
  // частоты остаются на месте, мелкая рябь уходит.
  const passes = opts.smooth ?? 14
  const LAM = 0.55, MU = -0.58
  for (const ring of out) {
    const n = ring.length
    if (n < 5) continue
    const bx = new Float64Array(n), by = new Float64Array(n)
    for (let s = 0; s < passes; s++) {
      const w = s & 1 ? MU : LAM
      for (let i = 0; i < n; i++) {
        const a = ring[(i - 1 + n) % n], b = ring[i], c = ring[(i + 1) % n]
        bx[i] = b[0] + w * ((a[0] + c[0]) * 0.5 - b[0])
        by[i] = b[1] + w * ((a[1] + c[1]) * 0.5 - b[1])
      }
      for (let i = 0; i < n; i++) { ring[i][0] = bx[i]; ring[i][1] = by[i] }
    }
  }
  return out
}
