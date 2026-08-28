// Откуда берётся содержимое для повтора.
//
// Запись не таскает уровень с собой. Она ссылается на версию: хеш содержимого
// и, если играли релиз, его номер. Снимок по этой ссылке отдаёт хранилище —
// сегодня местное, завтра сервер.
//
// Так правильнее по трём причинам. Уровень в записи — это дубликат: тысяча
// попыток одного уровня хранила бы тысячу его копий. Ссылка ещё и проверяема:
// по хешу видно, что отдали именно то, что записывали, а вложенный снимок
// проверить не с чем — он сам себе источник. И наконец, снимок в записи
// нельзя починить: если в выпущенном уровне нашли беду, правится он в одном
// месте, а не в каждой записи, которая его унесла.
//
// Разрешение асинхронное с самого начала: за снимком придётся идти на сервер,
// и переписывать потом места вызова не хочется.

import { release, levelFrom, chapterFrom, levelHash, chapterHash, storyHash } from './releases.js'
import { level as libLevel, chapter as libChapter, story as libStory } from './library.js'

// Источник содержимого. Местный смотрит в релизы, а затем в текущую
// библиотеку. Серверный подменяется одной строкой:
// setContentSource({ get: ({ hash }) => fetch(`/api/content/${hash}`).then(r => r.json()) })
const localSource = {
  async get({ kind, targetId, releaseId, hash }) {
    // Играли выпущенную версию — берём её снимок, он заморожен и не меняется.
    if (releaseId) {
      const rel = release(releaseId)
      if (rel) {
        const found = kind === 'level' ? levelFrom(rel, targetId)
          : kind === 'chapter' ? chapterFrom(rel, targetId)
            : rel.story
        if (found) return found
      }
    }
    // Релиза нет — это черновик автора. Отдаём текущее содержимое, но только
    // если оно то же самое: иначе честнее вернуть ничего, чем чужой уровень.
    const cur = kind === 'level' ? libLevel(targetId)
      : kind === 'chapter' ? libChapter(targetId)
        : libStory(targetId)
    if (!cur) return null
    const h = kind === 'level' ? levelHash(cur) : kind === 'chapter' ? chapterHash(cur) : storyHash(cur)
    return !hash || h === hash ? cur : null
  },
}

let source = localSource
export const setContentSource = (s) => { source = s }

// Содержимое, при котором снята запись. null — версия не найдена: показывать
// повтор не на чем, и делать вид, что можно, нельзя.
export async function contentFor(rec) {
  if (!rec) return null
  return source.get({
    kind: rec.kind,
    targetId: rec.targetId,
    releaseId: rec.releaseId || null,
    hash: rec.hash || null,
  })
}
