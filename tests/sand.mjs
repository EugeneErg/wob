import '../src/entities/index.js'
import { World } from '../src/core/world.js'
import { insideRegion } from '../src/core/geom.js'

const lvl = { width: 1600, height: 900, gravity: { x: 0, y: 1800 }, entities: [
  { id: 'g', type: 'terrain', data: { points: [[0, 860], [1600, 860], [1600, 900], [0, 900]], smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } },
  { id: 'sand', type: 'sand', data: { points: [[400, 500], [900, 500], [900, 860], [400, 860]], polys: null, dig: 22, smoothness: 0.25, fill: '#c9a86a', edge: '#8a6f3e' } },
  { id: 'b', type: 'system-ball', data: { x: 650, y: 400, r: 17, static: false, links: [], color: '#d8cbb0', linkColor: '#b9ae95' } },
] }
const w = new World(structuredClone(lvl))
const run = (n) => { for (let i = 0; i < n; i++) w.step(1 / 60) }
const sand = w.instances.find((i) => i.type === 'sand')
const ball = w.instances.find((i) => i.type === 'system-ball').rt.p

run(120)
console.log('шар лёг на песок: y =', ball.y.toFixed(1), '(верх песка 500, радиус 17)')

// игрок ведёт курсором сквозь песок — прокапывает горизонтальный ход
w.pointerDown({ x: 420, y: 700 })
for (let x = 420; x <= 880; x += 20) { w.pointerMove({ x, y: 700 }); w.step(1 / 60) }
w.pointerUp({ x: 880, y: 700 })
console.log('колец в области:', sand.rt.polys.flat().length, '| дырка появилась:', sand.rt.polys.flat().length > 1)
console.log('точка (650,700) внутри песка:', insideRegion(650, 700, sand.rt.polys), '(должно быть false)')
console.log('точка (650,600) внутри песка:', insideRegion(650, 600, sand.rt.polys), '(должно быть true)')

// теперь прокопаем шахту сверху вниз — шар должен провалиться в неё
w.pointerDown({ x: 650, y: 505 })
for (let y = 505; y <= 860; y += 15) { w.pointerMove({ x: 650, y }); w.step(1 / 60) }
w.pointerUp({ x: 650, y: 860 })
run(240)
console.log('после шахты шар провалился до y =', ball.y.toFixed(1), '(дно 860)')
