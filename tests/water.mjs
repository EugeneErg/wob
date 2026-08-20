// Среда: то, что раньше не получалось. Два обещания проверяются здесь прямо:
// стоячая вода стоит, а свежая лунка заполняется целиком и вровень.
import { Physics } from '../src/core/solver.js'
import { contours } from '../src/core/contour.js'

const trough = (ph, x0 = 300, x1 = 900, top = 200, floorY = 700, floor = null) => {
  const f = ph.addCollider({ points: floor || [[x0, floorY], [x1, floorY], [x1, floorY + 160], [x0, floorY + 160]], smoothness: 1, restitution: 0 })
  ph.addCollider({ points: [[x0 - 40, top], [x0, top], [x0, floorY + 160], [x0 - 40, floorY + 160]], smoothness: 1, restitution: 0 })
  ph.addCollider({ points: [[x1, top], [x1 + 40, top], [x1 + 40, floorY + 160], [x1, floorY + 160]], smoothness: 1, restitution: 0 })
  return f
}
// Наливаем так же, как это делает сущность: шестиугольной укладкой с шагом
// вещества. Квадратная решётка дала бы другую плотность, и все числа поехали бы.
const pour = (ph, phase, x0, y0, x1, y1) => {
  const s = phase.spacing, dy = s * Math.sqrt(3) / 2
  let n = 0
  for (let row = 0; y0 + row * dy < y1; row++) {
    for (let x = x0 + (row & 1 ? s * 0.5 : 0); x < x1; x += s) {
      ph.addPoint({ x, y: y0 + row * dy, radius: s * 0.5, phase: phase.id, mass: phase.mass, smoothness: 1, restitution: 0 })
      n++
    }
  }
  return n
}
const level = (ph, x0 = -1e9, x1 = 1e9) => {
  let m = Infinity
  for (const p of ph.points) if (p.x > x0 && p.x < x1) m = Math.min(m, p.y)
  return m
}
const stats = (ph) => {
  let v = 0, vmax = 0
  for (const p of ph.points) {
    const s = Math.hypot(p.vx, p.vy)
    v += s; if (s > vmax) vmax = s
  }
  return { v: v / ph.points.length, vmax }
}
// Перепад поверхности: самая высокая частица в каждом столбце. Ровная вода —
// это перепад около половины шага частиц, то есть сама зернистость укладки.
// Рельеф поверхности. Берега исключаем: у самой стенки кромка загибается вниз,
// и это не волна, а край. Меряем то, что видно как гладь.
const relief = (ph, x0 = 340, x1 = 860) => {
  const w = 25, bins = new Array(Math.ceil((x1 - x0) / w)).fill(Infinity)
  for (const p of ph.points) {
    const i = Math.floor((p.x - x0) / w)
    if (i >= 0 && i < bins.length) bins[i] = Math.min(bins[i], p.y)
  }
  const u = bins.filter((v) => v < Infinity)
  return Math.max(...u) - Math.min(...u)
}
const r1 = (x) => Math.round(x * 10) / 10
const r2 = (x) => Math.round(x * 100) / 100

// --------------------------------------------------------- стоячая вода стоит
{
  const ph = new Physics({ gravity: { x: 0, y: 1800 } })
  trough(ph)
  const water = ph.fluid.addPhase({ spacing: 11 })
  pour(ph, water, 312, 420, 890, 690)
  console.log('=== стоячая вода ===')
  console.log(`шаг частиц ${water.spacing}, клетка сетки ${r1(water.spacing * 2)} px`)
  for (const t of [2, 5, 10, 20]) {
    while (ph.acc === undefined && false) break
    for (let i = 0; i < (t === 2 ? 120 : 60 * (t - (t === 5 ? 2 : t === 10 ? 5 : 10))); i++) ph.step(1 / 60)
    const s = stats(ph)
    console.log(`  ${String(t).padStart(2)} с: уровень ${r1(level(ph))} | скорость средняя ${r2(s.v)}, наибольшая ${r1(s.vmax)} px/с | перепад поверхности ${r1(relief(ph))} px`)
  }
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < 300; i++) { ph.step(1 / 60); const l = level(ph); lo = Math.min(lo, l); hi = Math.max(hi, l) }
  console.log(`  ещё 5 с: уровень гулял на ${r2(hi - lo)} px, перепад ${r1(relief(ph))} px при шаге частиц 11`)
}

// ------------------------------------------------------- лунка под водой
{
  const boundary = 1
  const ph = new Physics({ gravity: { x: 0, y: 1800 } })
  const floor = trough(ph)
  const water = ph.fluid.addPhase({ spacing: 11, boundary })
  pour(ph, water, 312, 420, 890, 695)
  for (let i = 0; i < 480; i++) ph.step(1 / 60)
  const before = level(ph)
  // роем лунку 120 × 100 прямо под водой
  const PIT = [[300, 700], [520, 700], [520, 800], [640, 800], [640, 700], [900, 700], [900, 860], [300, 860]]
  ph.setRegion(floor, [[PIT]])
  const cell = 11 * 11 * Math.sqrt(3) / 2
  const need = 12000 / cell
  console.log('\n=== лунка под водой ===')
  console.log(`  улеглась на ${r1(before)}, вырыли 120×100 px² — это ${Math.round(need)} частиц`)
  for (const s of [1, 3]) {
    for (let i = 0; i < 60 * (s === 1 ? 1 : 2); i++) ph.step(1 / 60)
    let inPit = 0, empty = 0
    for (const p of ph.points) if (p.x > 522 && p.x < 638 && p.y > 702 && p.y < 800) inPit++
    // пустоты внутри лунки: место, где на полшага вокруг нет ни одной частицы
    for (let y = 712; y < 795; y += 11) {
      for (let x = 530; x < 632; x += 11) {
        let has = false
        for (const p of ph.points) if (Math.abs(p.x - x) < 8 && Math.abs(p.y - y) < 8) { has = true; break }
        if (!has) empty++
      }
    }
    console.log(`  +${s} с: в лунке ${inPit} частиц при ${Math.round(need)} в идеальной укладке, пустот ${empty}, уровень слева ${r1(level(ph, 340, 500))} справа ${r1(level(ph, 660, 860))}`)
  }
}

// ------------------------------------------------------------- сон не мешает
{
  const ph = new Physics({ gravity: { x: 0, y: 1800 } })
  ph.addCollider({ points: [[100, 700], [1500, 700], [1500, 760], [100, 760]], smoothness: 1, restitution: 0 })
  ph.addCollider({ points: [[60, 300], [100, 300], [100, 760], [60, 760]], smoothness: 1, restitution: 0 })
  ph.addCollider({ points: [[1500, 300], [1540, 300], [1540, 760], [1500, 760]], smoothness: 1, restitution: 0 })
  const dam = ph.addCollider({ points: [[500, 300], [520, 300], [520, 700], [500, 700]], smoothness: 1, restitution: 0 })
  const water = ph.fluid.addPhase({ spacing: 11 })
  pour(ph, water, 165, 340, 495, 690)
  for (let i = 0; i < 480; i++) ph.step(1 / 60)
  const front = () => { let m = 0; for (const p of ph.points) m = Math.max(m, p.x); return m }
  console.log('\n=== плотину убрали ===')
  ph.removeCollider(dam)
  for (const t of [1, 2, 4]) {
    for (let i = 0; i < 60 * (t === 1 ? 1 : 2); i++) ph.step(1 / 60)
    console.log(`  +${t} с: фронт дошёл до x=${Math.round(front())}`)
  }
}

// --------------------------------------------- из-под спящей воды убрали дно
{
  const ph = new Physics({ gravity: { x: 0, y: 1800 } })
  const floor = trough(ph)
  const water = ph.fluid.addPhase({ spacing: 11 })
  pour(ph, water, 312, 400, 890, 690)
  for (let i = 0; i < 900; i++) ph.step(1 / 60)
  console.log('\n=== убрали дно ===')
  console.log(`  улеглась на ${Math.round(level(ph))}`)
  ph.removeCollider(floor)
  for (const t of [0.25, 1]) {
    for (let i = 0; i < Math.round(60 * t); i++) ph.step(1 / 60)
    console.log(`  через ${t} с: уровень ${Math.round(level(ph))} — висеть в воздухе не умеет`)
  }
}

// ----------------------------------------------- жидкость не держит уступ
{
  // Наливаем с нарочной ступенькой: слева на два ряда выше. У жидкости нет
  // трения покоя, значит уступ обязан растечься. Долго это была главная
  // проверка всей среды: расталкивание приходилось ослаблять до 0.9 шага,
  // иначе шестиугольная укладка держала уступ вечно. Держала она его не сама
  // по себе, а потому, что давление у поверхности считалось неверно и растекать
  // было нечем. Теперь растекает давление, и люфт не нужен: расталкивание в
  // целый шаг, а уступ всё равно уходит.
  const ph = new Physics({ gravity: { x: 0, y: 1800 } })
  trough(ph)
  const water = ph.fluid.addPhase({ spacing: 11 })
  const s = 11, dy = s * Math.sqrt(3) / 2
  for (let row = 0; row < 20; row++) {
    for (let col = 0; col < 53; col++) {
      const x = 306 + (col + (row & 1 ? 0.5 : 0)) * s
      if (x > 894 || row >= (x < 600 ? 17 : 15)) continue
      ph.addPoint({ x, y: 694 - row * dy, radius: s * 0.5, phase: water.id, smoothness: 1, restitution: 0 })
    }
  }
  const step = () => {
    const b = new Array(30).fill(Infinity)
    for (const p of ph.points) { const i = Math.floor((p.x - 300) / 20); if (i >= 0 && i < 30) b[i] = Math.min(b[i], p.y) }
    return Math.min(...b.slice(18, 28)) - Math.min(...b.slice(2, 12))
  }
  console.log('\n=== ступенька в два ряда ===')
  console.log(`  налили: слева выше на ${r1(step())} px`)
  let done = 0
  for (const t of [0.5, 2, 12]) {
    for (; done < t * 60; done++) ph.step(1 / 60)
    console.log(`  ${String(t).padStart(4)} с: ${r1(step())} px`)
  }
  console.log('  расталкивание здесь в целый шаг — люфт в укладке больше не нужен')
}

// ------------------------------------------------------------- углы и берега
{
  const ph = new Physics({ gravity: { x: 0, y: 1800 } })
  trough(ph)
  const water = ph.fluid.addPhase({ spacing: 11 })
  pour(ph, water, 312, 400, 890, 690)
  for (let i = 0; i < 900; i++) ph.step(1 / 60)
  const n = ph.points.length
  const X = new Float64Array(n), Y = new Float64Array(n)
  for (let i = 0; i < n; i++) { X[i] = ph.points[i].x; Y[i] = ph.points[i].y }
  // «твёрдо ли здесь» — то же, что отвечает миру ctx.solidAt
  const solid = (x, y) => x <= 300 || x >= 900 || y >= 700
  const toCorner = (rings, cx, cy) => {
    let d = Infinity
    for (const r of rings) for (const p of r) d = Math.min(d, Math.hypot(p[0] - cx, p[1] - cy))
    return d
  }
  console.log('\n=== углы бассейна ===')
  for (const [name, o] of [['не зная про берег', {}], ['зная, где камень', { solid }]]) {
    const rings = contours(X, Y, n, 11, o)
    console.log(`  ${name.padEnd(18)} колец ${rings.length}, до левого нижнего угла ${r1(toCorner(rings, 300, 700))} px, до правого ${r1(toCorner(rings, 900, 700))} px`)
  }
  console.log('  поле нормировано (Чжу — Бридсон), поэтому про берег оно не спрашивает: числа с ним и без него совпадают')
  console.log('  лишние кольца внутри воды снимает разлив от края — иначе в углу остаётся дырка')
}

// ------------------------------------------------------------------- время
{
  for (const n of [400, 800, 1200]) {
    const ph = new Physics({ gravity: { x: 0, y: 1800 } })
    trough(ph, 200, 1000)
    const water = ph.fluid.addPhase({ spacing: 11 })
    pour(ph, water, 212, 200, 990, 200 + (n / 70) * 11 * Math.sqrt(3) / 2)
    for (let i = 0; i < 240; i++) ph.step(1 / 60)
    let best = Infinity
    for (let k = 0; k < 3; k++) { const t = performance.now(); for (let i = 0; i < 40; i++) ph.step(1 / 60); best = Math.min(best, (performance.now() - t) / 40) }
    console.log(`${n === 400 ? '\n=== время ===\n' : ''}  ${n} частиц: ${r2(best)} мс/кадр (движение), ${r2((() => { const t = performance.now(); for (let i = 0; i < 40; i++) ph.step(1 / 60); return (performance.now() - t) / 40 })())} мс (улеглась)`)
  }
}
