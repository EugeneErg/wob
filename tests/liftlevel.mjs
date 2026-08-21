import '../src/entities/index.js'
import { World } from '../src/core/world.js'
import { level } from './level.mjs'
const lvl = level('lvl-lift')
const w = new World(structuredClone(lvl))
let got = 0
w.on('goal:progress', (e) => (got += e.delta))
const run = (n) => { for (let i = 0; i < n; i++) w.step(1 / 60) }
const balls = () => w.instances.filter((x) => x.type === 'game-ball')
const slab = () => w.instances.find((x) => x.type === 'object').rt.verts
const top = () => Math.min(...slab().map((p) => p.y))

run(180)
console.log('старт: верх плиты', top().toFixed(0), '| ползут по конструкции', balls().filter((b) => b.rt.state === 'walk').length)

// игрок цепляет летающие шары к конструкции на плите
let used = 0
for (const b of balls().filter((q) => q.data.builtMass < 0)) {
  if (used >= 4) break
  const p = b.rt.p
  const drop = { x: 600 + used * 45, y: 690 - used * 8 }
  w.pointerDown({ x: p.x, y: p.y })
  for (let k = 0; k < 12; k++) { w.pointerMove(drop); w.step(1 / 60) }
  w.pointerUp(drop)
  run(40)
  if (b.rt.state === 'built') used++
}
console.log('прицеплено летающих:', used)
run(60 * 8)
console.log('верх плиты', top().toFixed(0), '| труба зацепилась:', !!w.instances.find((x) => x.type === 'pipe').rt.link)
run(60 * 10)
console.log('всосано в трубу:', got, 'из цели', lvl.goal)
