// Вода и песок. Песок — копаемый рельеф: игрок прогрызает его мышью прямо во
// время игры. Значит настоящая проверка не «стоит ли вода на песке», а
// выдержит ли она, когда геометрия меняется под ней на ходу.

import '../src/entities/index.js'
import { World } from '../src/core/world.js'

const wall = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
const terr = (id, a, b, c, d) => ({ id, type: 'terrain', data: { points: wall(a, b, c, d), smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } })

const level = {
  width: 1200, height: 800, gravity: { x: 0, y: 1800 },
  entities: [
    terr('floor', 0, 740, 1200, 800),
    terr('l', 260, 300, 300, 740), terr('r', 900, 300, 940, 740),
    // песчаная перемычка поперёк чаши, вода стоит НА ней
    { id: 's', type: 'sand', data: { points: wall(300, 560, 900, 660), polys: null, dig: 22, smoothness: 0.25, fill: '#c9a86a', edge: '#8a6f3e' } },
    { id: 'w', type: 'liquid', data: { points: [[305, 400], [895, 400], [895, 555], [305, 555]], polys: null, substance: 'water', grain: 11, limit: 900 } },
  ],
}

const w = new World(structuredClone(level))
w.step(1 / 60)
const drops = () => w.physics.points.filter((p) => p.owner === 'w' && !p.removed)
const below = () => drops().filter((p) => p.y > 680).length

for (let i = 0; i < 60 * 4; i++) w.step(1 / 60)
const held = drops().length
console.log(`1. вода стоит на песке: ${held} частиц, ниже перемычки ${below()} ⇒ ${below() < 10 ? 'песок держит' : 'ПРОТЕКАЕТ'}`)

// --- копаем канал прямо под водой -------------------------------------------
w.pointerDown({ x: 600, y: 610 })
for (let k = 0; k < 12; k++) {
  w.pointerMove({ x: 600, y: 560 + k * 10 })
  w.step(1 / 60)
}
w.pointerUp({ x: 600, y: 670 })

for (let i = 0; i < 60 * 6; i++) w.step(1 / 60)
console.log(`2. прокопали канал: ниже перемычки стало ${below()} частиц ⇒ ${below() > 30 ? 'вода пошла в промоину' : 'НЕ ПОШЛА'}`)

// --- устойчивость: ничего не улетело ----------------------------------------
let vmax = 0
for (const p of drops()) { const v = Math.hypot(p.vx, p.vy); if (v > vmax) vmax = v }
console.log(`3. осталось ${drops().length} из ${held} частиц, скорость до ${vmax.toFixed(0)} px/с ⇒ ${drops().length > held * 0.9 && vmax < 900 ? 'устойчиво' : 'ПОТЕРИ ИЛИ РАЗГОН'}`)
