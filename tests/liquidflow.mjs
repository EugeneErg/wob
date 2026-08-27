// Поведение, которого никто не программировал: перелив через край, струя,
// отрыв капли, копание под водой. Всё это должно получаться само из
// несжимаемости и поверхностного натяжения, а не из веток в коде.

import '../src/entities/index.js'
import { World } from '../src/core/world.js'

const wall = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
const terr = (id, a, b, c, d) => ({ id, type: 'terrain', data: { points: wall(a, b, c, d), smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } })
const drops = (w) => w.physics.points.filter((p) => p.owner === 'w' && !p.removed)

// --- 1. перелив через край -------------------------------------------------
{
  // Таз с низким правым бортом: налитая доверху вода обязана перетечь.
  const w = new World({
    width: 1200, height: 800, gravity: { x: 0, y: 1800 },
    entities: [
      terr('floor', 0, 740, 1200, 800),
      terr('l', 200, 400, 240, 740),
      terr('r', 620, 560, 660, 740),          // борт ниже уровня налива
      { id: 'w', type: 'liquid', data: { points: [[245, 430], [615, 430], [615, 735], [245, 735]], polys: null, substance: 'water', grain: 11, limit: 1500 } },
    ],
  })
  w.step(1 / 60)
  const total = drops(w).length
  for (let i = 0; i < 60 * 8; i++) w.step(1 / 60)
  // Считаем УБЫЛЬ слева, а не выживших справа: за низким бортом уровень
  // обрывается без стены, перетёкшая вода уходит за край мира и прибирается.
  // Считать её на полу — значит мерить уборку, а не перелив.
  const left = drops(w).filter((p) => p.x < 615).length
  const gone = total - left
  const rim = Math.min(...drops(w).filter((p) => p.x < 615).map((p) => p.y))
  console.log(`1. перелив: из ${total} частиц ушло за борт ${gone} (${(100 * gone / total).toFixed(0)} %), урез встал на ${rim.toFixed(0)} при борте 560 ⇒ ${gone > 100 && rim > 530 ? 'слилось до кромки' : 'НЕ СЛИЛОСЬ'}`)
}

// --- 2. струя и отрыв капли ------------------------------------------------
{
  // Узкий столб воды в воздухе: должен упасть струёй и разбиться, а не
  // рассыпаться сразу в пыль и не слипнуться в один ком.
  const w = new World({
    width: 1200, height: 800, gravity: { x: 0, y: 1800 },
    entities: [
      terr('floor', 0, 740, 1200, 800),
      // Боковые стены обязательны: в эталоне край мира держала невидимая
      // коробка, здесь его держит рельеф. Без стен всплеск честно улетает
      // за пределы уровня — и это не дефект жидкости.
      terr('wl', 0, 300, 40, 740), terr('wr', 1160, 300, 1200, 740),
      { id: 'w', type: 'liquid', data: { points: [[580, 120], [640, 120], [640, 300], [580, 300]], polys: null, substance: 'water', grain: 11, limit: 400 } },
    ],
  })
  w.step(1 / 60)
  const n0 = drops(w).length
  for (let i = 0; i < 60 * 6; i++) w.step(1 / 60)
  const d = drops(w)
  let vmax = 0
  for (const p of d) { const v = Math.hypot(p.vx, p.vy); if (v > vmax) vmax = v }
  const lost = d.filter((p) => p.y > 745).length
  const paths = w.scene().filter((s) => s.k === 'path' && s.d)
  console.log(`2. струя: ${n0} частиц упали и растеклись, провалились сквозь пол ${lost}, скорость осела до ${vmax.toFixed(0)} px/с, контур цел: ${paths.length > 0}`)
}

// --- 3. копание рельефа под водой ------------------------------------------
{
  const w = new World({
    width: 1200, height: 800, gravity: { x: 0, y: 1800 },
    entities: [
      terr('floor', 0, 740, 1200, 800),
      terr('l', 200, 400, 240, 740),
      terr('r', 900, 400, 940, 740),
      terr('dam', 560, 560, 600, 740),        // перемычка посреди таза
      { id: 'w', type: 'liquid', data: { points: [[245, 480], [555, 480], [555, 735], [245, 735]], polys: null, substance: 'water', grain: 11, limit: 1200 } },
    ],
  })
  w.step(1 / 60)
  for (let i = 0; i < 60 * 4; i++) w.step(1 / 60)
  const rightBefore = drops(w).filter((p) => p.x > 610).length
  // пробиваем перемычку
  w.despawn(w.instances.find((i) => i.id === 'dam'))
  for (let i = 0; i < 60 * 6; i++) w.step(1 / 60)
  const rightAfter = drops(w).filter((p) => p.x > 610).length
  console.log(`3. прорыв перемычки: справа было ${rightBefore}, стало ${rightAfter} ⇒ ${rightAfter > rightBefore + 50 ? 'вода пошла' : 'НЕ ПОШЛА'}`)
}
