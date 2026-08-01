import '../src/entities/index.js'
import { World } from '../src/core/world.js'
import { readFileSync } from 'fs'
const lvl = JSON.parse(readFileSync(new URL('../src/levels/bridge.json', import.meta.url), 'utf8'))
// уносим конструкцию на правый берег, чтобы шары рвались через пропасть
lvl.entities = lvl.entities.map((e) => {
  if (e.id === 'sb1') return { ...e, data: { ...e.data, x: 1150, y: 543, links: ['sb3'] } }
  if (e.id === 'sb2') return { ...e, data: { ...e.data, x: 1220, y: 543, links: ['sb3'] } }
  if (e.id === 'sb3') return { ...e, data: { ...e.data, links: ['sb1', 'sb2'] } }
  return e
})
const w = new World(lvl)
let lost = 0
w.on('ball:lost', () => lost++)
const balls = () => w.instances.filter((x) => x.type === 'game-ball')
for (let t = 0; t < 15; t++) {
  for (let i = 0; i < 60; i++) w.step(1 / 60)
  const b = balls()
  const fell = b.filter((q) => q.rt.p.y > 700).length
  if (t % 3 === 2 || t === 14) console.log(`t=${t + 1}c шаров ${b.length}, упало в пропасть ${fell}, потеряно ${lost}, макс x ${Math.max(...b.map((q) => q.rt.p.x)).toFixed(0)} (обрыв на 500)`)
}
