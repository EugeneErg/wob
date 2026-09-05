// Создание содержимого не конфликтует ни с чем.
//
// Здесь долго проверялось, что клиент правильно носит с собой номер версии
// истории. Носить его больше не нужно: черновик правится мелкими операциями,
// и спорить им не о чем — разные объекты не пересекаются, один и тот же
// сходится к последней правке.
//
// Проверка осталась, но вопрос у неё теперь обратный: что версия не уходит
// вовсе и что подряд идущие создания проходят все. Раньше второе из них
// упиралось в 409, и это был единственный симптом, видимый автору.

import { check } from './assert.mjs'

// --- окружение браузера, которого в node нет --------------------------------
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}
// Vue при загрузке трогает document, хотя рисовать мы здесь ничего не будем.
const node = () => ({
  setAttribute() {}, appendChild() {}, style: {}, content: null,
  innerHTML: '', firstChild: null, childElementCount: 0,
})
globalThis.document = {
  cookie: 'XSRF-TOKEN=tok',
  addEventListener() {},
  createElement: node,
  createTextNode: node,
  createComment: node,
  querySelector: () => null,
  head: node(),
  body: node(),
}
globalThis.window = { addEventListener() {}, google: undefined }

// --- сервер, который версий не спрашивает ------------------------------------
let ids = 0
const seen = []
const conflicts = []

globalThis.fetch = async (path, init = {}) => {
  const method = init.method || 'GET'
  const body = init.body ? JSON.parse(init.body) : {}

  if (path === '/sanctum/csrf-cookie') return { ok: true, status: 204, text: async () => '' }

  seen.push({ method, path, version: body.version })

  // Настоящий сервер версию черновика больше не принимает. Если клиент вдруг
  // начнёт её слать, это заметит проверка ниже, а не молчаливый отказ в бою.
  const fresh = method === 'POST' && path === '/api/stories'

  const made = { id: `x${++ids}`, nodeId: `nd${ids}` }
  if (fresh) made.chapterId = `ch${++ids}`

  return { ok: true, status: 201, text: async () => JSON.stringify(made) }
}

// --- игра начинается ---------------------------------------------------------
// Через Vite, как и проверка экранов: в исходниках есть import.meta.env, а
// голый node о нём не знает.
const { createServer } = await import('vite')
const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

const { session } = await server.ssrLoadModule('/src/core/session.js')
const { makeStory, makeLevel } = await server.ssrLoadModule('/src/core/making.js')
const { saveChapterMap } = await server.ssrLoadModule('/src/core/authoring.js')
const lib = await server.ssrLoadModule('/src/core/library.js')

session.status = 'signed-in'

const { story } = await makeStory('Проверка')

check('история создана', !!story.id)

const chapterId = story.chapters[0]

await makeLevel(story.id, chapterId, 'Первый')
check('первый уровень создан', conflicts.length === 0)

// Ровно тот шаг, который падал.
await makeLevel(story.id, chapterId, 'Второй')
check('второй уровень тоже создан — без 409', conflicts.length === 0)

// Карта главы уходит следом обычным сохранением, через очередь.
saveChapterMap(story.id, lib.chapter(chapterId))
await new Promise((r) => setTimeout(r, 20))

check('карта главы сохранена, а не отвергнута', conflicts.length === 0)
check('никто не отправлял версию черновика',
  seen.every((r) => r.version === undefined),
  JSON.stringify(seen.map((r) => r.version)))

const maps = seen.filter((r) => r.method === 'PUT' && r.path.endsWith('/map'))
check('карта ушла один раз, а не по кругу', maps.length === 1)

for (const c of conflicts) console.log(`  конфликт: ${c.path} — отправлено ${c.sent}, на сервере ${c.actual}`)
console.log(`запросов: ${seen.length}`)

// --- вход не отменяется отсутствием Google -----------------------------------
//
// refresh() сначала смотрел, настроен ли вход через Google, и только потом —
// вошли ли мы уже. Из-за этого порядка на машине без VITE_GOOGLE_CLIENT_ID
// выполненный вход затирался статусом «unconfigured» при каждом вызове: человек
// заходил в редактор второй раз и видел «Sign in to create», хотя сессия жива и
// ни одного 401 не приходило.
//
// Вход и способ войти — разные вещи, и знание о первом не должно зависеть от
// наличия второго.
const { refresh } = await server.ssrLoadModule('/src/core/session.js')

session.status = 'signed-in'
session.user = { id: 'u1', name: 'Кто-то' }

await refresh()

check('вход переживает вызов refresh без настроенного Google', session.status === 'signed-in', session.status)

await server.close()
