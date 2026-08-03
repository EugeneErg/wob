import '../src/entities/index.js'
import { World } from '../src/core/world.js'
import { sample } from '../src/entities/fan/fluid.js'

const ground = (y = 860) => ({ id: 'g', type: 'terrain', data: { points: [[0, y], [1600, y], [1600, 900], [0, 900]], smoothness: 0.5, fill: '#2a3326', edge: '#66804f' } })
const fan = (id, x, y, angle, power = 520) => ({ id, type: 'fan', data: { x, y, angle, power, nozzle: 46, cell: 26, push: 6, show: true, color: '#7fb6cc' } })
const goo = (id, x, y) => ({ id, type: 'game-ball', data: { x, y, r: 13, builtR: 13, sleepR: 13, mass: 1, builtMass: 1, sleepMass: 1, opacity: 1, anchorable: true, asleep: true, minLinks: 2, maxLinks: 3, range: 165, jump: 470, speed: 95, dropMax: 190, color: '#e2704a', linkColor: '#f0b48c' } })
const wall = (id, x0, y0, x1, y1) => ({ id, type: 'terrain', data: { points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], smoothness: 0.5, fill: '#2a3326', edge: '#66804f' } })

const sim = (entities, sec) => {
  const w = new World({ width: 1600, height: 900, gravity: { x: 0, y: 1800 }, entities })
  for (let i = 0; i < 60 * sec; i++) w.step(1 / 60)
  return w
}
const field = (w) => w.instances.find((i) => i.type === 'fan').rt.air.field
const speed = (f, x, y) => { const a = sample(f, x, y); return Math.hypot(a.x, a.y) }

console.log('=== вентиляторы друг за другом вливают в одно поле ===')
for (const n of [1, 2, 3]) {
  const ys = [840, 790, 740].slice(0, n)
  const w = sim([ground(), ...ys.map((y, i) => fan('f' + i, 800, y, -90)), goo('b', 800, 600)], 4)
  const f = field(w)
  const p = w.instances.find((i) => i.type === 'game-ball').rt.p
  console.log(`  ${n} шт: поток на y=500 ${speed(f, 800, 500).toFixed(0)} px/с, шар поднят до y=${p.y.toFixed(0)} (старт 600, пол 847)`)
}

console.log('\n=== закрытая камера с единственным выходом ===')
for (const gap of [360, 180, 90]) {
  const h = gap / 2
  const w = sim([
    ground(), fan('f', 800, 800, -90, 520),
    wall('wl', 0, 460, 600, 862), wall('wr', 1000, 460, 1600, 862),
    wall('cl', 0, 380, 800 - h, 460), wall('cr', 800 + h, 380, 1600, 460),
  ], 3)
  const f = field(w)
  const cut = (yy) => {
    const j = Math.floor(yy / f.cell)
    let sum = 0, n = 0
    for (let i = 0; i < f.nx; i++) { const k = i + j * f.nx; if (f.solid[k]) continue; sum += -f.v[k]; n++ }
    return { mean: n ? sum / n : 0, width: n * f.cell, flux: sum * f.cell }
  }
  const wide = cut(600), narrow = cut(420)
  console.log(`  выход ${String(gap).padStart(3)} px: в камере ${wide.width} px при ${wide.mean.toFixed(0)} px/с → ` +
    `в горловине ${narrow.width} px при ${narrow.mean.toFixed(0)} px/с; расход ${(wide.flux / 1000).toFixed(1)} → ${(narrow.flux / 1000).toFixed(1)}`)
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
  const ww = sim([ground(), fan('f1', 800, 840, -90, 700), fan('f2', 800, 790, -90, 700), b], 4)
  const p = ww.instances.find((i) => i.type === 'game-ball').rt.p
  console.log(`  вес ${m}, радиус ${r}: держится на y=${p.y.toFixed(0)} (пол ${(860 - r).toFixed(0)})`)
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
    console.log(`  t=${t + 1}c: ветер по X ${air().x.toFixed(0)}, шар x=${p.x.toFixed(0)} скорость ${((p.x - p.px) * 120).toFixed(0)} px/с`)
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
