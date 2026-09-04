// Редакторские жесты: доска истории, точки и полка.
//
// Эти проверки существуют потому, что сюита до сих пор умела только рисовать
// экраны, а не нажимать. Из-за этого дважды подряд дыры находились вопросом, а
// не прогоном: `storyId` в ChapterMap не был объявлен вовсе — создание уровня с
// аккаунтом падало на ReferenceError, — а поставить один уровень во второе
// место было нельзя ни одним действием, при том что ради этого точкам и дали
// собственные имена.
//
// Здесь проверяется логика, которую вызывают обработчики видов, а не сами
// обработчики: DOM тут по-прежнему нет. Это ловит расхождения модели, но не
// опечатки в разметке — про них честно сказано в конце файла.

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const lib = await import('../src/core/library.js')

// В проверках сервера нет, а имена выдаёт он. Считаем сами — так видно, что
// библиотека их только раскладывает, а не придумывает.
let minted = 0
const mint = (p) => `${p}-t${++minted}`
const { seed } = await import('./seed.mjs')
const { activeChapter, openChapters, doneByChapter, ChainRun } = await import('../src/core/chain.js')
const { KIND } = await import('../src/core/replays.js')
const { check, equal } = await import('./assert.mjs')

seed(lib)

const story = lib.stories()[0]
const chapters = () => lib.chaptersOf(story.id)
const [first, second] = chapters()

// --- список уровней и второе место для одного уровня -------------------------
console.log('\n— уровень в нескольких точках')

const levels = lib.levelsOf(story.id)
equal('уровни истории видны все', levels.length, 6)

const shared = first.nodes[0].levelId
const before = lib.levelsOf(story.id).length
const extra = lib.pinLevel(second.id, shared, mint('nd'))

check('уровень встал во вторую главу', !!extra)
equal('мест у уровня стало два', lib.placesOf(story.id, shared).length, 2)
equal('новый уровень при этом не создан', lib.levelsOf(story.id).length, before)
check('у точек разные имена', extra.id !== first.nodes[0].id)

// Своя связь и свой ролик — то, ради чего у точки собственное имя: один и тот
// же уровень, встреченный второй раз, продолжается иначе.
extra.outro = '/api/media/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
lib.save()
check('ролик принадлежит точке, а не уровню',
  !!lib.chapter(second.id).nodes.find((n) => n.id === extra.id).outro &&
  !lib.chapter(first.id).nodes[0].outro)

// --- снять точку это не удалить уровень --------------------------------------
console.log('\n— снятие точки и удаление уровня')

lib.unpinNode(second.id, extra.id)
equal('точка снята', lib.placesOf(story.id, shared).length, 1)
check('уровень жив: он показан в другом месте', !!lib.level(shared))

// А вот последнее появление уносит уровень с собой: до него больше не добраться,
// и в выгрузке он остался бы грузом, который никто не откроет.
const lone = lib.createLevel(second.id, { id: mint('lvl'), nodeId: mint('nd') }, 'Одинокий')
const loneNode = lib.chapter(second.id).nodes.find((n) => n.levelId === lone.id)
lib.unpinNode(second.id, loneNode.id)
check('последнее появление уносит уровень', !lib.level(lone.id))

// --- показать в точке другой уровень -----------------------------------------
console.log('\n— подмена уровня в точке')

const node = lib.chapter(first.id).nodes[1]
const was = node.levelId
lib.setNodeLevel(first.id, node.id, shared)
equal('точка показывает другой уровень', lib.chapter(first.id).nodes[1].levelId, shared)
check('прежний уровень остался в истории', !!lib.level(was))
lib.setNodeLevel(first.id, node.id, was)

// --- связи снимаются вместе с точкой -----------------------------------------
console.log('\n— висячих связей не остаётся')

const doomed = lib.pinLevel(first.id, shared, mint('nd'))
lib.chapter(first.id).nodes[0].next = [...lib.chapter(first.id).nodes[0].next, doomed.id]
lib.save()
lib.unpinNode(first.id, doomed.id)

check('связь на снятую точку исчезла',
  !lib.chapter(first.id).nodes.some((n) => (n.next || []).includes(doomed.id)))

// --- выделение это точка, а не уровень ---------------------------------------
// Регрессия, которую поймал разбор, а не прогон: обработчик карты выделял узел
// по levelId, а связывание и меню искали по id точки. Пока уровень стоял в одном
// месте, разницы не было — с двумя точками одного уровня выделение указывало бы
// сразу на обе, а связь не находила бы начало и молча не рисовалась.
console.log('\n— выделение указывает на одно место')

const twin = lib.pinLevel(first.id, shared, mint('nd'))
const places = lib.placesOf(story.id, shared)

equal('уровень показан в двух точках', places.length, 2)
check('но имена точек разные', places[0].node.id !== places[1].node.id)

// Связь ведётся от точки к точке: по levelId её начало не найти.
const from = lib.chapter(first.id).nodes.find((n) => n.id === twin.id)
from.next = [places[0].node.id]
lib.save()

check('связь опознаётся по имени точки',
  lib.chapter(first.id).nodes.find((n) => n.id === twin.id).next[0] === places[0].node.id)
check('и по имени уровня — нет',
  !lib.chapter(first.id).nodes.some((n) => (n.next || []).includes(shared)))

lib.unpinNode(first.id, twin.id)

// --- панель: уровень существует раньше, чем место для него -------------------
// До панели уровень нельзя было создать, не положив сразу на карту, а собрать
// историю на одном экране было невозможно: главы делались кнопкой в шапке,
// уровни — только внутри карты главы.
console.log('\n— уровень без места и его размещение')

// Ничего не спрашиваем при создании: имя, картинка и ролик — свойства точки,
// то есть места в истории, а места ещё нет. Уровень получает рабочее имя,
// которым автор различает плитки в панели.
const spare = lib.createLevelIn(story.id, mint('lvl'))
check('уровень получил рабочее имя сам', /^Level \d+$/.test(spare.name), spare.name)
check('уровень виден в списке истории', lib.levelsOf(story.id).some((l) => l.id === spare.id))
check('и числится неразмещённым', lib.unplacedLevels(story.id).some((l) => l.id === spare.id))
equal('точек у него нет', lib.placesOf(story.id, spare.id).length, 0)

// Бросок на область: проценты считаются от главы, а не от доски, поэтому точка
// встаёт туда, куда целились, и переживёт переезд области.
// А при броске место уже выбрано — и вот тут спрашивается всё остальное.
const dropped = lib.pinLevel(first.id, spare.id, mint('nd'), {
  x: 70, y: 40, name: 'Первая встреча', outro: '/api/media/x',
})
equal('имя лежит на точке', dropped.name, 'Первая встреча')
check('а у уровня осталось рабочее', spare.name !== dropped.name)

// Тот же уровень во втором месте зовётся иначе — ради этого имя и переехало.
const again = lib.pinLevel(second.id, spare.id, mint('nd'), { name: 'Она же, но позже' })
equal('второе появление названо по-своему', lib.nodeName(again), 'Она же, но позже')
equal('и первое не изменилось', lib.nodeName(dropped), 'Первая встреча')
lib.unpinNode(second.id, again.id)
equal('после броска точка появилась', lib.placesOf(story.id, spare.id).length, 1)
equal('и встала куда бросили', dropped.x, 70)
check('в списке неразмещённых его больше нет',
  !lib.unplacedLevels(story.id).some((l) => l.id === spare.id))

lib.unpinNode(first.id, dropped.id)

// --- доска истории -----------------------------------------------------------
console.log('\n— доска')

const spot = lib.chapter(second.id).canvas
check('у главы есть место на доске', !!spot && typeof spot.x === 'number')

lib.placeChapter(second.id, { x: 900, y: 120 })
const moved = lib.chapter(second.id)
check('область переехала', moved.canvas.x === 900 && moved.canvas.y === 120)
equal('точки внутри не сдвинулись', moved.nodes[0].x, second.nodes[0].x)

lib.placeChapter(second.id, { w: 600, h: 400 })
check('размер меняется отдельно от места',
  lib.chapter(second.id).canvas.x === 900 && lib.chapter(second.id).canvas.w === 600)

// --- активная глава ----------------------------------------------------------
// У игрока списка глав нет: история открывается сразу картой, и кто-то должен
// ответить какой. С ветвлением открытых глав бывает несколько.
console.log('\n— куда попадает игрок')

const emptyDone = new Map()
equal('в начале — глава, где история начинается',
  activeChapter(story, chapters(), emptyDone), first.id)

// Прошли первую главу целиком: игрок стоит уже в следующей.
const run = new ChainRun({ kind: KIND.STORY, targetId: story.id })
const seg = (t) => ({ ticks: t, finished: true, seed: 1, rate: 60, input: [], camera: [], checks: [] })
for (const n of lib.chapter(first.id).nodes) {
  run.push(seg(300), { levelId: n.levelId, nodeId: n.id, chapterId: first.id })
}
const done = doneByChapter(run)

check('вторая глава открылась', openChapters(story, chapters(), done).includes(second.id))
equal('игрок оказывается в ней', activeChapter(story, chapters(), done), second.id)

// --- полка ассетов -----------------------------------------------------------
console.log('\n— ассет как группа сущностей')

const group = lib.createAsset({ id: mint('as'),
  title: 'Мотор с рычагом',
  entities: [
    { id: 'e-motor', type: 'motor', data: { x: 0, y: 0 } },
    { id: 'e-arm', type: 'object', data: { x: 40, y: 0 }, parent: 'e-motor' },
  ],
})

equal('ассет держит обе части', group.entities.length, 2)
check('типы внутри известны палитре',
  lib.assetTypes(group).join() === 'motor,object')

const single = lib.createAsset({ id: mint('as'), title: 'Опора', entities: [{ id: 'e-1', type: 'system-ball', data: {} }] })
equal('одиночная сущность — группа из одной', single.entities.length, 1)

// Вставка ассета в уровень: у частей новые имена, а сборка не разъезжается —
// ссылка на родителя переписана на новое имя, а не на чужое.
const rename = new Map(group.entities.map((e) => [e.id, 'new-' + e.id]))
const placed = group.entities.map((e) => ({
  id: rename.get(e.id),
  type: e.type,
  ...(e.parent && rename.has(e.parent) ? { parent: rename.get(e.parent) } : {}),
}))

check('у вставленных частей новые имена', placed.every((e) => e.id.startsWith('new-')))
equal('рычаг всё ещё на своём моторе', placed[1].parent, 'new-e-motor')
check('на исходные имена ничего не ссылается',
  !placed.some((e) => e.parent && !placed.some((x) => x.id === e.parent)))

console.log('\nчего эти проверки НЕ ловят:')
console.log('  разметку видов — здесь нет DOM, только логика под обработчиками;')
console.log('  необъявленную переменную в шаблоне — её видит только сборка или SSR.')
