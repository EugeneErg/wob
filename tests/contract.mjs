// Сторож архитектуры: сущность, которой ядро в глаза не видело, должна
// заработать в игре и в редакторе от одного импорта — и не получить при этом
// никакого доступа к чужим сущностям.
import '../src/entities/index.js'
import { defineEntity, allEntities, getEntity } from '../src/core/registry.js'
import { World } from '../src/core/world.js'
import { shapesForLevel, readOnlyContext, contextSurface } from '../src/core/scene.js'
import { EVENTS, LAYERS } from '../src/core/globals.js'

let sawForeign = null

defineEntity({
  type: 'test-widget',
  title: 'Тестовая штука',
  z: LAYERS.body,
  icon: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12"/></svg>',
  defaults: () => ({ x: 0, y: 0 }),
  spawn(ctx, data) {
    return { p: ctx.addPoint({ x: data.x, y: data.y, radius: 10, mass: 1, attachable: true }) }
  },
  update(rt, ctx) {
    // всё, что видно про чужое тело
    const foreign = ctx.query((q) => q !== rt.p)[0]
    if (foreign && !sawForeign) sawForeign = Object.keys(foreign)
    if (ctx.time > 0.5 && !rt.done) { rt.done = true; ctx.emit(EVENTS.progress, { delta: 1 }) }
  },
  // отрисовка вправе спрашивать мир — и в игре, и в редакторе
  shapes: (data, rt, ctx) => [{
    k: 'circle', x: rt?.p ? rt.p.x : data.x, y: rt?.p ? rt.p.y : data.y,
    r: ctx.solidAt(data.x, data.y) ? 12 : 10, fill: '#fff',
  }],
  editor: {
    create: { start: () => ({}), click: (d, pt) => { Object.assign(d, pt); return 'done' }, finish: (d) => ({ x: d.x, y: d.y }) },
    bounds: (d) => ({ x: d.x - 10, y: d.y - 10, w: 20, h: 20 }),
    hit: () => false,
    props: () => [{ key: 'x', label: 'X', type: 'number' }],
  },
})

// 1. появляется в реестре — значит и кнопкой в редакторе
const inRail = allEntities().some((e) => e.type === 'test-widget')
console.log('1. кнопка в редакторе появилась сама:', inRail)

// 2. живёт в мире наравне с остальными
const level = {
  width: 1600, height: 900, gravity: { x: 0, y: 1800 },
  entities: [
    { id: 'g', type: 'terrain', data: { points: [[0, 780], [1600, 780], [1600, 900], [0, 900]], smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } },
    { id: 'w1', type: 'test-widget', data: { x: 400, y: 600 } },
    { id: 's1', type: 'system-ball', data: { x: 700, y: 600, r: 17, static: true, links: [], color: '#d8cbb0', linkColor: '#b9ae95' } },
  ],
}
const w = new World(structuredClone(level))
let scored = 0
w.on(EVENTS.progress, (e) => (scored += e.delta))
for (let i = 0; i < 60; i++) w.step(1 / 60)
console.log('2. мир её обновляет и рисует:', w.scene().length > 0, '| очки засчитаны интерфейсом:', scored === 1)

// 3. редактор рисует её без рантайма
console.log('3. превью в редакторе строится:', shapesForLevel(level).length > 0)

// 4. что именно видно про чужое тело
// Список — не «что накопилось», а что сущности законно видеть: положение и
// скорость, силы за кадр, вращение и глобальные свойства из core/globals.js.
// Появится здесь тип, данные или рантайм соседа — сторож упадёт.
const allowed = [
  'id', 'x', 'y',                      // где тело сейчас
  'vx', 'vy',                          // и как быстро идёт, px/с — состояние, а не разность
  'sx', 'sy',                          // где точка была в начале подшага (служебное)
  'ax', 'ay', 'fx', 'fy', 'cn',        // силы и нормальный импульс за подшаг
  'cux', 'cuy', 'cvx', 'cvy',          // аффинная часть скорости частицы среды (APIC)
  'spin', 'angle', 'rigid',            // вращение диска и участие в жёстком теле
  'phase',                             // вещество (см. core/fluid.js)
  'radius', 'mass', 'lift', 'restitution', 'smoothness', 'collision',
  'attachable', 'suction', 'pinned', 'gravityScale',
  'owner', 'group', 'links', 'removed']
const extra = (sawForeign || []).filter((k) => !allowed.includes(k))
console.log('4. поля чужого тела:', (sawForeign || []).join(','))
console.log('   лишнего (типа, данных, рантайма соседа) не видно:', extra.length === 0)

// 5. в мире нет способа спросить тип чужой сущности
const inst = w.instances.find((i) => i.type === 'test-widget')
const api = Object.keys(inst.ctx).concat(Object.getOwnPropertyNames(Object.getPrototypeOf(inst.ctx)))
const leaks = api.filter((k) => /type|instances|entity|def/i.test(k))
console.log('5. в фасаде нет доступа к типам и инстансам:', leaks.length === 0, leaks.length ? leaks.join(',') : '')
console.log('   peers() отдаёт только своих:', inst.ctx.peers().length === 0, '(в мире есть шар и рельеф, но они чужого типа)')

// 6. неизвестный тип не теряется молча
const w2 = new World({ width: 100, height: 100, entities: [{ id: 'x', type: 'нет-такой', data: {} }] })
let told = null
new World({ width: 100, height: 100, entities: [] }).on(EVENTS.missing, () => {})
console.log('6. про неизвестный тип мир сообщает:', w2.missing.join(',') === 'нет-такой')

// 7. контекст в редакторе той же формы, что и в игре
const stub = readOnlyContext(level, level.entities[1])
const missing = contextSurface().filter((k) => !(k in stub))
console.log('7. заглушка редактора покрывает весь фасад:', missing.length === 0, missing.join(',') || '')
let guarded = false
try { stub.addPoint({}) } catch { guarded = true }
console.log('   меняющие мир методы в редакторе запрещены:', guarded)
