import '../src/entities/index.js'
import { World } from '../src/core/world.js'
import { getEntity } from '../src/core/registry.js'
import { shapesForLevel } from '../src/core/scene.js'
import { LAYERS } from '../src/core/globals.js'

const sb = (id, x) => ({ id, type: 'system-ball', data: { x, y: 700, r: 17, static: true, links: [], color: '#d8cbb0', linkColor: '#b9ae95' } })
const level = { width: 1600, height: 900, gravity: { x: 0, y: 1800 }, entities: [sb('a', 400), sb('b', 480), sb('c', 560)] }

const bulk = getEntity('system-ball').editor.bulk
const list = level.entities.map((e) => ({ id: e.id, data: e.data }))
console.log('действие называется:', JSON.stringify(bulk.label))

bulk.apply(list)
console.log('после связывания:', level.entities.map((e) => `${e.id}→[${e.data.links}]`).join(' '))
console.log('линий в редакторе:', shapesForLevel(level).filter((s) => s.layer === LAYERS.structure).length, '(ожидаем 6: 3 связи по 2 линии)')
const w = new World(structuredClone(level))
for (let i = 0; i < 30; i++) w.step(1 / 60)
console.log('связей в мире:', w.physics.links.length, '(ожидаем 3)')

bulk.apply(list)
console.log('повторное нажатие:', level.entities.map((e) => `${e.id}→[${e.data.links}]`).join(' '))
const w2 = new World(structuredClone(level))
for (let i = 0; i < 30; i++) w2.step(1 / 60)
console.log('связей в мире:', w2.physics.links.length, '(ожидаем 0)')

// частичный случай: связаны только a-b, добавляем c — должно достроить, а не разорвать
list[0].data.links = ['b']; list[1].data.links = ['a']; list[2].data.links = []
bulk.apply(list)
console.log('достройка до полного графа:', level.entities.map((e) => `${e.id}→[${e.data.links}]`).join(' '))
