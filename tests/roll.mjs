import '../src/entities/index.js'
import { World } from '../src/core/world.js'

// Круглое тело катится, а не скользит: трение приложено в точке касания и
// потому раскручивает его, а не гасит ход. Отдельного свойства «умеет
// катиться» нет — катится всё, у чего есть радиус и что не входит в жёсткое
// тело (за вершины жёсткого тела вращение делает само тело).

const ball = (x, y, r = 18, extra = {}) => ({ id: 'b', type: 'system-ball', data: { x, y, r, static: false, links: [], color: '#d8cbb0', linkColor: '#b9ae95', ...extra } })
const sand = (smoothness) => ({ id: 'sand', type: 'sand', data: { points: [[300, 200], [1300, 200], [1300, 800], [300, 800]], polys: null, dig: 26, smoothness, fill: '#c9a86a', edge: '#8a6f3e' } })
const world = (entities) => new World({ width: 1600, height: 900, gravity: { x: 0, y: 1800 }, entities })
const of = (w, type) => w.instances.find((i) => i.type === type)

// вырезаем в песке дугу радиуса R с центром в (CX, CY) — получается чаша
function digArc(w, CX, CY, R) {
  const pts = []
  for (let a = 180; a >= 0; a -= 4) {
    const t = (a * Math.PI) / 180
    pts.push({ x: CX + Math.cos(t) * R, y: CY + Math.sin(t) * R })
  }
  w.pointerDown(pts[0])
  for (const pt of pts) { w.pointerMove(pt); w.step(1 / 60) }
  w.pointerUp(pts[pts.length - 1])
  return pts
}

console.log('=== шар в дугообразной траншее несёт инерцию ===')
{
  const CX = 800, CY = 300, R = 260
  const w = world([sand(0.25), ball(CX - R + 10, CY - 40)])
  digArc(w, CX, CY, R)
  const p = of(w, 'system-ball').rt.p
  let top = p.x, peak = 0, turns = 0, dir = 0
  for (let i = 0; i < 60 * 8; i++) {
    w.step(1 / 60)
    const v = (p.x - p.px) * 120
    peak = Math.max(peak, Math.abs(v))
    top = Math.max(top, p.x)
    const d = Math.sign(v)
    if (d && dir && d !== dir && Math.abs(v) > 20) turns++
    if (Math.abs(v) > 20) dir = d
  }
  console.log(`  скатился слева, разогнался до ${peak.toFixed(0)} px/с, выкатился вправо до x=${top.toFixed(0)}`)
  console.log(`  (дно чаши ${CX}, правый край ${CX + R}) — маятником через дно прошёл ${turns} раз`)
}

console.log('\n=== сопротивление качению берётся из гладкости опоры ===')
for (const [name, sm] of [['лёд 0.95', 0.95], ['камень 0.5', 0.5], ['песок 0.15', 0.15]]) {
  const w = world([
    { id: 'g', type: 'terrain', data: { points: [[0, 700], [1600, 700], [1600, 900], [0, 900]], smoothness: sm, fill: '#2a3326', edge: '#66804f' } },
    ball(200, 680),
  ])
  const p = of(w, 'system-ball').rt.p
  for (let i = 0; i < 30; i++) w.step(1 / 60)
  p.px = p.x - 400 / 120   // толкнули вправо на 400 px/с
  let last = p.x
  for (let i = 0; i < 60 * 6; i++) { w.step(1 / 60); last = p.x }
  console.log(`  ${name.padEnd(11)}: проехал ${(last - 200).toFixed(0)} px, скорость к концу ${((p.x - p.px) * 120).toFixed(0)} px/с`)
}

console.log('\n=== вершины жёсткого тела сами не крутятся ===')
{
  const w = world([
    { id: 'g', type: 'terrain', data: { points: [[0, 700], [1600, 700], [1600, 900], [0, 900]], smoothness: 0.4, fill: '#2a3326', edge: '#66804f' } },
    { id: 'o', type: 'object', data: { points: [[500, 600], [600, 600], [600, 680], [500, 680]], mass: 8, smoothness: 0.4, restitution: 0.1, static: false, fill: '#5c5346', edge: '#8d7f68' } },
  ])
  for (let i = 0; i < 120; i++) w.step(1 / 60)
  const vs = of(w, 'object').rt.verts
  console.log(`  ящик лежит на земле, вершин ${vs.length}, все в жёстком теле: ${vs.every((v) => v.rigid > 0)}`)
  console.log(`  их собственное вращение ${vs.every((v) => v.spin === 0) ? 'выключено' : 'ВКЛЮЧЕНО — так нельзя'} — за поворот отвечает тело`)
}

console.log('\n=== вентилятор гонит шар по прокопанной траншее ===')
for (const power of [0, 300, 520, 900]) {
  const w = world([
    { id: 'sand', type: 'sand', data: { points: [[300, 400], [1400, 400], [1400, 850], [300, 850]], polys: null, dig: 30, smoothness: 0.25, fill: '#c9a86a', edge: '#8a6f3e' } },
    { id: 'f', type: 'fan', data: { x: 350, y: 600, angle: 0, power, nozzle: 40, cell: 22, push: 9, show: true, color: '#7fb6cc' } },
    ball(900, 200),
  ])
  w.pointerDown({ x: 320, y: 600 })
  for (let x = 320; x <= 1390; x += 15) { w.pointerMove({ x, y: 600 }); w.step(1 / 60) }
  w.pointerUp({ x: 1390, y: 600 })
  const p = of(w, 'system-ball').rt.p
  p.x = 900; p.y = 605; p.px = 900; p.py = 605; p.spin = 0   // кладём шар в траншею
  for (let i = 0; i < 60; i++) w.step(1 / 60)
  const x0 = p.x
  for (let i = 0; i < 60 * 4; i++) w.step(1 / 60)
  console.log(`  мощность ${String(power).padStart(4)}: сдвинул на ${(p.x - x0).toFixed(0).padStart(4)} px`)
}
