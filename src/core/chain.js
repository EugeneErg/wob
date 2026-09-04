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
  // nodeId — точка на карте, а не уровень. Один уровень может стоять в
  // нескольких точках: встреченный второй раз, он ведёт дальше по-своему и
  // заканчивается своим роликом. Если считать пройденным уровень, а не точку,
  // то пройдя его в одной точке игрок откроет наследников всех трёх сразу —
  // и дерево истории перестанет быть деревом.
  //
  // У старых записей точки нет: там уровень стоял ровно в одном месте, и имя
  // точки выводится из уровня — то же правило, что на сервере.
  push(snapshot, { levelId, nodeId = null, chapterId = null, hash = null } = {}) {
    const level = levelId || snapshot.levelId
    this.segments.push({
      levelId: level,
      nodeId: nodeId || 'nd-' + level,
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
  // Пройденное — множество ТОЧЕК. Уровень может стоять в нескольких, и
  // пройденный в одной из них он остальные не открывает.
  get done() {
    const s = new Set()
    for (const g of this.segments) if (g.finished) s.add(g.nodeId || 'nd-' + g.levelId)
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
// Связи идут от точки к точке и могут уходить в соседнюю главу. Раньше это были
// рёбра между уровнями внутри главы плюс отдельная привязка узла к следующей
// главе — одна и та же мысль в двух масштабах, то есть два ответа на вопрос
// «что дальше». Теперь ответ один.
//
// Точка, из которой не ведёт ни одной связи, — финал. Их у истории много, а
// начало одно: story.start.
//
// Цена этого решения записана здесь честно. Отличить задуманный финал от
// боковой ветки, где автор просто не дорисовал продолжение, по одному графу
// нельзя — «связей нет» одинаково верно про обоих. Значит, свернуть в короткую
// ветку — законное прохождение any%, и быстрейший маршрут может оказаться
// вовсе не тем, который автор считал историей. Раньше это прикрывала привязка
// к следующей главе, несшая смысл «глава кончилась здесь». Теперь прикрывает
// редактор: на карте финальные точки видно, и незакрытая ветка бросается в
// глаза автору сразу, а не спидраннеру через месяц.
const linksOf = (n) => n.next || []

const idsOf = (ch) => new Set(ch.nodes.map((n) => n.id))

// Выходы: точки, чьи связи уводят за пределы главы.
export function exitNodes(ch) {
  const mine = idsOf(ch)
  return ch.nodes.filter((n) => linksOf(n).some((c) => !mine.has(c))).map((n) => n.id)
}

// Финалы: точки, из которых не ведёт ничего.
export const endingNodes = (ch) => ch.nodes.filter((n) => linksOf(n).length === 0).map((n) => n.id)

// Последняя глава истории выходов не имеет: дальше ничего нет.
export const isLastChapter = (ch) => exitNodes(ch).length === 0

// Чем глава кончается: либо уходом дальше, либо финалом. И то и другое —
// законный конец главы, поэтому считаются вместе.
export const finishNodes = (ch) => [...new Set([...exitNodes(ch), ...endingNodes(ch)])]

// any% — глава пройдена: взята одна ветка и достигнут её конец. Остальные
// ветки при этом могут остаться нетронутыми, и это законный результат.
export function isAnyPercent(ch, done) {
  const ends = finishNodes(ch)
  return ends.length > 0 && ends.some((id) => done.has(id))
}

// Куда ведёт пройденная глава: следующая глава по тому выходу, которым вышли.
// Историю это превращает из списка глав в граф — ровно то, ради чего привязка
// и заводилась.
export function nextChapterOf(ch, done, chapters = []) {
  const mine = idsOf(ch)
  for (const n of ch.nodes) {
    if (!done.has(n.id)) continue
    for (const child of linksOf(n)) {
      if (mine.has(child)) continue
      const target = chapters.find((c) => c.nodes.some((m) => m.id === child))
      if (target) return target.id
    }
  }
  return null
}

// 100% — пройдены все уровни главы, то есть все ветки, а не только та,
// что ведёт к концу быстрее.
export function isFullPercent(ch, done) {
  return ch.nodes.length > 0 && ch.nodes.every((n) => done.has(n.id))
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
  ch.nodes.length ? Math.round((ch.nodes.filter((n) => done.has(n.id)).length / ch.nodes.length) * 100) : 0

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
// Начало у истории одно и названо явно: story.start — конкретная точка. Какой
// главе она принадлежит, точка знает сама, поэтому входная глава выводится, а
// не угадывается.
//
// Раньше входом считалась глава, на которую никто не указывает. Это ответ от
// противного: вход был следствием того, чего автор НЕ нарисовал, и у истории
// без связей входами оказывались разом все главы.
export function entryChapters(story, chapters) {
  const own = story.chapters || []
  const mine = chapters.filter((c) => own.includes(c.id))
  const holder = mine.find((c) => c.nodes.some((n) => n.id === story.start))
  if (holder) return [holder.id]
  return own.length ? own.slice(0, 1) : []
}

// Что пройдено, разложенное по главам. Попытка истории — та же цепочка
// сегментов, только каждый сегмент помнит, к какой главе относился.
export function doneByChapter(run) {
  const out = new Map()
  for (const g of run.segments) {
    if (!g.finished) continue
    const key = g.chapterId || null
    if (!out.has(key)) out.set(key, new Set())
    out.get(key).add(g.nodeId || 'nd-' + g.levelId)
  }
  return out
}

// Всё пройденное одной кучей, без разбивки по главам: связь может уйти в
// соседнюю главу, поэтому «открыта ли эта точка» — вопрос про всю историю.
export function doneNodes(run) {
  const out = new Set()
  for (const g of run.segments) if (g.finished) out.add(g.nodeId || 'nd-' + g.levelId)
  return out
}

// Какие главы открыты. Начальные — всегда; остальные — те, в которые ведёт
// пройденный выход уже пройденной главы. Правило то же, что у уровней внутри
// главы, этажом выше.
// Какие главы открыты. Входная — всегда; остальные — те, куда ведёт связь из
// пройденной точки. Двух режимов больше нет: раньше история без единой привязки
// шла линейно по списку глав, а с любой привязкой — как граф. Список глав
// теперь задаёт только порядок показа, а порядок прохождения задают связи.
export function openChapters(story, chapters, doneMap) {
  const own = new Set(story.chapters || [])
  const mine = chapters.filter((c) => own.has(c.id))
  const open = new Set(entryChapters(story, chapters))

  const chapterOf = (nodeId) => mine.find((c) => c.nodes.some((n) => n.id === nodeId))

  for (const ch of mine) {
    const done = doneMap.get(ch.id)
    if (!done) continue
    for (const n of ch.nodes) {
      if (!done.has(n.id)) continue
      for (const child of linksOf(n)) {
        const target = chapterOf(child)
        if (target) open.add(target.id)
      }
    }
  }
  return [...open]
}

// Концы истории — главы, из которых никуда не ведут.
//
// Но только если привязки вообще расставлены. Если автор не привязал ни одной
// главы к следующей, то «из главы никуда не ведёт» верно про КАЖДУЮ, и концом
// оказывается любая: пройдя первую же главу, игрок как будто проходил всю
// историю. Именно так и случилось со встроенной библиотекой, где привязок нет.
//
// В непривязанной истории порядок задаёт состав: главы идут списком, как и
// было до появления развилок, и концом считается последняя. Это не запасной
// вариант «на всякий случай», а нормальный: линейной истории привязки не нужны,
// и требовать их от автора не за что.
/**
 * Глава, в которой игрок сейчас находится.
 *
 * Списка глав у игрока больше нет: история открывается сразу картой. Значит
 * кто-то должен ответить, какой именно, а с ветвлением открытых глав может быть
 * несколько одновременно.
 *
 * Правило: из открытых берём ту, где есть куда пойти и уже что-то пройдено —
 * это и есть место, где игрок остановился. Если начатых нет, берём первую
 * открытую, где есть непройденные точки. Если пройдено всё — главу, где история
 * начинается: возвращаться в конец логичнее всего оттуда.
 *
 * Ветку игрок выбирает сам, дойдя до двери на карте, а не здесь: угадывать за
 * него, какую из двух открывшихся глав он имел в виду, — худший способ
 * распорядиться развилкой, ради которой всё и затевалось.
 */
export function activeChapter(story, chapters, doneMap) {
  const open = new Set(openChapters(story, chapters, doneMap))
  const mine = chapters.filter((c) => open.has(c.id))
  const doneIn = (c) => doneMap.get(c.id) || new Set()
  const left = (c) => c.nodes.some((n) => !doneIn(c).has(n.id))

  const started = mine.filter((c) => doneIn(c).size > 0 && left(c))
  if (started.length) return started[started.length - 1].id

  const fresh = mine.find((c) => left(c))
  if (fresh) return fresh.id

  const holder = chapters.find((c) => c.nodes.some((n) => n.id === story.start))
  return holder?.id || mine[0]?.id || null
}

export function finalChapters(story, chapters) {
  const own = (story.chapters || [])
  const mine = chapters.filter((c) => own.includes(c.id))
  return mine.filter((c) => isLastChapter(c)).map((c) => c.id)
}

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
// Какие точки сейчас доступны. Открыта та, в которую ведёт пройденная точка, —
// и та, в которую не ведёт ничего: у неё нет условия, значит она вход.
//
// Связь может прийти из соседней главы, поэтому одной главы для ответа уже не
// хватает: нужен весь набор глав истории и то, что пройдено в них всех. Когда
// их не передали, работаем по одной главе — так ведут себя старые вызовы.
export function openNodes(ch, done, { chapters = [ch], done: doneAll = done } = {}) {
  const targeted = new Set(chapters.flatMap((c) => c.nodes.flatMap((n) => linksOf(n))))
  const parentsDone = (id) => chapters.some((c) =>
    c.nodes.some((n) => linksOf(n).includes(id) && doneAll.has(n.id)))

  return ch.nodes.filter((n) => !targeted.has(n.id) || parentsDone(n.id)).map((n) => n.id)
}
