// Перенос библиотеки в аккаунт и обратно.
//
// Формат файла у сервера и у клиента один и тот же — тот, что делает
// exportAll(). Это и есть путь миграции: у всех, кто играл до аккаунтов,
// библиотека лежит в localStorage, и аккаунт, в который её нельзя перенести,
// им не нужен.
//
// Импорт на сервере всегда добавляет и никогда не затирает: если id уже занят,
// новичка переименуют, а ссылки внутри файла перепишут. Поэтому загрузка
// возвращает карту id — локальный прогресс привязан к id уровней, и без
// перевода он после переезда указывал бы в пустоту.

import { api } from './api.js'
import { exportAll, importBundle, isDone, library, save } from './library.js'

/** Отправить локальную библиотеку в облако. Возвращает {stories, idMap, warnings}. */
export async function uploadLibrary() {
  const bundle = exportAll()
  const result = await api.post('/api/library/import', bundle)

  await pushProgress(result.idMap || {})

  return result
}

/**
 * Отметить на сервере уровни, пройденные локально.
 *
 * idMap нужен, потому что после импорта уровень мог поселиться под другим id.
 * Отправляем по одному: прогресс идемпотентен, а частично уехавший список
 * лучше, чем ничего.
 */
async function pushProgress(idMap) {
  const lib = library()

  for (const story of lib.stories) {
    const storyId = idMap[story.id] || story.id

    for (const chapterId of story.chapters) {
      const chapter = lib.chapters.find((c) => c.id === chapterId)

      for (const node of chapter?.nodes || []) {
        if (!isDone(node.levelId)) continue

        const levelId = idMap[node.levelId] || node.levelId

        try {
          await api.post('/api/progress/complete', { storyId, levelId })
        } catch {
          // Уровень мог не доехать (например, файл ссылался на отсутствующий) —
          // это уже отражено в warnings импорта, второй раз кричать не о чем.
        }
      }
    }
  }
}

/** Что лежит в облаке: краткие описания историй и склад ассетов. */
export const fetchShelf = () => api.get('/api/library')

/** Полная история со всеми главами и уровнями. */
export const fetchStory = (storyId) => api.get(`/api/stories/${storyId}`)

/** Пройденные уровни по мнению сервера. */
export const fetchProgress = () => api.get('/api/progress').then((r) => r.completed)

/**
 * Скачать историю из облака в локальную библиотеку.
 *
 * Через тот же importBundle, что и файл с диска: сервер отдаёт ровно тот
 * формат, и городить второй путь загрузки значило бы завести второй набор
 * ошибок.
 */
export async function downloadStory(storyId) {
  const bundle = await api.get(`/api/stories/${storyId}/export`)
  return importBundle(bundle)
}

export const downloadLibrary = async () => importBundle(await api.get('/api/library/export'))

/**
 * Подтянуть полку ассетов из аккаунта.
 *
 * Записи на полку уходят поштучно через очередь, а чтение нужно ровно одно —
 * при первом открытии редактора в чистом браузере, иначе палитра там будет
 * пуста при полной полке в аккаунте.
 *
 * Слияние по id, и серверная версия побеждает: очередь пишет туда сразу же,
 * значит расхождение означает, что здесь лежит устаревшая копия, а не чья-то
 * несохранённая правка.
 */
export async function pullAssets() {
  const { assets } = await api.get('/api/assets')
  const lib = library()
  const byId = new Map(lib.assets.map((a) => [a.id, a]))

  for (const a of assets) {
    byId.set(a.id, { id: a.id, title: a.title, entities: a.entities })
  }

  lib.assets = [...byId.values()]
  save()

  return lib.assets
}
