// Проверка ядра без Vue и без сущностей: только core/.
//
// Смысл проверок — не «числа те же, что были», а «физика осталась физикой»:
// свободное падение честное, телепорт не разгоняет, цепочка держит вес, шар
// лежит и не дрожит, твёрдое тело не разъезжается, гладкость разводит случаи.

import { Physics } from '../src/core/solver.js'

let fails = 0
const ok = (name, cond, info = '') => {
  if (!cond) fails++
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${info ? '   ' + info : ''}`)
}
const near = (a, b, eps) => Math.abs(a - b) <= eps

const run = (phys, seconds, dt = 1 / 60) => {
  const n = Math.round(seconds / dt)
  for (let i = 0; i < n; i++) phys.step(dt)
}

const ground = (phys, y = 700, sm = 0.5) =>
  phys.addCollider({ points: [[-2000, y], [4000, y], [4000, y + 400], [-2000, y + 400]], smoothness: sm })

// --- свободное падение -------------------------------------------------------
{
  const phys = new Physics({ gravity: { x: 0, y: 1800 } })
  phys.drag = 0
  const p = phys.addPoint({ x: 0, y: 0 })
  run(phys, 1)
  ok('свободное падение: скорость', near(p.vy, 1800, 30), `vy=${p.vy.toFixed(1)}`)
  ok('свободное падение: путь', near(p.y, 900, 30), `y=${p.y.toFixed(1)}`)
}

// --- телепорт не разгоняет ---------------------------------------------------
// В верле это было невозможно: скорость там — разность двух положений, и всякая
// перестановка тела молча превращалась в удар.
{
  const phys = new Physics()
  const p = phys.addPoint({ x: 0, y: 0 })
  run(phys, 0.5)
  phys.place(p, 500, 500)
  ok('place() не разгоняет', p.vx === 0 && p.vy === 0, `v=(${p.vx},${p.vy})`)
}

// --- цепочка: натяжение верхней связи = вес всего, что под ней ----------------
{
  const phys = new Physics({ gravity: { x: 0, y: 1800 } })
  const top = phys.addPoint({ x: 400, y: 100, pinned: true })
  let prev = top
  const links = []
  for (let i = 1; i <= 6; i++) {
    const p = phys.addPoint({ x: 400, y: 100 + i * 40, mass: 1 })
    links.push(phys.addLink(prev, p, { rest: 40, spring: 1600, damping: 0.25 }))
    prev = p
  }
  run(phys, 8)
  const t = links[0].tension
  ok('цепочка: натяжение верхней связи', near(t, 6 * 1800, 6 * 1800 * 0.12),
    `${t.toFixed(0)} против ${6 * 1800}`)
  const stretch = Math.hypot(links[0].a.x - links[0].b.x, links[0].a.y - links[0].b.y) - 40
  ok('цепочка: растяжение = натяжение/жёсткость', near(stretch, t / 1600, 1.2),
    `${stretch.toFixed(2)} против ${(t / 1600).toFixed(2)}`)
  ok('цепочка: висит вертикально', near(prev.x, 400, 1), `x=${prev.x.toFixed(2)}`)
}

// --- шар лежит на земле и не дрожит ------------------------------------------
{
  const phys = new Physics({ gravity: { x: 0, y: 1800 } })
  ground(phys)
  const p = phys.addPoint({ x: 200, y: 300, radius: 13 })
  run(phys, 4)
  const y0 = p.y
  run(phys, 2)
  ok('шар лежит на земле', near(p.y, 700 - 13, 1.0), `y=${p.y.toFixed(2)}`)
  ok('шар не дрожит', Math.abs(p.y - y0) < 0.5 && Math.abs(p.vy) < 12,
    `Δy=${(p.y - y0).toFixed(3)} vy=${p.vy.toFixed(2)}`)
}

// --- треугольник держит форму ------------------------------------------------
// Пока контакт с землёй «сохранял» скорость внутри цикла решателя, он
// разъезжался с 70 до 141 px и разваливался.
{
  const phys = new Physics({ gravity: { x: 0, y: 1800 } })
  ground(phys)
  const a = phys.addPoint({ x: 300, y: 600, radius: 13 })
  const b = phys.addPoint({ x: 370, y: 600, radius: 13 })
  const c = phys.addPoint({ x: 335, y: 540, radius: 13 })
  for (const [u, v] of [[a, b], [b, c], [c, a]]) phys.addLink(u, v, { spring: 1600, damping: 0.25 })
  run(phys, 10)
  const w = Math.hypot(a.x - b.x, a.y - b.y)
  ok('треугольник держит форму', near(w, 70, 6), `${w.toFixed(1)} при исходных 70`)
}

// --- жёсткое тело ------------------------------------------------------------
{
  const phys = new Physics({ gravity: { x: 0, y: 1800 } })
  ground(phys)
  const pts = [[0, 0], [80, 0], [80, 50], [0, 50]].map(([x, y]) =>
    phys.addPoint({ x: 500 + x, y: 400 + y, radius: 4, mass: 1 }))
  phys.addBody({ points: pts })
  phys.addCollider({ verts: pts, smoothness: 0.5 })
  run(phys, 6)
  const wdt = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
  const bottom = Math.max(...pts.map((p) => p.y))
  ok('ящик держит форму', near(wdt, 80, 2), `${wdt.toFixed(1)}`)
  ok('ящик лежит на земле', near(bottom, 700 - 4, 3), `низ=${bottom.toFixed(1)}`)
  ok('ящик не крутится', Math.abs(pts[0].y - pts[1].y) < 3,
    `перекос=${Math.abs(pts[0].y - pts[1].y).toFixed(2)}`)
}

// --- трение и качение --------------------------------------------------------
// Оговорка: круглое тело по склону КАТИТСЯ, а не скользит, и удержать его
// сцеплением нельзя — его держит только сопротивление качению. Это честно:
// настоящий шар с горы тоже уезжает. Поэтому проверяется разница, а не «стоит».
{
  const v = {}
  for (const sm of [0.15, 0.95]) {
    const phys = new Physics({ gravity: { x: 0, y: 1800 } })
    const k = Math.tan(Math.PI / 6)
    phys.addCollider({ points: [[0, 400], [1200, 400 + 1200 * k], [1200, 2000], [0, 2000]], smoothness: sm })
    const p = phys.addPoint({ x: 300, y: 300, radius: 13, smoothness: sm })
    run(phys, 2)
    v[sm] = Math.hypot(p.vx, p.vy)
  }
  ok('склон 30°: гладкость разводит случаи', v[0.95] > v[0.15] * 1.4,
    `шершавый ${v[0.15].toFixed(0)}, скользкий ${v[0.95].toFixed(0)} px/с`)
}

// --- подъёмная сила ----------------------------------------------------------
{
  const phys = new Physics({ gravity: { x: 0, y: 1800 } })
  const p = phys.addPoint({ x: 0, y: 500, mass: -1 })
  run(phys, 1)
  ok('отрицательный вес поднимает', p.y < 400, `y=${p.y.toFixed(0)}`)
  ok('инерция та же', near(p.mass, 1, 1e-6), `m=${p.mass}`)
}

// --- хранилище: удаление не путает ручки -------------------------------------
// Индекс частицы не вечен: удаление переставляет последнюю на её место. Ручка
// обязана переехать вместе с данными, иначе сущность начнёт двигать чужое тело.
{
  const phys = new Physics()
  const a = phys.addPoint({ x: 1, y: 1 })
  const b = phys.addPoint({ x: 2, y: 2 })
  const c = phys.addPoint({ x: 3, y: 3 })
  phys.removePoint(a)
  ok('хранилище: ручки пережили удаление', b.x === 2 && c.x === 3 && phys.points.length === 2,
    `b=${b.x} c=${c.x} точек ${phys.points.length}`)
  phys.removePoint(c)
  b.x = 42
  ok('хранилище: запись через ручку идёт по адресу', b.x === 42 && phys.points[0] === b)
}

console.log(fails ? `\n${fails} проверок не прошло` : '\nвсё прошло')
process.exit(fails ? 1 : 0)
