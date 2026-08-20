import '../src/entities/index.js'
import { World } from '../src/core/world.js'
import { sample } from '../src/entities/fan/fluid.js'

const ground = (y = 860) => ({ id: 'g', type: 'terrain', data: { points: [[0, y], [1600, y], [1600, 900], [0, 900]], smoothness: 0.5, fill: '#2a3326', edge: '#66804f' } })
const fan = (id, x, y, angle, power = 520) => ({ id, type: 'fan', data: { x, y, angle, power, nozzle: 46, cell: 22, push: 16, show: true, color: '#7fb6cc' } })
const goo = (id, x, y) => ({ id, type: 'game-ball', data: { x, y, r: 13, builtR: 13, sleepR: 13, mass: 1, builtMass: 1, sleepMass: 1, opacity: 1, anchorable: true, asleep: true, minLinks: 2, maxLinks: 3, range: 165, jump: 470, speed: 95, dropMax: 190, color: '#e2704a', linkColor: '#f0b48c' } })
const wall = (id, x0, y0, x1, y1) => ({ id, type: 'terrain', data: { points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], smoothness: 0.5, fill: '#2a3326', edge: '#66804f' } })

const sim = (entities, sec) => {
  const w = new World({ width: 1600, height: 900, gravity: { x: 0, y: 1800 }, entities })
  for (let i = 0; i < 60 * sec; i++) w.step(1 / 60)
  return w
}
// Струя гуляет, и шар над ней тоже: снимок в фиксированный момент врёт.
// Меряем, до какой высоты вентилятор его вообще донёс.
const lift = (entities, sec) => {
  const w = new World({ width: 1600, height: 900, gravity: { x: 0, y: 1800 }, entities })
  const p = w.instances.find((i) => i.type === 'game-ball').rt.p
  let top = p.y
  for (let i = 0; i < 60 * sec; i++) { w.step(1 / 60); top = Math.min(top, p.y) }
  return { w, top }
}
const field = (w) => w.instances.find((i) => i.type === 'fan').rt.air.field
const speed = (f, x, y) => { const a = sample(f, x, y); return Math.hypot(a.x, a.y) }

console.log('=== вентиляторы друг за другом вливают в одно поле ===')
for (const n of [1, 2, 3]) {
  const ys = [840, 790, 740].slice(0, n)
  const r = lift([ground(), ...ys.map((y, i) => fan('f' + i, 800, y, -90)), goo('b', 800, 600)], 4)
  console.log(`  ${n} шт: поток на y=500 ${speed(field(r.w), 800, 500).toFixed(0)} px/с, шар поднимался до y=${r.top.toFixed(0)} (старт 600, пол 847)`)
}

console.log('\n=== сужение сквозной трубы: тот же расход идёт быстрее ===')
// Труба открыта с обоих концов, посередине сужение. Считаем именно расход и
// среднюю скорость по сечению: центральная скорость врёт, потому что в широкой
// части поток идёт узкой струёй, а в сужении заполняет всё сечение.
for (const gap of [400, 200, 100]) {
  const h = gap / 2
  const w = sim([
    wall('t', 0, 0, 1600, 250), wall('b', 0, 650, 1600, 900),
    wall('nt', 700, 250, 900, 450 - h), wall('nb', 700, 450 + h, 900, 650),
    fan('f', 200, 450, 0, 700),
  ], 4)
  const f = field(w)
  const UI = (i, j) => i + j * (f.nx + 1)
  const cut = (x) => {
    const i = Math.round(x / f.cell)
    let sum = 0, n = 0
    for (let j = 0; j < f.ny; j++) { if (f.solid[i + j * f.nx]) continue; sum += f.u[UI(i, j)]; n++ }
    return { flux: sum * f.cell, open: n * f.cell, mean: n ? sum / n : 0 }
  }
  const wide = cut(500), thin = cut(800), after = cut(1200)
  console.log(`  сужение ${String(gap).padStart(3)} px: сечение ${wide.open} → ${thin.open} px, ` +
    `средняя ${wide.mean.toFixed(0)} → ${thin.mean.toFixed(0)} px/с; ` +
    `расход ${(wide.flux / 1000).toFixed(1)} → ${(thin.flux / 1000).toFixed(1)} → ${(after.flux / 1000).toFixed(1)}`)
}

console.log('\n=== поворот не съедает поток, а разворачивает его ===')
{
  // Г-образный коридор: снизу вверх, потом направо. Расход через срезы до и
  // после колена должен совпасть — иначе угол работает как поглотитель.
  const w = sim([wall('a', 0, 0, 700, 900), wall('b', 900, 400, 1600, 900), wall('c', 0, 0, 1600, 200),
    fan('f', 800, 800, -90, 900)], 5)
  const f = field(w)
  const UI = (i, j) => i + j * (f.nx + 1)
  const up = (y) => { const j = Math.round(y / f.cell); let s = 0; for (let i = 0; i < f.nx; i++) if (!f.solid[i + j * f.nx]) s += -f.v[i + j * f.nx]; return s * f.cell }
  const right = (x) => { const i = Math.round(x / f.cell); let s = 0; for (let j = 0; j < f.ny; j++) if (!f.solid[i + j * f.nx]) s += f.u[UI(i, j)]; return s * f.cell }
  console.log(`  вверх по каналу ${(up(700) / 1000).toFixed(1)} → ${(up(500) / 1000).toFixed(1)} → ${(up(420) / 1000).toFixed(1)}`)
  console.log(`  вправо за коленом ${(right(1000) / 1000).toFixed(1)} → ${(right(1300) / 1000).toFixed(1)} → ${(right(1540) / 1000).toFixed(1)}`)
}

console.log('\n=== преграда разворачивает струю ===')
let w = sim([ground(), fan('f', 800, 830, -90, 700), wall('w', 690, 640, 910, 700)], 3)
let f = field(w)
console.log(`  за плитой ${speed(f, 800, 560).toFixed(0)} px/с, мимо края плиты ${speed(f, 640, 640).toFixed(0)} px/с`)
w = sim([ground(), fan('f', 800, 830, -90, 700)], 3)
console.log(`  без плиты в той же точке ${speed(field(w), 800, 560).toFixed(0)} px/с`)

console.log('\n=== сопротивление зависит от веса и размера ===')
for (const [m, r] of [[1, 13], [4, 13], [1, 26]]) {
  const b = goo('b', 800, 700)
  b.data.sleepMass = m; b.data.sleepR = r
  const rr = lift([ground(), fan('f1', 800, 840, -90, 700), fan('f2', 800, 790, -90, 700), b], 4)
  console.log(`  вес ${m}, радиус ${r}: поднялся до y=${rr.top.toFixed(0)} (старт 700, пол ${(860 - r).toFixed(0)})`)
}

console.log('\n=== глобальный ветер: перелив между двумя векторами ===')
{
  const wind = { id: 'w', type: 'wind', data: { x: 100, y: 100, ax: 400, ay: 0, bx: -400, by: 0, period: 4, force: 1.2, show: true, color: '#9fc6d8' } }
  const b = goo('b', 800, 300)
  b.data.sleepMass = 0.6
  const ww = new World({ width: 1600, height: 900, gravity: { x: 0, y: 200 }, entities: [ground(), wind, b] })
  const p = ww.instances.find((i) => i.type === 'game-ball').rt.p
  const air = () => ww.instances.find((i) => i.type === 'wind').rt.air
  for (let t = 0; t <= 4; t++) {
    for (let i = 0; i < 60; i++) ww.step(1 / 60)
    console.log(`  t=${t + 1}c: ветер по X ${air().x.toFixed(0)}, шар x=${p.x.toFixed(0)} скорость ${(p.vx).toFixed(0)} px/с`)
  }
}

console.log('\n=== никто не главный: струи взаимодействуют сами ===')
{
  // два вентилятора лоб в лоб, шар посередине
  const face = sim([ground(),
    fan('left', 500, 500, 0, 600), fan('right', 1100, 500, 180, 600),
    { ...goo('b', 800, 500), data: { ...goo('b', 0, 0).data, x: 700, y: 500, sleepMass: 0.5 } }], 4)
  const p = face.instances.find((i) => i.type === 'game-ball').rt.p
  const f = field(face)
  const mid = sample(f, 800, 500)
  console.log(`  лоб в лоб: шар пришёл на x=${p.x.toFixed(0)} (ставили на 700, середина 800), ` +
    `в середине поток ${Math.hypot(mid.x, mid.y).toFixed(0)} px/с в стороны`)

  // под углом друг к другу — струи складываются в диагональ
  const ang = sim([ground(), fan('a', 600, 700, -45, 600), fan('b', 1000, 700, -135, 600)], 4)
  const fa = field(ang)
  const up = sample(fa, 800, 500)
  console.log(`  под 45° навстречу: над точкой встречи ${Math.hypot(up.x, up.y).toFixed(0)} px/с, ` +
    `направление (${up.x.toFixed(0)}, ${up.y.toFixed(0)}) — сложились вверх`)

  // в разные стороны — каждый работает у себя
  const apart = sim([ground(), fan('a', 500, 700, 180, 600), fan('b', 1100, 700, 0, 600)], 4)
  const fp = field(apart)
  console.log(`  спиной к спине: слева ${sample(fp, 300, 700).x.toFixed(0)}, ` +
    `справа ${sample(fp, 1300, 700).x.toFixed(0)} px/с по X — расходятся`)

  // удаление вентилятора ничего не ломает
  const w2 = sim([ground(), fan('a', 700, 830, -90), fan('b', 900, 830, -90)], 2)
  w2.despawn(w2.instances.find((i) => i.id === 'a'))
  for (let i = 0; i < 120; i++) w2.step(1 / 60)
  const left = w2.instances.find((i) => i.type === 'fan')
  console.log(`  убрали один из двух: поле живо ${!!left.rt.air.field}, у оставшегося поток ` +
    `${speed(left.rt.air.field, 900, 700).toFixed(0)} px/с`)
}

console.log('\n=== вентилятор отвечает за свою струю, а не за всю среду ===')
{
  // Шар катится по земле в дальнем углу, вентилятор дует в другую сторону.
  // Раньше в напор входила собственная скорость тела, и вентилятор тормозил
  // шар там, где воздуха нет вовсе.
  const roll = (entities) => {
    const w = new World({ width: 1600, height: 900, gravity: { x: 0, y: 1800 }, entities })
    const p = w.instances.find((i) => i.type === 'system-ball').rt.p
    for (let i = 0; i < 30; i++) w.step(1 / 60)
    p.vx = 500           // толкнули на 500 px/с
    const x0 = p.x
    for (let i = 0; i < 60 * 4; i++) w.step(1 / 60)
    return p.x - x0
  }
  const floor = { id: 'gg', type: 'terrain', data: { points: [[0, 700], [1600, 700], [1600, 900], [0, 900]], smoothness: 0.5, fill: '#2a3326', edge: '#66804f' } }
  const b = { id: 'b', type: 'system-ball', data: { x: 200, y: 680, r: 18, static: false, links: [], color: '#d8cbb0', linkColor: '#b9ae95' } }
  const alone = roll([floor, structuredClone(b)])
  const withFan = roll([floor, structuredClone(b), fan('f', 1500, 300, -90)])
  console.log(`  проехал ${alone.toFixed(0)} px без вентилятора и ${withFan.toFixed(0)} px с вентилятором в углу`)
  console.log(`  разница ${(100 * Math.abs(withFan - alone) / alone).toFixed(1)}% — вентилятор вдали не тормозит`)
}
