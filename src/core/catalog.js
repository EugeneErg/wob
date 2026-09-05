// Каталог: всё, во что можно играть.
//
// Игра больше не везёт содержимое в сборке. Раньше `library.json` лежал в
// бандле, и любые ограничения на «что доступно без аккаунта» были бы
// нарисованными: браузер уже держал все уровни и мог их прочитать. Теперь
// уровни приходят отсюда, и то, что не прислали, не существует на этой машине.
//
// Плата честная и её стоит назвать: без сети играть нельзя.

import { api } from './api.js'
import { hydrate, library } from './library.js'
import { forgetReleases, noteRelease } from './releases.js'

let shelf = null

/**
 * Что есть на витрине: канон и опубликованное, ждущее голосов.
 *
 * Анониму сервер вернёт одну историю и пометит ответ `preview` — не потому,
 * что клиент должен что-то спрятать, а потому что остального в ответе нет.
 */
export async function loadCatalog({ force = false } = {}) {
  if (shelf && !force) return shelf

  shelf = await api.get('/api/catalog')

  return shelf
}

export const cachedCatalog = () => shelf

/**
 * Забрать содержимое истории и положить в библиотеку.
 *
 * Дважды за сеанс не ходит: содержимое релиза заморожено, и перезапрашивать
 * его незачем — а вот лишний круг перед стартом уровня игрок заметит.
 */
export async function loadStory(storyId, { force = false } = {}) {
  const have = library().stories.find((s) => s.id === storyId)
  const complete = have && library().chapters.some((c) => c.storyId === storyId)

  if (complete && !force) return have

  const bundle = await api.get(`/api/catalog/${storyId}`)

  // Содержимое идёт в библиотеку, чтобы его рисовать, а сам релиз — в память
  // релизов, чтобы было с чем сверять повторы. Одно и то же тело, но вопросы к
  // нему разные: библиотека отвечает «что показать», релиз — «то ли это, что
  // играли».
  hydrate(bundle)
  noteRelease(bundle)

  return bundle
}

/** Сбросить витрину — после входа и выхода она другая. */
/*
 * Взять чужую историю себе.
 *
 * Форкнуть можно любую выпущенную версию, включая канон: копия принадлежит
 * взявшему, оригинал не трогается, а предложить правки обратно — отдельное
 * решение автора копии.
 *
 * Кнопки к этому не было, потому что и маршрута не было: контроллер форков на
 * сервере написан целиком, а дверей наружу у него не существовало.
 */
export const forkRelease = (releaseId) => api.post(`/api/releases/${releaseId}/fork`)

export function forgetCatalog() {
  shelf = null
  forgetReleases()
}
