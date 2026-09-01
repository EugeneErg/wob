// Рекорды и оценки.
//
// И то и другое привязано к релизу, а не к истории: время сравнимо только
// внутри одной замороженной версии, иначе таблица ранжирует людей по разным
// головоломкам. По той же причине оценка ставится уровню конкретного релиза —
// «понравилось» относится к тому, во что человек играл, а не к тому, во что
// автор успел переписать уровень с тех пор.

import { api } from './api.js'

export const SCOPE = { LEVEL: 'level', CHAPTER: 'chapter', STORY: 'story' }
export const CATEGORY = { ANY: 'any', HUNDRED: 'hundred' }

/**
 * Таблица лидеров.
 *
 * Возвращает и доску, и личный результат отдельно: тот, кто не попал в первые
 * пятьдесят, всё равно должен видеть, где он стоит — иначе таблица говорит ему
 * только «тебя здесь нет».
 */
export function leaderboard(releaseId, { scope, target = null, category = CATEGORY.ANY }) {
  const query = new URLSearchParams({ scope, category })

  if (target) query.set('target', target)

  return api.get(`/api/releases/${releaseId}/records?${query}`)
}

/**
 * Отправить прогон.
 *
 * Уходит запись ввода и сид, а не только время. Это и делает время проверяемым:
 * тот же ввод через ту же физику даёт тот же исход, поэтому сервер сможет
 * пересчитать результат вместо того, чтобы поверить в него.
 */
export function submitRun(releaseId, run) {
  return api.post(`/api/releases/${releaseId}/records`, {
    scope: run.scope,
    target: run.target ?? null,
    category: run.category,
    ticks: run.ticks,
    seed: run.seed,
    rulesVersion: String(run.rulesVersion),
    input: run.input || [],
  })
}

/** Оценить уровень — от того, кто его прошёл. */
export const rateLevel = (releaseId, levelId, rating) =>
  api.post(`/api/releases/${releaseId}/levels/${levelId}/vote`, { rating })

/** Как релиз идёт к канону и чего ему не хватает. */
export const standingOf = (releaseId) => api.get(`/api/releases/${releaseId}/standing`)
