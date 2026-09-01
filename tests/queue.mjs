// Очередь записи: то, что отвечает за несгораемость труда.
//
// Проверяется не «дошёл ли запрос», а три способа потерять работу, каждый из
// которых до появления очереди был реальным: обрыв сети, закрытая вкладка и
// правки, приехавшие не в том порядке.

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}
globalThis.document = { cookie: '', addEventListener() {}, hidden: false }
globalThis.window = { addEventListener() {} }

const sent = []
let failNext = 0
let conflictNext = 0

globalThis.fetch = async (path, init = {}) => {
  if (path === '/sanctum/csrf-cookie') return { ok: true, status: 204, text: async () => '' }

  if (conflictNext > 0) {
    conflictNext--

    return {
      ok: false,
      status: 409,
      text: async () => JSON.stringify({ error: { code: 'conflict', message: 'changed elsewhere' } }),
    }
  }

  if (failNext > 0) {
    failNext--
    throw new Error('сеть отвалилась')
  }

  sent.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : null })

  return { ok: true, status: 200, text: async () => JSON.stringify({ version: sent.length }) }
}

const { check } = await import('./assert.mjs')
const q = await import('../src/core/queue.js')

const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 20)) }

// --- обычный случай: правка доезжает ---
q.enqueue({ storyId: 'story-1', method: 'put', path: '/api/stories/story-1/levels/lvl-1', body: { name: 'A' } })
await settle()
check('правка ушла на сервер', sent.length === 1)
check('очередь опустела', q.queueState.pending === 0)

// --- версия истории запоминается и подставляется ---
//
// Без этого вторая правка ушла бы с нулевой версией и получила конфликт на
// ровном месте.
q.enqueue({ storyId: 'story-1', method: 'put', path: '/api/stories/story-1/levels/lvl-1', body: { name: 'B' } })
await settle()
check('версия подставлена из ответа', sent[1].body.version === 1)

// --- порядок сохраняется ---
//
// Создание уровня и его сохранение — две записи, и вторая без первой
// бессмысленна. Параллельные запросы пришли бы вразнобой.
sent.length = 0
q.enqueue({ storyId: 'story-1', method: 'post', path: '/api/stories/story-1/levels', body: { id: 'lvl-2' } })
q.enqueue({ storyId: 'story-1', method: 'put', path: '/api/stories/story-1/levels/lvl-2', body: { name: 'C' } })
await settle()
check('записи ушли по порядку', sent[0].path.endsWith('/levels') && sent[1].path.endsWith('/lvl-2'))

// --- обрыв сети ничего не теряет ---
sent.length = 0
failNext = 1
q.enqueue({ storyId: 'story-1', method: 'put', path: '/api/stories/story-1/levels/lvl-3', body: { name: 'D' } })
await new Promise((r) => setTimeout(r, 100))
check('при обрыве правка осталась в очереди', q.queueState.pending === 1)
check('и об этом сказано вслух', q.queueState.status === 'offline')

await new Promise((r) => setTimeout(r, 3500))
check('после восстановления сети правка доехала', sent.some((s) => s.path.endsWith('/lvl-3')))
check('и статус вернулся к норме', q.queueState.status === 'ok')

// --- очередь переживает перезагрузку ---
//
// Хранится в localStorage: вкладка, закрытая на середине отправки, не уносит с
// собой то, что автор уже сделал.
const raw = store.get('goo.queue.v1')
check('очередь лежит в хранилище', typeof raw === 'string')

// --- конфликт останавливает очередь, а не продолжает вслепую ---
//
// Каждая следующая запись получила бы тот же отказ, а автор рисковал бы
// затереть чужую работу, не зная об этом.
sent.length = 0
conflictNext = 1
q.enqueue({ storyId: 'story-2', method: 'put', path: '/api/stories/story-2/levels/lvl-9', body: { name: 'E' } })
q.enqueue({ storyId: 'story-2', method: 'put', path: '/api/stories/story-2/levels/lvl-9', body: { name: 'F' } })
await settle()
check('конфликт остановил очередь', q.queueState.status === 'conflict')
check('и правки не потеряны', q.queueState.pending === 2)
check('вторая запись не ушла вслепую', sent.length === 0)
