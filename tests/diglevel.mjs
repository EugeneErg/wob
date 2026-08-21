import '../src/entities/index.js'
import { World } from '../src/core/world.js'
import { level } from './level.mjs'
const lvl = level('lvl-dig')
const w = new World(structuredClone(lvl))
const run = (n) => { for (let i = 0; i < n; i++) w.step(1 / 60) }
const balls = () => w.instances.filter((x) => x.type === 'game-ball')
const past = () => balls().filter((b) => b.rt.p.x > 830).length

run(60 * 6)
console.log('до раскопок за стеной шаров:', past(), '| максимальный x:', Math.max(...balls().map((b) => b.rt.p.x)).toFixed(0), '(стена 620..820)')

// начинаем жест далеко от песка, в пустоте слева — подкоп всё равно должен получиться
w.pointerDown({ x: 950, y: 782 })
for (let x = 950; x >= 500; x -= 15) { w.pointerMove({ x, y: 782 }); w.step(1 / 60) }
w.pointerUp({ x: 500, y: 782 })
const sand = w.instances.find((i) => i.type === 'sand')
console.log('колец в песке после тоннеля:', sand.rt.polys.flat().length)
for (let t = 0; t < 6; t++) {
  run(60 * 5)
  const xs = balls().map((b) => b.rt.p.x)
  const before = xs.filter((x) => x < 620).length, inside = xs.filter((x) => x >= 620 && x <= 830).length
  console.log(`  +${(t + 1) * 5}c: до стены ${before}, в тоннеле ${inside}, за стеной ${past()}`)
}
