// Поиск соседей.
//
// Два разных вопроса, и раньше на них отвечала одна сетка:
//
//   «кто с кем может столкнуться» — пары тел; спрашивается раз на подшаг,
//     ответ нужен сразу, список нигде не хранится;
//   «кто вокруг этой частицы» — окружение; спрашивается по нескольку раз за
//     подшаг и потому обязано лежать готовым.
//
// Первое — HashGrid, им пользуются контакты. Второе — NeighborList, и в ядре
// им пока не пользуется никто: связи, форма и контакты — это ограничения на
// ПАРУ тел, им хватает сетки. Список нужен тем ограничениям, у которых
// аргумент не пара, а вся округа; для них пересобирать окружение на каждый
// проход дороже самой физики. Это и есть то место, куда такие ограничения
// подключаются, — см. core/solver.js.
//
// Список строится с ЗАПАСОМ (margin) и переживает несколько подшагов: пока
// никто не сдвинулся дальше половины запаса, старый список — честное
// надмножество, и пересобирать его незачем. Кто не двигается, тот не платит.

const hash = (cx, cy) => ((cx * 92837111) ^ (cy * 689287499)) >>> 0

// Ниже этого числа тел перебор всех пар дешевле сетки — и, что важнее,
// в точности тот же. Мелкие уровни ничего не замечают.
export const PAIRS_MIN = 64

export class HashGrid {
  constructor() {
    this.cell = 16
    this.mask = 0
    this.start = new Int32Array(0)
    this.items = new Int32Array(0)
    this.cursor = new Int32Array(0)
    this.mark = new Int32Array(0)
    this.q = 0
  }

  // ids === null означает «все частицы store». Ячейка задаётся снаружи:
  // для контактов это средний радиус, для среды — радиус ядра.
  //
  // extent — половина стороны рамки, которой частица занимает ячейки:
  //   число  — фиксированная (0 значит «частица это точка»),
  //   null   — собственный радиус частицы плюс pad.
  // Разница принципиальная. Список соседей строится по РАДИУСУ ЗАПРОСА, и
  // раскладывать в него частицы с той же рамкой — значит вписать каждую в
  // девять ячеек и потом перебрать их девятикратно. Один этот промах стоил
  // семи миллисекунд на полутора тысячах частиц.
  build(store, ids, cell, extent = null, pad = 0) {
    const n = ids ? ids.length : store.n
    const c = this.cell = Math.max(1e-3, cell)
    const X = store.x, Y = store.y

    let slots = 64
    while (slots < n * 2) slots <<= 1
    if (this.start.length !== slots + 1) {
      this.start = new Int32Array(slots + 1)
      this.cursor = new Int32Array(slots)
    } else this.start.fill(0)
    if (this.mark.length < n) this.mark = new Int32Array(Math.max(n, 64)).fill(-1)
    const mask = this.mask = slots - 1
    const start = this.start

    // Схема CSR: сначала считаем, сколько попадёт в каждую корзину, потом
    // раскладываем. За кадр не создаётся ни одного объекта.
    let total = 0
    for (let k = 0; k < n; k++) {
      const i = ids ? ids[k] : k
      const r = extent === null ? store.radius[i] + pad : extent
      const x0 = Math.floor((X[i] - r) / c), x1 = Math.floor((X[i] + r) / c)
      const y0 = Math.floor((Y[i] - r) / c), y1 = Math.floor((Y[i] + r) / c)
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) { start[(hash(cx, cy) & mask) + 1]++; total++ }
      }
    }
    for (let k = 0; k < slots; k++) start[k + 1] += start[k]
    this.cursor.set(start.subarray(0, slots))
    if (this.items.length < total) this.items = new Int32Array(Math.max(total, 256))
    const items = this.items, cursor = this.cursor
    for (let k = 0; k < n; k++) {
      const i = ids ? ids[k] : k
      const r = extent === null ? store.radius[i] + pad : extent
      const x0 = Math.floor((X[i] - r) / c), x1 = Math.floor((X[i] + r) / c)
      const y0 = Math.floor((Y[i] - r) / c), y1 = Math.floor((Y[i] + r) / c)
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) items[cursor[hash(cx, cy) & mask]++] = k
      }
    }
  }

  // Порядковые номера (не индексы частиц!) кандидатов в круге. Дубли снимаются
  // меткой: одно тело лежит в нескольких ячейках, кандидатом станет один раз.
  gather(x, y, r, out, skipUpTo = -1) {
    const c = this.cell, mask = this.mask
    const start = this.start, items = this.items, mark = this.mark
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c)
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c)
    const q = ++this.q
    out.length = 0
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const h = hash(cx, cy) & mask
        for (let k = start[h], e = start[h + 1]; k < e; k++) {
          const j = items[k]
          if (j <= skipUpTo || mark[j] === q) continue
          mark[j] = q
          out.push(j)
        }
      }
    }
    return out
  }
}

// --- список соседей ---------------------------------------------------------
// CSR: neighbors of ids[k] лежат в items[start[k] .. start[k+1]).
// Хранятся индексы частиц, а не порядковые номера — чтобы модуль ходил в SoA
// напрямую и не разыменовывал лишний раз.

export class NeighborList {
  constructor() {
    this.ids = new Int32Array(0)
    this.count = 0
    this.start = new Int32Array(1)
    this.items = new Int32Array(0)
    this.total = 0
    this.radius = 0
    this.margin = 0
    this.bx = new Float32Array(0) // где были частицы, когда список строился
    this.by = new Float32Array(0)
    this.stamp = -1
    this.grid = new HashGrid()
  }

  // Список устарел, если хоть кто-то ушёл дальше половины запаса: тогда пара,
  // которой в списке нет, уже могла сойтись на radius.
  stale(store, ids, stamp) {
    if (this.stamp !== stamp || this.count !== ids.length) return true
    const lim = (this.margin * 0.5) ** 2
    const X = store.x, Y = store.y
    for (let k = 0; k < this.count; k++) {
      const i = ids[k]
      const dx = X[i] - this.bx[k], dy = Y[i] - this.by[k]
      if (dx * dx + dy * dy > lim) return true
    }
    return false
  }

  build(store, ids, radius, margin, stamp = 0) {
    const n = ids.length
    const R = radius + margin
    this.radius = radius; this.margin = margin; this.stamp = stamp
    this.count = n
    if (this.ids.length < n) {
      this.ids = new Int32Array(n)
      this.bx = new Float32Array(n)
      this.by = new Float32Array(n)
      this.start = new Int32Array(n + 1)
    }
    if (this.start.length < n + 1) this.start = new Int32Array(n + 1)
    this.ids.set(ids.subarray ? ids.subarray(0, n) : Int32Array.from(ids))
    const X = store.x, Y = store.y
    for (let k = 0; k < n; k++) { this.bx[k] = X[ids[k]]; this.by[k] = Y[ids[k]] }

    // Ячейка РАВНА радиусу запроса, а частица кладётся в неё точкой — значит
    // каждая лежит ровно в одной ячейке, дубликатов нет и метка не нужна.
    // Отсюда же один проход вместо двух: соседи пишутся сразу, а не сначала
    // считаются, потом раскладываются.
    this.grid.build(store, ids, R, 0)
    const g = this.grid
    const c = g.cell, mask = g.mask, gs = g.start, gi = g.items
    const start = this.start
    const R2 = R * R
    let items = this.items
    let at = 0
    for (let k = 0; k < n; k++) {
      const i = ids[k]
      start[k] = at
      const xi = X[i], yi = Y[i]
      const cx0 = Math.floor((xi - R) / c), cx1 = Math.floor((xi + R) / c)
      const cy0 = Math.floor((yi - R) / c), cy1 = Math.floor((yi + R) / c)
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const b = hash(cx, cy) & mask
          for (let m = gs[b], e = gs[b + 1]; m < e; m++) {
            const j = ids[gi[m]]
            if (j === i) continue
            const dx = X[j] - xi, dy = Y[j] - yi
            if (dx * dx + dy * dy > R2) continue
            if (at >= items.length) {
              const bigger = new Int32Array(Math.max(items.length * 2, 4096))
              bigger.set(items)
              items = bigger
            }
            items[at++] = j
          }
        }
      }
    }
    start[n] = at
    this.items = items
    this.total = at
    return this
  }
}
