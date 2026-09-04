// Хранилище попыток.
//
// Впереди сервер, поэтому интерфейс здесь асинхронный с самого начала, хотя
// сегодня всё лежит в localStorage. Это не «на будущее ради будущего»: если
// сейчас написать синхронно, то каждый вызов в интерфейсе придётся потом
// переписывать вместе с местом вызова, а так поменяется только адаптер.
//
// Что такое попытка: запись ввода плюс всё, что нужно, чтобы её повторить
// (seed, частота тиков, версия правил). Кадры не хранятся — они пересчитываются
// из ввода, поэтому минута игры весит килобайты, а не мегабайты.

const KEY = 'goo.runs.v1'

// Версия правил и отпечаток контента считаются в releases.js: там же, где
// живут релизы, чтобы «что играли» и «на чём играли» не разъезжались.
// Реэкспорт для тех, кто работает с записями: версия и отпечаток контента
// живут в releases.js, но нужны здесь же, рядом с сохранением попытки.
export { RULES_VERSION, checkRecord, stampOf, stampFor, seedFor } from './releases.js'
// Реэкспорт не вносит имена в этот модуль — то, чем пользуемся сами,
// импортируем отдельно.
import { checkRecord, stampFor } from './releases.js'

// Два времени, и путать их нельзя.
//
// Игровое (IGT) — сумма тиков внутри уровней. Только оно идёт в зачёт: тик
// всегда одной длины, поэтому у игрока на 30 кадрах и на 144 одно и то же
// прохождение даёт одно и то же число, до тысячной. На паузе тиков нет,
// на карте главы тиков нет — стоять и думать бесплатно.
//
// Реальное (RTA) — сколько прошло по часам от старта до финиша, вместе с
// картой, меню и паузами. В зачёт не идёт, но показывается: без него можно
// «отдыхать» между уровнями бесконечно, и сравнивать длинные прогоны честно
// не выйдет. Считать его надо часами устройства, а не тиками, — и именно
// поэтому ему нельзя доверять как результату.
export const TIMING = { IGT: 'igt', RTA: 'rta' }

// Вид попытки: обычное прохождение, спидран уровня, главы, истории
export const KIND = { LEVEL: 'level', CHAPTER: 'chapter', STORY: 'story' }
// Категория спидрана: любой процент или все ветки
export const CATEGORY = { ANY: 'any', FULL: '100' }

const uid = () => `run-${Date.now().toString(36)}-${Math.round(Math.random() * 1e6).toString(36)}`

// --- адаптер: сегодня localStorage, завтра HTTP ------------------------------
const localAdapter = {
  async all() {
    try { return JSON.parse(localStorage.getItem(KEY)) || [] } catch { return [] }
  },
  async put(list) {
    localStorage.setItem(KEY, JSON.stringify(list))
    return list
  },
}

let adapter = localAdapter
// Подменить хранилище одной строкой, когда появится бэкенд:
// setAdapter({ all: () => fetch('/api/runs').then(r => r.json()), put: ... })
export const setAdapter = (a) => { adapter = a }

// --- запись ------------------------------------------------------------------
// run — snapshot() из Run; scope описывает, что именно проходили.
export async function saveRun(snapshot, scope = {}) {
  const list = await adapter.all()
  const rec = {
    id: uid(),
    at: Date.now(),               // когда сыграно — для сортировки, не для симуляции
    // на чём играли: версия правил и отпечаток содержимого
    ...stampFor({
      kind: scope.kind || KIND.LEVEL,
      targetId: scope.targetId || snapshot.levelId,
      releaseId: scope.releaseId || null,
    }),
    // На какой версии играли. Не снимок уровня, а ссылка на него: hash уже
    // лежит выше (stampOf), releaseId говорит, какой выпуск играли. Снимок по
    // этой ссылке отдаёт хранилище содержимого — см. content.js.
    releaseId: scope.releaseId || null,
    // реальное время в миллисекундах — рядом с игровым, но не вместо него
    rta: scope.rta ?? null,
    kind: scope.kind || KIND.LEVEL,
    targetId: scope.targetId || snapshot.levelId,
    category: scope.category || CATEGORY.ANY,
    speedrun: !!scope.speedrun,
    // сегменты: у главы и истории попытка состоит из нескольких уровней подряд
    segments: scope.segments || null,
    ...snapshot,
  }
  // Признак «дошло до конца». У попытки уровня его считает сам Run — цель
  // достигнута или нет. У попытки главы такого поля нет: закончилась она или
  // брошена, решает категория, а её считают по графу снаружи. Без этого
  // пройденная глава не попадала в отбор лучших и рекорда как будто не было.
  if (rec.finished === undefined) rec.finished = !!scope.category
  list.push(rec)
  await adapter.put(list)
  return rec
}

export async function runsFor(targetId, { kind, category, speedrun } = {}) {
  const list = await adapter.all()
  return list
    .filter((r) => r.targetId === targetId)
    .filter((r) => (kind ? r.kind === kind : true))
    .filter((r) => (category ? r.category === category : true))
    .filter((r) => (speedrun === undefined ? true : !!r.speedrun === speedrun))
    .sort((a, b) => b.at - a.at)
}

// Лучшее время — только среди пройденных и только среди тех записей, которые
// сняты на том же контенте и на тех же правилах. Записи с других версий
// прекрасно смотрятся, но в одну таблицу с нынешними не идут: там был другой
// уровень или другая физика, и сравнивать их не с чем.
export async function bestRun(targetId, opts = {}) {
  const list = await runsFor(targetId, opts)
  return list
    .filter((r) => r.finished && checkRecord(r).ok)
    .sort((a, b) => a.ticks - b.ticks)[0] || null
}

export async function removeRun(id) {
  const list = await adapter.all()
  await adapter.put(list.filter((r) => r.id !== id))
}

export async function clearRuns() { await adapter.put([]) }



// Время попытки в тиках → человеку. Считается из тиков, а не из секундомера,
// поэтому у всех игроков одинаковое.
export function formatTime(ticks, rate = 60) {
  const total = ticks / rate
  const m = Math.floor(total / 60)
  const s = Math.floor(total % 60)
  const ms = Math.round((total % 1) * 1000)
  return `${m > 0 ? `${m}:` : ''}${m > 0 ? String(s).padStart(2, '0') : s}.${String(ms).padStart(3, '0')}`
}
