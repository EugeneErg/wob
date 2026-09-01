// Отправка прогресса на сервер.
//
// Проверяется ровно то, что осталось от синхронизации: без аккаунта клиент
// молчит, с аккаунтом — сообщает, и всегда говорит, к какому прохождению
// относится пройденный уровень.
//
// Прежний набор проверял слияние библиотек при входе. Его больше нет: играбельное
// содержимое приходит с сервера, а прогресс принадлежит прохождению, так что
// сливать стало нечего.

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}
globalThis.document = { cookie: '' }

const sent = []
globalThis.fetch = async (path, init = {}) => {
  sent.push({ path, body: init.body ? JSON.parse(init.body) : null })

  return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) }
}

const sync = await import('../src/core/sync.js')

// --- без аккаунта не отправляем ничего ---
await sync.reportProgress('story-1', 'lvl-1', null)
console.log(`не авторизован, запросов: ${sent.length} (должно быть 0)`)

// --- с аккаунтом отправляем, и вместе с прохождением ---
sync.setSignedIn(true)
await sync.reportProgress('story-1', 'lvl-1', 'slot-abc')

const post = sent.find((r) => r.path === '/api/progress/complete')
console.log(`авторизован, запрос ушёл: ${!!post}`)
console.log(`указано прохождение: ${post?.body.slotId} (должно быть slot-abc)`)
console.log(`указан уровень: ${post?.body.levelId}`)

// --- ошибка сервера не роняет игру ---
globalThis.fetch = async () => { throw new Error('сеть отвалилась') }
const result = await sync.reportProgress('story-1', 'lvl-2', 'slot-abc')
console.log(`сеть отвалилась, но игра продолжилась: ${result === null}`)

// --- после выхода снова молчим ---
sync.setSignedIn(false)
const before = sent.length
globalThis.fetch = async (path, init = {}) => { sent.push({ path, body: null }); return { ok: true, status: 200, text: async () => '{}' } }
await sync.reportProgress('story-1', 'lvl-3', null)
console.log(`после выхода новых запросов: ${sent.length - before} (должно быть 0)`)
