// Прохождение главы и истории целиком.
//
// Попытка главы — это не один мир, а цепочка. Каждый заход на уровень
// (в том числе повторный, после неудачи) — отдельный сегмент со своей записью
// ввода. Так устроено не для удобства хранения, а потому что мир между
// уровнями создаётся заново: продолжать один лог через границу уровня нечем.
//
// Время. В зачёт идёт сумма тиков сегментов — и только она. Карта главы тиков
// не производит вовсе, поэтому выбор следующего уровня, чтение развилки и
// раздумья бесплатны; в реальное время (RTA) они попадают, в игровое — нет.
// Переигранный уровень своих тиков не теряет: сегмент остаётся в цепочке,
// и сумма растёт. Отдельного штрафа не нужно — неудачная попытка сама себе
// штраф ровно на столько, сколько заняла.
//
// Маршрут. Игрок всегда выбирает уровень сам, поэтому маршрут — часть попытки,
// а не следствие ввода: он записан порядком сегментов. Повтор идёт по тому же
// порядку, и на развилке видно, какую ветку взяли и почему.

import { KIND, CATEGORY } from './replays.js'

export class ChainRun {
  // kind — глава или история; targetId — что именно проходим.
  constructor({ kind = KIND.CHAPTER, targetId, releaseId = null } = {}) {
    this.kind = kind
    this.targetId = targetId
    this.releaseId = releaseId
    this.segments = []
    this.startedAt = Date.now()   // только для RTA, в зачёт не идёт
  }

  // Сегмент кладётся сюда, когда заход на уровень закончился — неважно, чем.
  // Брошенный сегмент тоже хранится: он занял время, и в сумме он есть.
  // hash — отпечаток уровня, на котором сыгран этот заход. Он нужен каждому
  // сегменту отдельно: попытка главы ссылается на версию главы, но проигрывают
  // её по уровням, и уровень мог измениться сам по себе. Без отпечатка на
  // сегменте повтор молча пошёл бы по нынешнему уровню.
  push(snapshot, { levelId, chapterId = null, hash = null } = {}) {
    this.segments.push({
      levelId: levelId || snapshot.levelId,
      chapterId,
      hash,
      ticks: snapshot.ticks,
      finished: snapshot.finished,
      seed: snapshot.seed,
      rate: snapshot.rate,
      input: snapshot.input,
      camera: snapshot.camera,
      checks: snapshot.checks,
    })
    return this
  }

  // Игровое время: сумма тиков всех сегментов, включая проваленные. Между
  // сегментами времени нет — карта не тикает.
  get ticks() { return this.segments.reduce((s, g) => s + g.ticks, 0) }

  // Реальное время, миллисекунды. Идёт рядом с игровым, но результатом не
  // считается: его нельзя перепроверить повтором.
  get rta() { return Date.now() - this.startedAt }

  // Какие уровни пройдены. Уровень считается пройденным, если хоть один заход
  // на него закончился целью: переигрывать после успеха не запрещено.
  get done() {
    const s = new Set()
    for (const g of this.segments) if (g.finished) s.add(g.levelId)
    return s
  }

  // Сколько раз заходили на уровень — видно, где прогон разваливался
  attempts(levelId) { return this.segments.filter((g) => g.levelId === levelId).length }

  snapshot() {
    return {
      kind: this.kind,
      targetId: this.targetId,
      releaseId: this.releaseId,
      ticks: this.ticks,
      rta: this.rta,
      segments: this.segments,
    }
  }
}

// Заход цепочки как самостоятельная запись уровня. Попытку главы играют
// уровень за уровнем, и каждому нужен свой мир — а миру нужна обычная запись:
// сид, ввод, камера, отметки. Отпечаток версии берётся с сегмента, а не с
// главы: уровень мог измениться сам по себе, и без этого повтор молча пошёл
// бы по нынешнему.
export function segmentRecord(rec, i) {
  const g = rec.segments?.[i]
  if (!g) return null
  return {
    kind: 'level',
    targetId: g.levelId,
    hash: g.hash || null,
    releaseId: rec.releaseId || null,
    seed: g.seed,
    rate: g.rate,
    ticks: g.ticks,
    finished: g.finished,
    input: g.input,
    camera: g.camera,
    checks: g.checks,
  }
}

// --- проценты ----------------------------------------------------------------
// Выход из главы — узел, к которому привязана следующая глава: n.next.
//
// Отличать финал от тупика по одному лишь графу нельзя: «из узла не ведёт ни
// одна тропа» одинаково верно и для настоящего конца, и для боковой ветки,
// куда игрок свернул и главу не прошёл. Разница не косметическая — если
// считать тупик финалом, свернуть в него оказывается вдвое быстрее честного
// прохождения, и any% превращается в соревнование «кто быстрее свернёт».
//
// Отдельный флажок «это финал» решал бы задачу, но был бы лишней сущностью:
// автор и так должен сказать, куда ведёт глава дальше. Привязка узла к
// следующей главе несёт этот смысл сама — и заодно даёт развилку историй:
// разные концы главы могут вести в разные главы. А узел без привязки и без
// исходящих троп — тупик, и это видно без всяких пометок.
export const exitNodes = (ch) =>
  ch.nodes.filter((n) => n.next).map((n) => n.levelId)

// Тупики: доиграть до них можно, но главу это не проходит. Редактору есть
// что показать автору — скорее всего он просто забыл привязать продолжение.
export const deadEnds = (ch) =>
  ch.nodes
    .filter((n) => !n.next && !ch.edges.some((e) => e.from === n.levelId))
    .map((n) => n.levelId)

// Последняя глава истории выходов не имеет: дальше ничего нет. Тогда финалом
// считается узел без исходящих троп — в такой главе он и есть конец пути.
export const isLastChapter = (ch) => !ch.nodes.some((n) => n.next)

export const finishNodes = (ch) =>
  isLastChapter(ch) ? deadEnds(ch) : exitNodes(ch)

// Главе нужна рука автора: концов несколько, но ни один никуда не ведёт.
// Пока так, any% в ней считать нельзя — иначе зачёт достанется тупику.
export function needsRouting(ch) {
  if (ch.nodes.some((n) => n.next)) return false
  return deadEnds(ch).length > 1
}

// any% — глава пройдена: взята одна ветка и достигнут её выход. Остальные
// ветки при этом могут остаться нетронутыми, и это законный результат.
export function isAnyPercent(ch, done) {
  if (needsRouting(ch)) return false
  const exits = finishNodes(ch)
  return exits.length > 0 && exits.some((id) => done.has(id))
}

// Куда ведёт пройденная глава: следующая глава по тому выходу, которым вышли.
// Историю это превращает из списка глав в граф — ровно то, ради чего привязка
// и заводилась.
export function nextChapterOf(ch, done) {
  const taken = ch.nodes.find((n) => n.next && done.has(n.levelId))
  return taken ? taken.next : null
}

// 100% — пройдены все уровни главы, то есть все ветки, а не только та,
// что ведёт к концу быстрее.
export function isFullPercent(ch, done) {
  return ch.nodes.length > 0 && ch.nodes.every((n) => done.has(n.levelId))
}

// Категорию не выбирают заранее, её показывает сам прогон: прошёл все ветки —
// значит 100%, дошёл до конца одной — any%. Заявлять категорию до начала
// незачем; заявка всё равно проверяется по факту, а лишний вопрос игроку
// перед стартом ничего не решает.
export function categoryOf(ch, done) {
  if (isFullPercent(ch, done)) return CATEGORY.FULL
  if (isAnyPercent(ch, done)) return CATEGORY.ANY
  return null   // глава не пройдена: попытка есть, зачёта нет
}

// Доля пройденного — то, что показывают в интерфейсе рядом с таймером
export const percentOf = (ch, done) =>
  ch.nodes.length ? Math.round((ch.nodes.filter((n) => done.has(n.levelId)).length / ch.nodes.length) * 100) : 0

// --- история как граф глав ---------------------------------------------------
//
// Рёбра для истории не нужно выдумывать: они уже есть. Привязка узла к
// следующей главе (n.next) и есть ребро, а список story.chapters перестаёт
// быть порядком прохождения и становится просто составом — какие главы этой
// истории принадлежат. Порядок задают связи, и он может ветвиться: разные
// концы главы ведут в разные главы, поэтому у истории бывает не один путь.
//
// Первая глава — та, в которую никто не ведёт. Если таких несколько (автор
// сделал несколько начал) — все они начала. Если ни одной, значит связи
// образуют кольцо; тогда берём первую по составу, чтобы игра не оказалась
// без входа вовсе.
export function entryChapters(story, chapters) {
  const own = story.chapters || []
  const targeted = new Set(
    chapters.filter((c) => own.includes(c.id))
      .flatMap((c) => c.nodes.filter((n) => n.next).map((n) => n.next)))
  const entries = own.filter((id) => !targeted.has(id))
  return entries.length ? entries : own.slice(0, 1)
}

// Что пройдено, разложенное по главам. Попытка истории — та же цепочка
// сегментов, только каждый сегмент помнит, к какой главе относился.
export function doneByChapter(run) {
  const out = new Map()
  for (const g of run.segments) {
    if (!g.finished) continue
    const key = g.chapterId || null
    if (!out.has(key)) out.set(key, new Set())
    out.get(key).add(g.levelId)
  }
  return out
}

// Какие главы открыты. Начальные — всегда; остальные — те, в которые ведёт
// пройденный выход уже пройденной главы. Правило то же, что у уровней внутри
// главы, этажом выше.
export function openChapters(story, chapters, doneMap) {
  const own = new Set(story.chapters || [])
  const open = new Set(entryChapters(story, chapters))
  for (const ch of chapters) {
    if (!own.has(ch.id)) continue
    const done = doneMap.get(ch.id)
    if (!done) continue
    for (const n of ch.nodes) if (n.next && done.has(n.levelId) && own.has(n.next)) open.add(n.next)
  }
  return [...open]
}

// Концы истории — главы, из которых никуда не ведут: пройдя такую, игрок
// прошёл историю. Это тот же вопрос, что и с тупиками внутри главы, и ответ
// тот же: его решают связи, а не отдельная пометка.
export const finalChapters = (story, chapters) =>
  chapters.filter((c) => (story.chapters || []).includes(c.id) && isLastChapter(c)).map((c) => c.id)

// Категория прохождения истории.
//   100% — каждая глава истории пройдена на 100%, то есть все ветки везде;
//   any% — доведена до конца хотя бы одна ветка: пройдена финальная глава.
// Как и у главы, категорию не спрашивают заранее — её показывает сам прогон.
export function storyCategoryOf(story, chapters, doneMap) {
  const own = chapters.filter((c) => (story.chapters || []).includes(c.id))
  if (!own.length) return null
  const catOf = (c) => categoryOf(c, doneMap.get(c.id) || new Set())
  if (own.every((c) => catOf(c) === CATEGORY.FULL)) return CATEGORY.FULL
  const finals = new Set(finalChapters(story, chapters))
  if (own.some((c) => finals.has(c.id) && catOf(c))) return CATEGORY.ANY
  return null
}

// Доля пройденных глав — для показа рядом с таймером
export function storyPercent(story, chapters, doneMap) {
  const own = chapters.filter((c) => (story.chapters || []).includes(c.id))
  if (!own.length) return 0
  const passed = own.filter((c) => categoryOf(c, doneMap.get(c.id) || new Set())).length
  return Math.round((passed / own.length) * 100)
}

// Какие уровни сейчас доступны: входные и те, к которым пройдена ведущая
// тропа. Ровно то же правило, что на карте главы, но считается по прогрессу
// этой попытки, а не по общему сохранению: в спидране прошлые заслуги не в счёт.
export function openNodes(ch, done) {
  return ch.nodes
    .filter((n) => {
      const incoming = ch.edges.filter((e) => e.to === n.levelId)
      return !incoming.length || incoming.some((e) => done.has(e.from))
    })
    .map((n) => n.levelId)
}
