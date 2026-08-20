// Гравитация как поле: невесомость, один источник, суперпозиция, орбита,
// отталкивание, выключатель и ходьба по круглой планете.
import '../src/entities/index.js'
import { Physics } from '../src/core/solver.js'
import { World } from '../src/core/world.js'

const r2 = (v) => Math.round(v * 100) / 100
const r1 = (v) => Math.round(v * 10) / 10

// ---------------------------------------------------------------- невесомость
{
  const ph = new Physics({ gravity: { x: 0, y: 0 } })
  const p = ph.addPoint({ x: 400, y: 300, mass: 1 })
  for (let i = 0; i < 180; i++) ph.step(1 / 60)
  console.log('=== ни одного источника ===')
  console.log(`точка за 3 с сместилась на ${r2(Math.hypot(p.x - 400, p.y - 300))} px — невесомость`)
}

// ------------------------------------------------------------- один источник
{
  const ph = new Physics({ gravity: { x: 0, y: 0 } })
  const R = 80, PULL = 1800
  ph.addWell({ x: 800, y: 450, pull: PULL, radius: R })
  const at = (x, y) => ph.gravityAt(x, y, { x: 0, y: 0 })
  const mag = (x, y) => { const g = at(x, y); return Math.hypot(g.x, g.y) }
  console.log('\n=== один источник: закон обратных квадратов ===')
  console.log(`на поверхности (r=R):   ${r1(mag(800 + R, 450))} px/с² (задано ${PULL})`)
  console.log(`на двух радиусах:       ${r1(mag(800 + 2 * R, 450))} px/с² (ожидаем ${PULL / 4})`)
  console.log(`на трёх радиусах:       ${r1(mag(800 + 3 * R, 450))} px/с² (ожидаем ${r1(PULL / 9)})`)
  console.log(`в центре тела:          ${r1(mag(800, 450))} px/с² — бесконечности нет`)
  console.log(`на половине радиуса:    ${r1(mag(800 + R / 2, 450))} px/с² (внутри линейно: ${PULL / 2})`)

  // тянет со всех сторон одинаково
  const sides = [[800, 100], [800, 800], [300, 450], [1300, 450]]
  const fall = sides.map(([x, y]) => {
    const p = ph.addPoint({ x, y, mass: 1, collision: { world: false, points: false } })
    return { p, d0: Math.hypot(x - 800, y - 450) }
  })
  for (let i = 0; i < 60; i++) ph.step(1 / 60)
  console.log('за 1 с приблизились к источнику: ' + fall
    .map((f) => r1(f.d0 - Math.hypot(f.p.x - 800, f.p.y - 450)))
    .join(', ') + ' px — низ везде свой')
}

// ------------------------------------------------------------- суперпозиция
{
  const ph = new Physics({ gravity: { x: 0, y: 0 } })
  ph.addWell({ x: 500, y: 450, pull: 1800, radius: 80 })
  ph.addWell({ x: 1100, y: 450, pull: 1800, radius: 80 })
  const g = ph.gravityAt(800, 450, { x: 0, y: 0 })
  const gl = ph.gravityAt(700, 450, { x: 0, y: 0 })
  console.log('\n=== два источника: складываются, а не выбирается ближайший ===')
  console.log(`ровно посередине: (${r2(g.x)}, ${r2(g.y)}) — тяги нет, это нулевая точка`)
  console.log(`ближе к левому:   (${r1(gl.x)}, ${r1(gl.y)}) — тянет влево, к нему`)

  const mid = ph.addPoint({ x: 800, y: 450, mass: 1 })
  const off = ph.addPoint({ x: 700, y: 300, mass: 1, collision: { world: false, points: false } })
  for (let i = 0; i < 120; i++) ph.step(1 / 60)
  console.log(`точка в нулевой точке за 2 с ушла на ${r2(Math.hypot(mid.x - 800, mid.y - 450))} px`)
  console.log(`точка сбоку выбрала левый: до левого ${r1(Math.hypot(off.x - 500, off.y - 450))}, до правого ${r1(Math.hypot(off.x - 1100, off.y - 450))}`)

  // третий источник смещает равновесие — поле пересчитывается целиком
  ph.addWell({ x: 800, y: 100, pull: 3000, radius: 60 })
  const g3 = ph.gravityAt(800, 450, { x: 0, y: 0 })
  console.log(`добавили третий сверху: в бывшей нулевой точке стало (${r2(g3.x)}, ${r1(g3.y)})`)
}

// -------------------------------------------------------------------- орбита
{
  // Настоящее притяжение — значит есть и орбиты. Скорость кругового движения
  // v = √(a·r): если поле посчитано правильно, точка вернётся туда же.
  const ph = new Physics({ gravity: { x: 0, y: 0 }, damping: 1 })
  const R = 80, PULL = 1800, r = 300
  ph.addWell({ x: 800, y: 450, pull: PULL, radius: R })
  const a = PULL * (R / r) ** 2
  const v = Math.sqrt(a * r)
  const p = ph.addPoint({ x: 800 + r, y: 450, mass: 1, vy: -v, collision: { world: false, points: false } })
  let min = Infinity, max = 0
  const T = (2 * Math.PI * r) / v
  for (let i = 0; i < Math.round(T * 60) * 2; i++) {
    ph.step(1 / 60)
    const d = Math.hypot(p.x - 800, p.y - 450)
    min = Math.min(min, d); max = Math.max(max, d)
  }
  console.log('\n=== орбита ===')
  console.log(`скорость ${r1(v)} px/с, период ${r2(T)} с, два оборота`)
  console.log(`радиус держался в ${r1(min)}..${r1(max)} px (задан ${r})`)
}

// --------------------------------------------------------------- отталкивание
{
  const ph = new Physics({ gravity: { x: 0, y: 0 } })
  ph.addWell({ x: 800, y: 450, pull: -1200, radius: 60 })
  const p = ph.addPoint({ x: 900, y: 450, mass: 1, collision: { world: false, points: false } })
  for (let i = 0; i < 60; i++) ph.step(1 / 60)
  console.log('\n=== минус на тяге — отталкивание ===')
  console.log(`точка ушла с 100 на ${r1(p.x - 800)} px от источника`)
}

// ------------------------------------------------------------------ дальность
{
  const ph = new Physics({ gravity: { x: 0, y: 0 } })
  ph.addWell({ x: 0, y: 0, pull: 1800, radius: 80, range: 500 })
  const m = (r) => r1(Math.hypot(...Object.values(ph.gravityAt(r, 0, { x: 0, y: 0 }))))
  console.log('\n=== дальность действия ===')
  console.log(`r=200: ${m(200)} | r=400: ${m(400)} | r=490: ${m(490)} | r=520: ${m(520)} — за пределом ровно ноль, край сглажен`)
}

// ------------------------------------------------- выключатель на шине сигналов
{
  const lvl = {
    width: 1600, height: 900, gravity: { x: 0, y: 0 },
    entities: [
      { id: 'gw', type: 'gravity-well', data: { x: 800, y: 700, pull: 2400, radius: 120, falloff: 2, range: 0, solid: true, movable: false, signal: 'магнит', invert: false, lines: 8, smoothness: 0.4, color: '#8ea6ff', fill: '#2c3450' } },
      { id: 'b', type: 'system-ball', data: { x: 800, y: 200, r: 17, static: false, links: [], color: '#d8cbb0', linkColor: '#b9ae95' } },
    ],
  }
  const w = new World(structuredClone(lvl))
  const p = w.physics.points[0]
  for (let i = 0; i < 60; i++) w.step(1 / 60)
  const idle = Math.hypot(p.x - 800, p.y - 200)
  w.setSignal('магнит', true)
  for (let i = 0; i < 60; i++) w.step(1 / 60)
  console.log('\n=== источник выключается сигналом ===')
  console.log(`пока сигнала нет: шар сместился на ${r2(idle)} px — невесомость`)
  console.log(`после сигнала за 1 с: ${r1(p.y - 200)} px вниз, к источнику`)
  w.setSignal('магнит', false)
  const y0 = p.y
  for (let i = 0; i < 30; i++) w.step(1 / 60)
  console.log(`сигнал сняли: полетел дальше по инерции, ускорения нет (${r1(p.y - y0)} px за полсекунды)`)
}

// ------------------------------------------------------- ходьба по планете
{
  const planet = (x, y, r) => ({
    id: 'pl', type: 'gravity-well',
    data: { x, y, pull: 1800, radius: r, falloff: 2, range: 0, solid: true, movable: false, signal: '', invert: false, lines: 8, smoothness: 0.35, color: '#8ea6ff', fill: '#2c3450' },
  })
  const ball = (id, x, y) => ({
    id, type: 'game-ball',
    data: { x, y, r: 13, builtR: 13, sleepR: 13, mass: 1, builtMass: 1, sleepMass: 1, opacity: 1, anchorable: true, asleep: false, minLinks: 2, maxLinks: 3, range: 165, jump: 470, speed: 95, dropMax: 190, color: '#e2704a', linkColor: '#f0b48c' },
  })
  const R = 220
  const w = new World({
    width: 1600, height: 900, gravity: { x: 0, y: 0 },
    entities: [planet(800, 450, R), ball('b1', 800, 120), ball('b2', 400, 450), ball('b3', 800, 800)],
  })
  const balls = w.instances.filter((i) => i.type === 'game-ball').map((i) => i.rt.p)
  const ang = (p) => Math.atan2(p.y - 450, p.x - 800)
  for (let i = 0; i < 120; i++) w.step(1 / 60)
  const a0 = balls.map(ang)
  console.log('\n=== шары ходят по круглой планете ===')
  console.log('через 2 с высота над центром: ' + balls.map((p) => r1(Math.hypot(p.x - 800, p.y - 450))).join(', ') + ` px (поверхность ${R}, радиус шара 13)`)
  for (let i = 0; i < 360; i++) w.step(1 / 60)
  const moved = balls.map((p, i) => r2(Math.abs(((ang(p) - a0[i] + Math.PI * 3) % (Math.PI * 2)) - Math.PI)))
  console.log('через ещё 6 с высота: ' + balls.map((p) => r1(Math.hypot(p.x - 800, p.y - 450))).join(', ') + ' px — с планеты никто не упал')
  console.log('прошли по дуге, рад: ' + moved.join(', ') + ' — ходят вбок относительно своего низа')
}
