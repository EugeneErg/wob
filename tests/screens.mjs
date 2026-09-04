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

// Библиотека больше не засевает себя встроенным содержимым — оно приходит из
// каталога, а в сборке его нет. Экранам всё равно нужно что-то рисовать, так
// что засеваем явно, теми же данными, что раньше лежали в бандле.
const { seed } = await import('./seed.mjs')
seed(lib)
const story = lib.stories()[0]
const chapter = lib.chaptersOf(story.id)[0]
const level = lib.level(chapter.nodes[0].levelId)

// Что рисуем и с чем. Экраны берутся в обоих ладах, где это осмысленно:
// игровом и редакторском — разметка у них разная, и сломаться может любая.
const screens = [
  ['MainMenu', {}],
  ['SettingsView', {}],
  ['AwardsView', {}],
  ['StoryPicker', { mode: 'play' }],
  ['StoryPicker', { mode: 'edit' }],
  ['StoryCanvas', { storyId: story.id }],
  ['ChapterMap', { mode: 'play', chapterId: chapter.id }],
  ['ChapterMap', { mode: 'edit', chapterId: chapter.id }],
  ['RunsView', { kind: 'level', targetId: level.id }],
  ['RunsView', { kind: 'level', targetId: level.id, releaseId: 'rel-1' }],
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
  // The main menu is now built around what the player can do, so it names the
  // ways of playing outright. Speedrunning used to hide on a small button
  // inside a story card, where nobody who was not already looking for it ever
  // found it.
  const html = await draw('/src/views/MainMenu.vue', {})
  check('the menu offers all three ways in',
    html.includes('Play') && html.includes('Speedrun') && html.includes('Create'))

  // Continue is absent rather than disabled when there is nothing to continue:
  // an empty Continue button is a promise the game cannot keep yet.
  //
  // The class is checked rather than the word, because Vue leaves template
  // comments in the rendered markup and one of them explains this very button.
  check('nothing to continue on a first visit', !html.includes('resume-label'))

  // Signing in is a menu item like the others, in the same shape as the rest.
  // It briefly lived on the settings screen, which was the wrong place: it is
  // something people come here to do, unlike a frame cap.
  // Не по слову «Sign in»: надпись на кнопке рисует Google уже в браузере, а
  // проверка на текст однажды прошла на комментарии в шаблоне — Vue выводит их
  // в разметку. Ищем узел, в который кнопка встанет.
  check('signing in is offered on the menu itself', html.includes('class="gbtn"'))
  check('the sign-in control looks like the other cards', html.includes('card signin'))

  // Only the frame cap moved. It used to unfold under the menu, putting a
  // device preference in front of everyone every time they opened the game.
  check('settings is offered as a place to go', html.includes('Settings'))
  check('the frame cap is not on the front page', !html.includes('<select'))
}
{
  // The board and your own recordings answer different questions, so they are
  // two lists rather than one — and on a draft there is no board at all,
  // because times only compare within one published version.
  const draft = await draw('/src/views/RunsView.vue', { kind: 'level', targetId: level.id })
  check('runs screen offers both lists', draft.includes('Leaderboard') && draft.includes('My runs'))

  const released = await draw('/src/views/RunsView.vue', {
    kind: 'level', targetId: level.id, releaseId: 'rel-1',
  })
  check('a released version still offers the board', released.includes('Leaderboard'))
}
{
  // Rendered before the network answers, which is what a player sees first.
  // The tabs and the list arrive with the data; what must be there immediately
  // is a screen that explains itself rather than an empty rectangle.
  const html = await draw('/src/views/AwardsView.vue', {})
  check('achievements screen has a heading and a way back',
    html.includes('Achievements') && html.includes('Menu'))
  check('and says it is working rather than showing nothing', html.includes('Loading'))
}
{
  const html = await draw('/src/views/SettingsView.vue', {})
  check('settings holds the frame rate', html.includes('Frames per second'))
  check('settings does not own signing in', !html.includes('Account'))
}
{
  const html = await draw('/src/views/StoryPicker.vue', { mode: 'play' })
  check('a story offers both ways of playing',
    html.includes('Play') && html.includes('Speedrun'))
}
{
  // Arriving through Speedrun must not make the player hunt for it a second
  // time: the same two options, with the other one led with.
  const html = await draw('/src/views/StoryPicker.vue', { mode: 'play', intent: 'speedrun' })
  check('coming in through Speedrun leads with Speedrun',
    html.includes('sr primary') && html.includes('Play'))
}
{
  const html = await draw('/src/views/ChapterMap.vue', { mode: 'play', chapterId: chapter.id })
  check('a chapter offers the choice too',
    html.includes('Play through') && html.includes('Speedrun'))
}
{
  const html = await draw('/src/views/ChapterMap.vue', { mode: 'play', chapterId: chapter.id, speedrun: true })
  check('but inside a running speedrun the chapter is not asked again',
    !html.includes('>Speedrun<'))
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
