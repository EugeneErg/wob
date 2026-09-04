// Обложки и заставки: файл уезжает на сервер, обратно приходит ссылка.
//
// Раньше картинка вшивалась в библиотеку data-URL'ом. Для обложки это ещё
// терпимо, а для видео нет: заставка на пару мегабайт легла бы в ту же строку
// JSON, поехала бы целиком при каждой заливке библиотеки и попала бы в снапшот
// релиза. Поэтому байты хранятся отдельно, а библиотека несёт только ссылку.
import { api } from './api.js'
import { pickImage } from './fileio.js'

export async function uploadMedia(file) {
  const media = await api.upload('/api/media', file)
  return media.url
}

export const listMedia = () => api.get('/api/media').then((r) => r.media)

/**
 * Выбрать файл и получить ссылку, которую можно положить в обложку.
 *
 * Запасного пути «вшить data-URL, если нет аккаунта» здесь нет намеренно. Он
 * означал бы два вида значения в одном поле — ссылку и base64 — и картинку,
 * которая существует только в этом браузере, тогда как всё остальное, что
 * делает автор, живёт в аккаунте.
 */
export async function pickMedia({ kind = 'image' } = {}) {
  const file = await pickImage({
    raw: true,
    accept: kind === 'video' ? 'video/*' : 'image/*',
  }).catch(() => null)

  return file ? uploadMedia(file) : null
}
