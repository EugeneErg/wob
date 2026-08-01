import '../src/entities/index.js'
import { World } from '../src/core/world.js'
import { readFileSync } from 'fs'
const lvl = JSON.parse(readFileSync(new URL('../src/levels/bridge.json', import.meta.url), 'utf8'))
const w = new World(structuredClone(lvl))
const run = (n) => { for (let i = 0; i < n; i++) w.step(1 / 60) }
const balls = () => w.instances.filter((x) => x.type === 'game-ball')
run(60)
// тянем мост вправо через пропасть
const spots = [[540, 560], [610, 555], [680, 552], [750, 550], [820, 552], [890, 556]]
for (const [x, y] of spots) {
  const b = balls().filter((q) => q.rt.state === 'free').sort((a, c) => a.rt.p.x - c.rt.p.x)[0]
  if (!b) break
  w.pointerDown({ x: b.rt.p.x, y: b.rt.p.y })
  for (let k = 0; k < 15; k++) { w.pointerMove({ x, y }); w.step(1 / 60) }
  w.pointerUp({ x, y })
  run(60)
  const tip = balls().filter((q) => q.rt.state === 'built').sort((a, c) => c.rt.p.x - a.rt.p.x)[0]
  console.log(`пролёт до x=${x}: кончик ${tip.rt.p.x.toFixed(0)},${tip.rt.p.y.toFixed(0)} (клали на y=${y}) провис ${(tip.rt.p.y - y).toFixed(1)} px, связей ${w.physics.links.length}`)
}
run(300)
const built = balls().filter((q) => q.rt.state === 'built')
console.log('через 5 c: в конструкции', built.length, '| связей', w.physics.links.length,
  '| макс натяжение', Math.max(0, ...w.physics.links.map((l) => l.tension)).toFixed(0), 'из 26000')
