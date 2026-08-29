// Экраны должны рендериться.
//
// Всё остальное в этом хозяйстве проверяется без интерфейса: ядро, записи,
// перемотка, выпуски. Это удобно и быстро, но оставляет дыру ровно там, где
// её труднее всего заметить — в самих экранах. Опечатка в разметке, забытое
// объявление, обращение к тому, чего нет, — сборка на такое не ругается
// (Vite собирает разметку, не выполняя её), тесты ядра тоже, а игрок получает
// чёрный экран.
//
// Именно так и вышло: в списке глав я обратился к счётчику, которого в этом
// компоненте нет. Всё собиралось, все проверки проходили, а кнопка «Играть»
// вела в пустоту.
//
// Здесь экраны отрисовываются по-настоящему, в узле, через тот же Vite, что
// и в браузере. Проверяется не то, как выглядит, а что вообще отрисовалось и
// что Vue не ругался.

import { createServer } from 'vite'
import { check } from './assert.mjs'

// localStorage: библиотека и настройки живут в нём
const store = new Map()
globalThis.localStorage = {
  get length() { return store.size },
  key: (i) => [...store.keys()][i],
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

// Vue берём напрямую, а не через Vite: сам Vite грузит его как CommonJS и
// спотыкается. Компоненты же обязаны идти через Vite — иначе их .vue не
// превратится в код.
const { createSSRApp } = await import('vue')
const { renderToString } = await import('@vue/server-renderer')
const lib = await server.ssrLoadModule('/src/core/library.js')

lib.resetLibrary()
const story = lib.stories()[0]
const chapter = lib.chaptersOf(story.id)[0]
const level = lib.level(chapter.nodes[0].levelId)

// Что рисуем и с чем. Экраны берутся в обоих ладах, где это осмысленно:
// игровом и редакторском — разметка у них разная, и сломаться может любая.
const screens = [
  ['MainMenu', {}],
  ['StoryPicker', { mode: 'play' }],
  ['StoryPicker', { mode: 'edit' }],
  ['ChapterList', { mode: 'play', storyId: story.id }],
  ['ChapterList', { mode: 'edit', storyId: story.id }],
  ['ChapterMap', { mode: 'play', chapterId: chapter.id }],
  ['ChapterMap', { mode: 'edit', chapterId: chapter.id }],
  ['RunsView', { kind: 'level', targetId: level.id }],
  ['GameView', { level }],
  ['GameView', { level, speedrun: true }],
]

for (const [name, props] of screens) {
  const warns = []
  let ok = false
  let detail = ''
  try {
    const mod = await server.ssrLoadModule(`/src/views/${name}.vue`)
    const app = createSSRApp(mod.default, props)
    app.config.warnHandler = (msg) => warns.push(msg)
    const html = await renderToString(app)
    ok = html.length > 0 && warns.length === 0
    detail = warns.length ? warns[0].split('\n')[0].slice(0, 120) : `${html.length} символов`
  } catch (e) {
    detail = e.message.split('\n')[0].slice(0, 160)
  }
  const lad = props.mode ? ` (${props.mode === 'edit' ? 'редактор' : 'игра'})` : ''
  check(`${name}${lad} рисуется без ошибок`, ok, detail)
}

// Выбор режима стоит там же, где выбор того, что играть: на карточке истории,
// на карточке главы, в меню точки уровня. Отдельного экрана с вопросом нет —
// решение и вход стали одним действием.
const draw = async (path, props) => {
  const mod = await server.ssrLoadModule(path)
  const app = createSSRApp(mod.default, props)
  app.config.warnHandler = () => {}
  return renderToString(app)
}

{
  const html = await draw('/src/views/MainMenu.vue', {})
  check('в главном меню просто «Играть»', html.includes('Играть') && !html.includes('Спидран'))
}
{
  const html = await draw('/src/views/StoryPicker.vue', { mode: 'play' })
  check('у истории выбор: прохождение или спидран',
    html.includes('Прохождение') && html.includes('Спидран'))
}
{
  const html = await draw('/src/views/ChapterList.vue', { mode: 'play', storyId: story.id })
  check('у главы тоже выбор', html.includes('Прохождение') && html.includes('Спидран'))
}
{
  const html = await draw('/src/views/ChapterList.vue', { mode: 'play', storyId: story.id, speedrun: true })
  check('но внутри идущего спидрана главу не переспрашивают', !html.includes('>Спидран<'))
}

// --- тропы на карте видны и в спидране ---------------------------------------
// Тропа рисуется, когда пройден уровень, из которого она ведёт. Раньше это
// считалось по общему прогрессу, а в спидране он не пишется вовсе — и карта
// превращалась в набор несвязанных точек.
{
  const mod = await server.ssrLoadModule('/src/views/ChapterMap.vue')
  const seg = (t) => ({ ticks: t, finished: true, seed: 1, rate: 60, input: [], camera: [], checks: [] })
  const { ChainRun } = await server.ssrLoadModule('/src/core/chain.js')

  // попытка, в которой первый уровень главы уже пройден
  const run = new ChainRun({ kind: 'chapter', targetId: chapter.id })
  run.push(seg(300), { levelId: chapter.nodes[0].levelId, chapterId: chapter.id })

  const draw = async (props) => {
    const app = createSSRApp(mod.default, props)
    app.config.warnHandler = () => {}
    return renderToString(app)
  }
  const lines = (html) => (html.match(/<line/g) || []).length

  const inRun = await draw({ mode: 'play', chapterId: chapter.id, run, speedrun: true })
  check('в спидране тропа к следующему уровню видна', lines(inRun) > 0,
    `${lines(inRun)} троп при пройденном первом уровне`)

  const fresh = new ChainRun({ kind: 'chapter', targetId: chapter.id })
  const atStart = await draw({ mode: 'play', chapterId: chapter.id, run: fresh, speedrun: true })
  check('а пока ничего не пройдено — троп нет', lines(atStart) === 0)

  const edit = await draw({ mode: 'edit', chapterId: chapter.id })
  check('в редакторе видны все тропы сразу', lines(edit) > 0, `${lines(edit)}`)
}

// --- уровень не заканчивается сам --------------------------------------------
// Кнопка «Закончить» появляется, когда цель выполнена, и до неё игра идёт
// дальше: можно загнать больше шаров, чем требуется.
{
  const mod = await server.ssrLoadModule('/src/views/GameView.vue')
  const app = createSSRApp(mod.default, { level })
  app.config.warnHandler = () => {}
  const html = await renderToString(app)
  check('пока цель не выполнена, кнопки «Закончить» нет', !html.includes('Закончить'))
}

// --- полоса времени -----------------------------------------------------------
// Показывает три вещи: где мы, докуда развёрнуто и куда можно тянуть. Ширины
// считаются долями, поэтому их видно прямо в разметке.
{
  const html = await draw('/src/components/Timeline.vue', { value: 30, max: 120, buffered: 60 })
  check('бегунок стоит на своей доле', html.includes('left:25%') || html.includes('left: 25%'), 'ждём 25%')
  check('развёрнутая часть показана отдельно', html.includes('50%'), 'ждём 50%')

  const all = await draw('/src/components/Timeline.vue', { value: 10, max: 100, buffered: -1 })
  check('без ограничения развёрнутым считается всё', all.includes('100%'))

  const off = await draw('/src/components/Timeline.vue', { value: 10, max: 100, disabled: true })
  check('в спидране полоса только показывает', off.includes('off'))
}

await server.close()
