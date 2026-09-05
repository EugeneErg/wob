// Точки таскаются мышью.
//
// Проверок этого не было ни одной: SSR-проверка рисует экран и ничего не
// нажимает, поэтому всё, что случается от руки, — перетаскивание, связи,
// выбор — жило без присмотра. Здесь настоящий DOM и настоящие события
// указателя.

import { check } from './assert.mjs'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' })
for (const k of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node', 'getComputedStyle']) {
  Object.defineProperty(globalThis, k, {
    value: k === 'window' ? dom.window : dom.window[k],
    configurable: true,
    writable: true,
  })
}
globalThis.localStorage = dom.window.localStorage

// jsdom не знает событий указателя и не считает размеры — нарисованного окна
// нет. Подставляем ровно столько, сколько нужно, чтобы проценты считались.
dom.window.PointerEvent = dom.window.MouseEvent
dom.window.Element.prototype.setPointerCapture = () => {}
dom.window.Element.prototype.releasePointerCapture = () => {}
dom.window.Element.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, width: 1000, height: 1000, right: 1000, bottom: 1000, x: 0, y: 0 }
}

/*
 * Компонент берётся из сборки, а не из ssrLoadModule.
 *
 * Тот собирает .vue в серверном режиме: разметка получается, а обработчики
 * событий — нет, потому что на сервере нажимать некому. Именно поэтому всё, что
 * делается руками, до сих пор и не проверялось ничем.
 *
 * Сборка в один файл заодно кладёт в него Vue, так что компонент и тест живут в
 * одном экземпляре реактивности — иначе изменения не были бы видны.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'wob-ui-'))
const entry = join(dir, 'entry.js')
writeFileSync(entry, `
  export { default as ChapterMap } from '${process.cwd()}/src/views/ChapterMap.vue'
  export { default as StoryCanvas } from '${process.cwd()}/src/views/StoryCanvas.vue'
  export * as lib from '${process.cwd()}/src/core/library.js'
  export * as vue from 'vue'
`)

const { build } = await import('vite')
await build({
  logLevel: 'error',
  build: {
    lib: { entry, formats: ['es'], fileName: 'ui' },
    outDir: dir,
    emptyOutDir: false,
    minify: false,
  },
})

const { ChapterMap, StoryCanvas, lib, vue } = await import(join(dir, 'ui.js'))

// Монтируем сами: @vue/test-utils тянет свой экземпляр Vue, а нам нужен тот,
// что внутри собранного компонента, иначе реактивность будет разной.
function mount(component, props) {
  const host = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(host)
  const app = vue.createApp(component, props)
  app.mount(host)

  return host
}

// Простая история: одна глава, две точки.
lib.hydrateLibrary({
  format: 'goo-bundle',
  stories: [{ id: 'st', title: 'S', cover: '#000', chapters: ['ch'], hot: [] }],
  chapters: [{
    id: 'ch',
    title: 'Глава',
    image: '#123',
    nodes: [
      { id: 'n1', levelId: 'l1', x: 20, y: 20, next: [] },
      { id: 'n2', levelId: 'l2', x: 80, y: 80, next: [] },
    ],
    hot: [],
  }],
  levels: [{ id: 'l1', name: 'Раз', hot: [] }, { id: 'l2', name: 'Два', hot: [] }],
  assets: [],
})

const host = mount(ChapterMap, { mode: 'edit', chapterId: 'ch', storyId: 'st' })
await vue.nextTick()

const points = [...host.querySelectorAll('button.node')]
check('обе точки нарисованы', points.length === 2, `нашлось ${points.length}`)

const map = host.querySelector('.map')

const fire = (el, type, at) => el.dispatchEvent(new dom.window.MouseEvent(type, {
  bubbles: true, cancelable: true, clientX: at.x, clientY: at.y,
}))
const node = lib.chapter('ch').nodes.find((n) => n.id === 'n1')
const before = { x: node.x, y: node.y }

// Тащим первую точку в середину карты.
fire(points[0], 'pointerdown', { x: 200, y: 200 })
fire(map, 'pointermove', { x: 500, y: 400 })
fire(map, 'pointermove', { x: 500, y: 400 })
fire(map, 'pointermove', { x: 500, y: 400 })
fire(map, 'pointerup', { x: 500, y: 400 })
await vue.nextTick()

const after = lib.chapter('ch').nodes.find((n) => n.id === 'n1')
check('точка переехала в данных', after.x !== before.x || after.y !== before.y,
  `было ${before.x},${before.y} — стало ${after.x},${after.y}`)
check('и переехала именно туда, куда тащили', Math.round(after.x) === 50 && Math.round(after.y) === 40,
  `${after.x},${after.y}`)

const style = host.querySelectorAll('button.node')[0].getAttribute('style') || ''
check('и на экране сдвинулась тоже', style.includes('50%'), style)



// --- доска истории -----------------------------------------------------------
//
// Здесь точки не таскают по отдельности: они показывают, что лежит внутри
// главы, а двигают саму главу. Нажатие на точку обязано доставать до области
// под ней — иначе кусок главы становится мёртвой зоной, за которую её не
// сдвинуть, и выглядит это ровно как «не перетаскивается».

const board = mount(StoryCanvas, { storyId: 'st' })
await vue.nextTick()

const area = board.querySelector('.area')
check('глава нарисована на доске', !!area)

const pts = [...board.querySelectorAll('.pt')]
check('точки главы видны на доске', pts.length === 2, `нашлось ${pts.length}`)

// Смотрим на то, что видит человек: где область стоит на экране.
const where = () => board.querySelector('.area').getAttribute('style')
const chapterBefore = where()

// Тащим главу за пустое место — так, как это делали всегда.
fire(area, 'pointerdown', { x: 100, y: 100 })
fire(board.querySelector('.board'), 'pointermove', { x: 300, y: 250 })
fire(board.querySelector('.board'), 'pointermove', { x: 300, y: 250 })
fire(board.querySelector('.board'), 'pointerup', { x: 300, y: 250 })
await vue.nextTick()

const byBody = where()
check('за пустое место глава тащится', byBody !== chapterBefore, `${chapterBefore} → ${byBody}`)

// За точку глава НЕ тащится — за точку тащится сама точка.
//
// Здесь стояла обратная проверка. Она закрепляла мою ошибку в трактовке: на
// «точки не перетаскиваются» я решил, что речь о главе, снял у точки перехват
// нажатия — и получил ровно то, чего просить никто не мог: нажатие на точку
// двигало главу, а точка стояла. Проверка ниже, в самом конце файла, ловит
// правильное поведение с обоих концов.

// --- связи точек -------------------------------------------------------------
//
// Шифт по второй точке соединяет, повтор — разъединяет. Проверок этого не было:
// SSR-рендер ничего не нажимает, поэтому связи жили без присмотра.

const cm = mount(ChapterMap, { mode: 'edit', chapterId: 'ch', storyId: 'st' })
await vue.nextTick()

const nn = [...cm.querySelectorAll('button.node')]
const shift = (el, at) => el.dispatchEvent(new dom.window.MouseEvent('pointerdown', {
  bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, shiftKey: true,
}))
const cmMap = cm.querySelector('.map')
const linkTo = async (i, at) => {
  shift(nn[i], at)
  fire(cmMap, 'pointerup', at)
  await vue.nextTick()
}

// Выбрали первую.
fire(nn[0], 'pointerdown', { x: 200, y: 200 })
fire(cmMap, 'pointerup', { x: 200, y: 200 })
await vue.nextTick()

check('выбранная точка объявлена словами', !!cm.querySelector('.linking'),
  'подсказки нет — автору неоткуда узнать про shift')

const link = () => (lib.chapter('ch').nodes.find((n) => n.id === 'n1').next || [])

await linkTo(1, { x: 800, y: 800 })
check('shift по второй точке соединил', link().includes('n2'), JSON.stringify(link()))

// Повторяем тот же жест.
fire(nn[0], 'pointerdown', { x: 500, y: 400 })
fire(cmMap, 'pointerup', { x: 500, y: 400 })
await vue.nextTick()
await linkTo(1, { x: 800, y: 800 })
check('повторный shift разъединил', !link().includes('n2'), JSON.stringify(link()))

// --- бросок уровня на доску --------------------------------------------------
//
// Уровень из панели слева перетаскивается на область главы. Это обычный
// HTML5-перенос, и проверок у него не было ни одной.

const shelf = mount(StoryCanvas, { storyId: 'st' })
await vue.nextTick()

// Именно плитки уровней: первая перетаскиваемая плитка на экране — «новая
// глава», и схватить её вместо уровня значит проверить не то.
const tiles = [...shelf.querySelectorAll('.tiles .tile')]
check('уровни видны в панели', tiles.length > 0, `нашлось ${tiles.length}`)

/*
 * Перенос указателем, а не HTML5 drag-and-drop.
 *
 * Родной браузерный перенос здесь не начинался вовсе, и проверить это было
 * нечем: jsdom его не реализует, а прежний тест слал dragstart руками и потому
 * обходил ровно тот вопрос, который надо было задать. Плитка теперь тащится
 * указателем — как точки, области и уголок ресайза, — и это проверяется.
 */
// Вид берётся из самой доски, а не зашивается числами: при открытии она
// подгоняет масштаб под содержимое, и зашитые значения устаревают молча — на
// этом проверка и споткнулась, когда подгонку добавили.
const worldNow = () => {
  const t = shelf.querySelector('.world')?.getAttribute('style') || ''
  const m = t.match(/translate\(([-\d.]+)px[,\s]+([-\d.]+)px\)[\s]*scale\(([-\d.]+)\)/)

  return m
    ? { x: parseFloat(m[1]), y: parseFloat(m[2]), zoom: parseFloat(m[3]) }
    : { x: 0, y: 0, zoom: 1 }
}
const onScreen = (bx, by) => {
  const w = worldNow()

  return { x: bx * w.zoom + w.x, y: by * w.zoom + w.y }
}

const at = lib.chapter('ch').canvas || { x: 0, y: 0, w: 420, h: 300 }

// Плитка ищется заново на каждый перенос: доска подгоняет масштаб при
// открытии, панель после этого перерисовывается, и ссылка, взятая раньше,
// указывает на узел, которого в документе уже нет.
const carry = async (which, to) => {
  const tile = shelf.querySelectorAll('.tiles .tile')[which]
  if (!tile) throw new Error('плитки уровня нет')

  fire(tile, 'pointerdown', { x: 0, y: 0 })
  fire(dom.window, 'pointermove', { x: to.x, y: to.y })
  await vue.nextTick()
  const held = !!shelf.querySelector('.ghost')
  fire(dom.window, 'pointerup', to)
  await vue.nextTick()

  return held
}

// Роняем на область главы.
/*
 * Бросок плитки на доску проверяется браузером, а не здесь.
 *
 * Проверка жила тут и сломалась, как только доска стала подгонять масштаб при
 * открытии: она зависела от чисел, которых в jsdom нет по-настоящему — рамки
 * элементов я подставляю сам, раскладку он не считает. Чинить её значит
 * подгонять подделку под подделку.
 *
 * Тот же бросок проходит настоящим Chromium в tools/browser-flow.mjs: «бросок
 * уровня в главу: форма открылась». Там рамки настоящие, и доказывает он то,
 * что здесь только изображалось.
 *
 * Начало переноса и его видимость остаются здесь: они не зависят от раскладки.
 */
const held = await carry(0, onScreen(at.x + 50, at.y + 50))
check('перенос плитки начинается и виден', held, 'призрака нет — рука пустая')

// --- точка на доске истории --------------------------------------------------
//
// Точка внутри главы — самостоятельная вещь, и берут её за неё. Сначала у неё
// стоял перехват нажатия, и глава не тащилась за то место, где точка; я убрал
// перехват — и стало наоборот: нажатие на точку тащило главу, а точка стояла.
// Верно ни то ни другое, поэтому проверяются оба конца сразу.

const pt = shelf.querySelectorAll('.pt')[0]
const areaWas = shelf.querySelector('.area').getAttribute('style')
const nodeWas = { x: lib.chapter('ch').nodes[0].x, y: lib.chapter('ch').nodes[0].y }

fire(pt, 'pointerdown', onScreen(at.x + 20, at.y + 20))
fire(dom.window, 'pointermove', onScreen(at.x + 200, at.y + 150))
fire(dom.window, 'pointermove', onScreen(at.x + 200, at.y + 150))
fire(dom.window, 'pointerup', onScreen(at.x + 200, at.y + 150))
await vue.nextTick()

const nodeNow = { x: lib.chapter('ch').nodes[0].x, y: lib.chapter('ch').nodes[0].y }

check('точка на доске переехала', nodeNow.x !== nodeWas.x || nodeNow.y !== nodeWas.y,
  `было ${nodeWas.x},${nodeWas.y} — стало ${nodeNow.x},${nodeNow.y}`)
check('и глава при этом осталась на месте',
  shelf.querySelector('.area').getAttribute('style') === areaWas,
  'глава уехала вместе с точкой — нажатие ушло области')

// Провод от узла «Story» теперь рисуется поверх глав, а не под ними — раньше
// области закрывали его, и связь до точки внутри главы просто пропадала.
//
// Проверки на это здесь нет намеренно. Порядок наложения слоёв jsdom не
// считает: он не раскладывает страницу, и любая проверка тут прошла бы и до
// исправления — я это попробовал. Зелёная галочка, которая ничего не доказывает,
// хуже её отсутствия, потому что создаёт ложную уверенность.

// --- связывание двух точек на доске -------------------------------------------
//
// Тот же жест, что на карте главы: выбрать точку, нажать на вторую с shift.
// Способа сделать это на доске не было вовсе — точка выбиралась, но соединить
// её можно было только с узлом «Story».

const both = [...shelf.querySelectorAll('.pt')]
check('на доске видны обе точки', both.length === 2, `нашлось ${both.length}`)

const shiftDown = (el) => {
  const e = new dom.window.MouseEvent('pointerdown', {
    bubbles: true, cancelable: true, clientX: 0, clientY: 0, shiftKey: true,
  })
  el.dispatchEvent(e)
}

const linkOf = () => (lib.chapter('ch').nodes.find((n) => n.id === 'n1').next || [])

// Выбираем первую: короткое нажатие без сдвига.
fire(both[0], 'pointerdown', { x: 0, y: 0 })
fire(dom.window, 'pointerup', { x: 0, y: 0 })
await vue.nextTick()

shiftDown(both[1])
await vue.nextTick()
check('shift по второй точке связал их на доске', linkOf().includes('n2'),
  JSON.stringify(linkOf()))

// Повтор снимает связь.
fire(both[0], 'pointerdown', { x: 0, y: 0 })
fire(dom.window, 'pointerup', { x: 0, y: 0 })
await vue.nextTick()
shiftDown(both[1])
await vue.nextTick()
check('повторный жест разъединил', !linkOf().includes('n2'), JSON.stringify(linkOf()))

// --- точка попадает туда, куда её положили ------------------------------------
//
// Точки расставлены в процентах от тела главы, а оно начинается под шапкой с
// названием. Провод к точке и её перетаскивание считали проценты от всей
// области вместе с шапкой и потому промахивались ровно на её высоту: внизу
// главы ошибка обращалась в ноль, наверху была наибольшей. Выглядело это так,
// будто связь уезжает вверх только у верхних точек.

const HEAD = 34
const chapterBox = lib.chapter('ch').canvas

// Тащим точку в самый верх тела главы и проверяем, что там она и оказалась.
const top = shelf.querySelectorAll('.pt')[0]
fire(top, 'pointerdown', onScreen(chapterBox.x + 20, chapterBox.y + 100))
fire(dom.window, 'pointermove', onScreen(chapterBox.x + 50, chapterBox.y + HEAD))
fire(dom.window, 'pointermove', onScreen(chapterBox.x + 50, chapterBox.y + HEAD))
fire(dom.window, 'pointerup', onScreen(chapterBox.x + 50, chapterBox.y + HEAD))
await vue.nextTick()

const placed = lib.chapter('ch').nodes[0]

// Верх тела — это 0% по вертикали (с поправкой на зажим в 4%), а не «минус
// высота шапки в процентах», как получалось раньше.
check('точка у верхнего края тела главы держится у нуля', placed.y <= 6,
  `y = ${placed.y} — считается вместе с шапкой`)

// --- связь тянут от ручки, без модификатора -----------------------------------
//
// Shift-клик работал, но найти его было нельзя: кружок в десять пикселей и
// модификатор, о котором сказано мелким текстом внизу экрана. Теперь у выбранной
// точки появляется ручка, и от неё тянут к другой точке — жест видно, пока его
// делаешь.

// Выбираем первую точку коротким нажатием.
fire(both[0], 'pointerdown', { x: 0, y: 0 })
fire(dom.window, 'pointerup', { x: 0, y: 0 })
await vue.nextTick()

// Стрелка есть у каждой точки: чтобы связать две, не нужно сперва догадаться,
// что точку надо выбрать.
const handle = shelf.querySelector('.pt-wrap .arrow')
check('у точки есть стрелка связи', !!handle, 'стрелки нет — жест снова невидим')

// Тянем от ручки ко второй точке. Куда отпустили — определяется по элементу
// под курсором, поэтому подменяем поиск на нужную точку.
dom.window.document.elementFromPoint = () => both[1]

fire(handle, 'pointerdown', { x: 10, y: 10 })
fire(dom.window, 'pointermove', { x: 200, y: 200 })
await vue.nextTick()
check('пока тянут, линия видна', !!shelf.querySelector('.ghostwire'),
  'линии нет — жест невидим на полпути')

fire(dom.window, 'pointerup', { x: 200, y: 200 })
await vue.nextTick()

check('связь появилась без всякого shift', linkOf().includes('n2'), JSON.stringify(linkOf()))

// --- связь видно на экране ----------------------------------------------------
//
// Вот чего не хватало всё это время. Связь ложилась в данные, а доска чертила
// только связи между главами и внутри одной главы не рисовала ничего. Автор
// тянул, отпускал — и на экране не менялось ровно ничего. Похоже на поломку
// сильнее, чем сама поломка, и мои проверки этого не видели, потому что
// смотрели в данные, а не на экран.

check('связь между точками нарисована', shelf.querySelectorAll('.wires path').length > 0,
  'на доске нет ни одной линии, хотя связь есть в данных')

const drawn = [...shelf.querySelectorAll('.wires path')].find((p) => p.getAttribute('marker-end'))
check('у связи есть стрелка — видно, кто на кого указывает', !!drawn,
  'линия без стрелки: направление не читается')

// Снимаем связь — линия должна исчезнуть.
const wiresBefore = shelf.querySelectorAll('.wires path').length
dom.window.document.elementFromPoint = () => both[1]
fire(shelf.querySelector('.pt-wrap .arrow'), 'pointerdown', { x: 10, y: 10 })
fire(dom.window, 'pointermove', { x: 200, y: 200 })
fire(dom.window, 'pointerup', { x: 200, y: 200 })
await vue.nextTick()

check('снятая связь исчезает с экрана',
  shelf.querySelectorAll('.wires path').length < wiresBefore,
  'линия осталась после разрыва связи')

// --- петлю сделать нельзя ------------------------------------------------------
//
// Проверка колец есть в library.js и проверена отдельно, но это ничего не
// значит, пока не доказано, что путь из интерфейса до неё доходит.

lib.chapter('ch').nodes[0].next = ['n2']
lib.chapter('ch').nodes[1].next = []

const cm2 = mount(ChapterMap, { mode: 'edit', chapterId: 'ch', storyId: 'st' })
await vue.nextTick()

const nodes2 = [...cm2.querySelectorAll('button.node')]

// Выбираем вторую точку и тянем связь обратно в первую — это кольцо.
fire(nodes2[1], 'pointerdown', { x: 800, y: 800 })
fire(cm2.querySelector('.map'), 'pointerup', { x: 800, y: 800 })
await vue.nextTick()

dom.window.document.elementFromPoint = () => nodes2[0]
const grip = cm2.querySelector('.handle')
check('на карте главы есть ручка связи', !!grip, 'ручки нет')

fire(grip, 'pointerdown', { x: 800, y: 800 })
fire(dom.window, 'pointermove', { x: 100, y: 100 })
fire(dom.window, 'pointerup', { x: 100, y: 100 })
await vue.nextTick()

const back = lib.chapter('ch').nodes[1].next || []
check('кольцо не создалось', !back.includes('n1'), `n2 -> ${JSON.stringify(back)}`)
check('и отказ объяснён словами', !!cm2.querySelector('.bad'), 'молча ничего не произошло')

// --- удаление связи и точки ----------------------------------------------------
//
// Ни того, ни другого на доске не было. Связь снималась только повтором жеста,
// а точку убрать было нечем: меню жило на карте главы, а на доске точка
// выбиралась и дальше с ней не происходило ничего.

lib.chapter('ch').nodes[0].next = ['n2']

const cut = mount(StoryCanvas, { storyId: 'st' })
await vue.nextTick()

const strip = [...cut.querySelectorAll('.wires .hit.cut')]
check('у связи есть полоса, за которую её берут', strip.length > 0,
  'нажать не на что: линия в четыре пикселя')

strip[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await vue.nextTick()
check('клик по связи её снял',
  !(lib.chapter('ch').nodes[0].next || []).includes('n2'),
  JSON.stringify(lib.chapter('ch').nodes[0].next))

// Точка: выбрать и убрать с карты.
const dots = [...cut.querySelectorAll('.pt')]
fire(dots[0], 'pointerdown', { x: 0, y: 0 })
fire(dom.window, 'pointerup', { x: 0, y: 0 })
await vue.nextTick()

const menu = cut.querySelector('.ptmenu')
check('у выбранной точки есть что нажать', !!menu, 'меню точки нет')

const was = lib.chapter('ch').nodes.length
menu.querySelector('button').click()
await vue.nextTick()

check('точка убрана с карты', lib.chapter('ch').nodes.length === was - 1,
  `было ${was}, стало ${lib.chapter('ch').nodes.length}`)
