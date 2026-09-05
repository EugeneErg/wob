// Полка автора приезжает с сервера и нигде не оседает.
//
// Черновики живут в аккаунте: правки уезжают туда по одной, а редактор при
// открытии перечитывает их целиком. Вторая копия в браузере — не запас, а
// способ разойтись с оригиналом молча, поэтому её быть не должно.
//
// Проверяется и переход со старого поведения: у всех, кто играл раньше, копии
// в localStorage уже лежат, и они не должны задвоиться с приехавшими.

import { check } from './assert.mjs'

const store = new Map()
globalThis.localStorage = {
  get length() { return store.size },
  key: (i) => [...store.keys()][i],
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { createServer } = await import('vite')
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const lib = await server.ssrLoadModule('/src/core/library.js')

// То, что осталось от прежних времён, когда библиотеку кешировали.
localStorage.setItem('goo.library.v1', JSON.stringify({
  stories: [{ id: 'story-1', title: 'Вчерашняя копия', chapters: ['ch-1'], hot: [] }],
  chapters: [{ id: 'ch-1', title: 'Старая глава', nodes: [], hot: [] }],
  levels: [],
  assets: [],
}))

const bundle = {
  format: 'goo-bundle',
  stories: [{ id: 'story-1', title: 'С сервера', cover: '#000', chapters: ['ch-1'], hot: [] }],
  chapters: [{
    id: 'ch-1',
    title: 'Глава с сервера',
    nodes: [
      { id: 'nd-1', levelId: 'lvl-1', x: 20, y: 50, next: ['nd-2'] },
      { id: 'nd-2', levelId: 'lvl-2', x: 60, y: 50, next: [] },
    ],
    hot: [],
  }],
  levels: [{ id: 'lvl-1', name: 'Раз', hot: [] }, { id: 'lvl-2', name: 'Два', hot: [] }],
  assets: [{ id: 'as-1', title: 'Штука', entities: [] }],
}

const shelf = { stories: [{ id: 'story-1', startNodeId: 'nd-1', intro: '', version: 7 }] }

lib.hydrateLibrary(bundle, shelf)

check('история одна, а не две', lib.stories().length === 1)
check('и это та, что с сервера', lib.stories()[0].title === 'С сервера')
check('главы прицеплены к своей истории', lib.chaptersOf('story-1').length === 1)
check('уровни на месте', lib.chaptersOf('story-1')[0].nodes.length === 2)

// Начала истории в файле выгрузки нет — оно приходит с полки.
check('начало истории взято с полки', lib.story('story-1').start === 'nd-1')

check('всё серверное помечено серверным', lib.isRemote('story-1') && lib.isRemote('ch-1'))

const kept = JSON.parse(localStorage.getItem('goo.library.v1'))
check('в localStorage историй не осталось', kept.stories.length === 0)
check('и глав тоже', kept.chapters.length === 0)
check('а полка мастерской сохраняется — она не про истории', kept.assets.length === 1)

// Второй заход не должен накапливать.
lib.hydrateLibrary(bundle, shelf)
check('повторная загрузка ничего не удваивает', lib.stories().length === 1)

// Выход из аккаунта уносит чужое.
lib.dropRemote()
check('после выхода серверных историй нет', lib.stories().length === 0)

console.log(`историй: ${lib.stories().length}, ассетов на полке: ${lib.assets().length}`)

await server.close()
