// Жидкостью должно быть можно ПОЛЬЗОВАТЬСЯ: нарисовать в редакторе, увидеть
// превью, подвинуть, сохранить уровень и открыть заново. Физику легко проверять
// и легко забыть, что фича начинается не с неё.

import '../src/entities/index.js'
import { World } from '../src/core/world.js'
import { getEntity, allEntities } from '../src/core/registry.js'
import { shapesForLevel } from '../src/core/scene.js'

const def = getEntity('liquid')
console.log('1. сущность зарегистрирована:', !!def, '| в списке редактора:', allEntities().some((e) => e.type === 'liquid'))

// --- рисование мышью --------------------------------------------------------
const c = def.editor.create
const draft = c.start()
for (const [x, y] of [[100, 100], [300, 100], [300, 250], [100, 250]]) c.click(draft, { x, y })
c.move(draft, { x: 120, y: 260 })
const preview = c.shapes(draft)
const data = c.finish(draft)
console.log('2. превью при рисовании:', preview.length, 'фигур | получились данные:', !!data, '| точек', data?.points.length)

// --- превью в редакторе (мира нет, рантайма нет) ----------------------------
// Пол нужен: без него вода честно улетает за край и прибирается, а проверять
// мы хотим сохранение уровня, а не падение.
const floor = { id: 'f', type: 'terrain', data: { points: [[0, 700], [1200, 700], [1200, 800], [0, 800]], smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } }
const level = { width: 1200, height: 800, gravity: { x: 0, y: 1800 }, entities: [floor, { id: 'w', type: 'liquid', data }] }
const still = shapesForLevel(level)
console.log('3. рисуется без запуска мира:', still.length > 0, '| фигур', still.length)

// --- рамка, попадание, перенос ----------------------------------------------
const b = def.editor.bounds(data)
const hitIn = def.editor.hit(data, { x: 200, y: 180 })
const hitOut = def.editor.hit(data, { x: 900, y: 180 })
console.log(`4. рамка ${b.w.toFixed(0)}×${b.h.toFixed(0)} | попадание внутрь ${hitIn}, мимо ${hitOut}`)
def.editor.move(data, 50, 20)
console.log('5. перенос на (50,20): первая точка стала', data.points[0])

// --- ручки -------------------------------------------------------------------
const handles = def.editor.handles(data)
def.editor.moveHandles(data, [0], 10, 0)
const added = (def.editor.addHandle(data, { x: 250, y: 270 }), data.points.length)
console.log(`6. ручек ${handles.length} | после добавления точек ${added}`)

// --- настройки ---------------------------------------------------------------
const props = def.editor.props()
console.log('7. в инспекторе:', props.map((p) => p.key).join(', '))

// --- уровень переживает сохранение -------------------------------------------
const saved = JSON.parse(JSON.stringify(level))
const w = new World(saved)
w.step(1 / 60)
const n = w.physics.points.filter((p) => p.owner === 'w' && !p.removed).length
for (let i = 0; i < 120; i++) w.step(1 / 60)
const paths = w.scene().filter((s) => s.k === 'path' && s.d)
console.log(`8. уровень открыт заново: налито ${n} частиц, контуров ${paths.length}`)
