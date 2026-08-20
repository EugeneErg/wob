import '../src/entities/index.js'
import { World } from '../src/core/world.js'
import { EVENTS } from '../src/core/globals.js'
import { readFileSync } from 'fs'
const lvl = JSON.parse(readFileSync(new URL('../src/levels/hole.json', import.meta.url), 'utf8'))
const w = new World(structuredClone(lvl))
let score = 0
w.on(EVENTS.progress, (e) => (score += e.delta))
const run = (n) => { for (let i = 0; i < n; i++) w.step(1 / 60) }
const ball = () => w.instances.find((i) => i.type === 'system-ball').rt.p

run(60)
console.log(`шар лежит на песке: (${ball().x.toFixed(0)}, ${ball().y.toFixed(0)})`)

// прокапываем шахту под шаром — он падает на ледяной склон
// сначала шахта под шаром, потом ход вправо — иначе шар просто сядет в яму
w.pointerDown({ x: 830, y: 290 })
for (let y = 290; y >= 108; y -= 12) { w.pointerMove({ x: 830, y }); w.step(1 / 60) }
for (let x = 830; x <= 1000; x += 12) { w.pointerMove({ x, y: 275 }); w.step(1 / 60) }
w.pointerUp({ x: 1000, y: 275 })
for (let t = 0; t < 16; t++) {
  run(60)
  const p = ball()
  if (t % 3 === 2 || score) console.log(`  t=${t + 1}c шар (${p.x.toFixed(0)}, ${p.y.toFixed(0)}) скорость ${(Math.hypot(p.vx, p.vy)).toFixed(0)} px/с, счёт ${score}`)
}
console.log(score >= lvl.goal ? 'уровень пройден' : 'шар до лунки не дошёл')
