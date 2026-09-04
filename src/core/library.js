// Библиотека — всё содержимое игры в одной структуре:
//   история → главы → уровни, плюс общий склад ассетов.
// Ассет — сохранённая настройка сущности (тип + данные). «Горячие» ассеты
// поднимаются наверх списка в редакторе; их список есть у истории, у главы
// и у уровня, и они складываются.

const KEY = 'goo.library.v1'
const PROGRESS = 'goo.progress.v1'

// Имён здесь не выдают.
//
// Раньше их чеканил браузер: редактор должен был назвать историю до того, как о
// ней узнает сервер. Цена — имя, живущее в двух местах сразу: сервер выдавал
// своё, клиент оставался со своим, и каждое следующее сохранение уходило по
// несуществующему id. Теперь всякое имя приходит из ответа сервера, а функции
// ниже принимают его снаружи и только раскладывают по местам.

const empty = () => ({ stories: [], chapters: [], levels: [], assets: [] })

let cache = null

// Что приехало с сервера, а что человек сделал здесь.
//
// Игра больше не везёт содержимое в сборке: всё, во что можно играть, приходит
// из каталога. Отсюда и разделение — сыгранное держится в памяти и переспра-
// шивается у сервера, а в localStorage остаются только черновики редактора,
// то есть единственное, что принадлежит этому браузеру и больше нигде не
// существует. Складывать их в одну кучу значило бы либо терять черновики при
// обновлении каталога, либо копить у себя чужие истории, которые всё равно
// нельзя ни изменить, ни опубликовать.
const remote = new Set()

export const isRemote = (id) => remote.has(id)

export function library() {
  if (cache) return cache

  try {
    const raw = localStorage.getItem(KEY)
    cache = raw ? JSON.parse(raw) : empty()
  } catch {
    cache = empty()
  }

  return cache
}

/**
 * Влить содержимое, пришедшее с сервера.
 *
 * Заменяет предыдущую серверную версию той же истории целиком: каталог —
 * источник правды, и подмешивать к нему остатки прошлого ответа значит
 * когда-нибудь показать игроку главу, которой в релизе уже нет.
 */
export function hydrate(bundle) {
  const lib = library()
  const ids = new Set((bundle.chapters || []).map((c) => c.id))
  const levelIds = new Set((bundle.levels || []).map((l) => l.id))

  lib.stories = lib.stories.filter((s) => s.id !== bundle.id)
  lib.chapters = lib.chapters.filter((c) => !ids.has(c.id) && !(remote.has(c.id) && c.storyId === bundle.id))
  lib.levels = lib.levels.filter((l) => !levelIds.has(l.id))

  lib.stories.push({
    id: bundle.id,
    title: bundle.title,
    cover: bundle.cover || '#1a2b33',
    chapters: (bundle.chapters || []).map((c) => c.id),
    hot: [],
  })

  for (const chapter of bundle.chapters || []) {
    lib.chapters.push({ ...chapter, storyId: bundle.id, hot: chapter.hot || [] })
    remote.add(chapter.id)
  }

  for (const level of bundle.levels || []) {
    lib.levels.push({ ...level, hot: level.hot || [] })
    remote.add(level.id)
  }

  remote.add(bundle.id)

  return cache
}

/** Забыть всё серверное — например, при выходе из аккаунта. */
export function dropRemote() {
  const lib = library()

  lib.stories = lib.stories.filter((s) => !remote.has(s.id))
  lib.chapters = lib.chapters.filter((c) => !remote.has(c.id))
  lib.levels = lib.levels.filter((l) => !remote.has(l.id))
  remote.clear()

  return cache
}

/**
 * Сохранить — но только своё.
 *
 * Серверные истории намеренно не попадают в localStorage: они не наши, они
 * меняются релизами, и держать их копию значит рано или поздно играть в
 * устаревшую версию, не зная об этом.
 */
export function save(lib = cache) {
  cache = lib
  localStorage.setItem(KEY, JSON.stringify({
    stories: lib.stories.filter((s) => !remote.has(s.id)),
    chapters: lib.chapters.filter((c) => !remote.has(c.id)),
    levels: lib.levels.filter((l) => !remote.has(l.id)),
    assets: lib.assets,
  }))

  return lib
}

export function resetLibrary() {
  cache = empty()
  save()
  localStorage.removeItem(PROGRESS)

  return cache
}

// ---- выборки ---------------------------------------------------------------
export const stories = () => library().stories
export const story = (id) => library().stories.find((s) => s.id === id) || null
export const chapter = (id) => library().chapters.find((c) => c.id === id) || null
export const level = (id) => library().levels.find((l) => l.id === id) || null
export const assets = () => library().assets

export const chaptersOf = (storyId) =>
  (story(storyId)?.chapters || []).map(chapter).filter(Boolean)

// ---- создание и правка -----------------------------------------------------
export function createStory({ id, chapterId }, title = 'New story', extra = {}) {
  const lib = library()
  const s = { id, title, cover: 'linear-gradient(140deg,#2b4a5c,#16242b)', intro: '', chapters: [], hot: [], ...extra }
  lib.stories.push(s)
  const c = createChapter(s.id, chapterId, 'Chapter 1')
  save()
  return { story: s, chapter: c }
}

// Ширина и высота области главы на доске. Одинаковые у всех новых: доска
// читается по расположению, а не по размеру, и разнобой на пустом месте только
// мешал бы искать глазами.
export const CHAPTER_BOX = { w: 420, h: 300, gap: 80 }

// Новая глава встаёт правее самой правой — доска у истории без краёв, и место
// справа всегда есть. Автор потом двигает её куда хочет.
function nextSpot(storyId) {
  const boxes = chaptersOf(storyId).map((c) => c.canvas).filter(Boolean)
  if (!boxes.length) return { x: 0, y: 0, ...{ w: CHAPTER_BOX.w, h: CHAPTER_BOX.h } }
  const right = Math.max(...boxes.map((b) => b.x + b.w))
  return { x: right + CHAPTER_BOX.gap, y: Math.min(...boxes.map((b) => b.y)), w: CHAPTER_BOX.w, h: CHAPTER_BOX.h }
}

export function createChapter(storyId, id, title = 'New chapter', extra = {}) {
  const lib = library()
  const c = { id, storyId, title, image: 'linear-gradient(160deg,#1d3040,#0f1a20)', map: '', nodes: [], hot: [], canvas: nextSpot(storyId), ...extra }
  lib.chapters.push(c)
  story(storyId)?.chapters.push(c.id)
  save()
  return c
}

// Уровень без точки на карте.
//
// Понадобился, когда уровни стали появляться в панели раньше, чем на доске:
// автор делает уровень, потом решает, в какую главу его положить. Раньше такого
// состояния не было — createLevel() создавал уровень и точку одним движением, —
// и уровень без точки был бы попросту невидим, потому что список собирался
// обходом карт.
//
// Поэтому уровень теперь помнит свою историю. На сервере это поле есть с самого
// начала (levels.story_id), так что расходимся мы только во фронте.
export function createLevelIn(storyId, id, name = null, extra = {}) {
  const lib = library()

  // Рабочее имя, а не то, что увидит игрок: игрок видит имя ТОЧКИ. Уровень —
  // это содержимое, и спрашивать у автора название до того, как он что-то
  // построил, значит спрашивать раньше, чем есть о чём.
  const n = lib.levels.filter((x) => x.storyId === storyId).length + 1

  const l = {
    id, storyId, name: name || `Level ${n}`,
    width: 1600, height: 900,
    gravity: { x: 0, y: 1800 },
    goal: 3, entities: [], hot: [],
    image: extra.image || '',
  }
  lib.levels.push(l)
  save()
  return l
}

export function createLevel(chapterId, { id, nodeId }, name = 'New level', extra = {}) {
  const lib = library()
  const l = {
    id, storyId: chapter(chapterId)?.storyId, name,
    width: 1600, height: 900,
    gravity: { x: 0, y: 1800 },
    goal: 3, entities: [], hot: [],
    image: extra.image || '',
  }
  lib.levels.push(l)
  const ch = chapter(chapterId)
  if (ch) {
    // Точка получает собственное имя: один уровень может стоять в нескольких.
    const n = ch.nodes.length
    // Ролик принадлежит точке, а не уровню: один и тот же уровень, встреченный
    // второй раз, может закончиться по-своему.
    const node = {
      id: nodeId, levelId: l.id,
      x: 12 + (n % 6) * 14, y: 25 + Math.floor(n / 6) * 22,
      next: [], name: extra.name || '', image: extra.image || '', outro: extra.outro || '',
    }
    if (n > 0) ch.nodes[n - 1].next.push(node.id)
    ch.nodes.push(node)

    // Первая появившаяся точка открывает историю.
    const st = story(ch.storyId)
    if (st && !st.start) { st.start = node.id; }
  }
  save()
  return l
}

export function removeStory(id) {
  const lib = library()
  for (const c of chaptersOf(id)) removeChapter(c.id, true)
  lib.stories = lib.stories.filter((s) => s.id !== id)
  save()
}

// Сдвиг области главы по доске. Точки внутри не трогаем: их x и y — проценты
// самой главы, поэтому область едет вместе со всем содержимым бесплатно.
export function placeChapter(id, rect) {
  const c = chapter(id)
  if (!c) return
  c.canvas = { ...(c.canvas || { w: CHAPTER_BOX.w, h: CHAPTER_BOX.h }), ...rect }
  save()
}

export function removeChapter(id, keepStory = false) {
  const lib = library()
  const ch = chapter(id)
  if (!ch) return
  const used = new Set(lib.chapters.filter((c) => c.id !== id).flatMap((c) => c.nodes.map((n) => n.levelId)))
  lib.levels = lib.levels.filter((l) => used.has(l.id) || !ch.nodes.some((n) => n.levelId === l.id))
  lib.chapters = lib.chapters.filter((c) => c.id !== id)
  // Связи, которые вели в точки удалённой главы, снимаются. Оставить их висеть
  // нельзя: на карте они выглядели бы дорогой вперёд, вели бы в никуда, и всё,
  // что за ними, осталось бы запертым навсегда.
  const gone = new Set(ch.nodes.map((n) => n.id))
  for (const c of lib.chapters) {
    for (const n of c.nodes) n.next = (n.next || []).filter((x) => !gone.has(x))
  }

  // История не должна начинаться в исчезнувшем месте.
  const st = story(ch.storyId)
  if (st && gone.has(st.start)) {
    st.start = lib.chapters.filter((c) => st.chapters.includes(c.id)).flatMap((c) => c.nodes)[0]?.id || null
  }
  if (!keepStory) {
    const s = story(ch.storyId)
    if (s) s.chapters = s.chapters.filter((x) => x !== id)
  }
  save()
}

export function removeLevel(chapterId, levelId) {
  const lib = library()
  const ch = chapter(chapterId)
  if (ch) {
    const gone = new Set(ch.nodes.filter((n) => n.levelId === levelId).map((n) => n.id))
    ch.nodes = ch.nodes.filter((n) => n.levelId !== levelId)
    // Связь на исчезнувшую точку выглядела бы дорогой вперёд и заперла бы всё,
    // что за ней, навсегда.
    for (const c of lib.chapters) for (const n of c.nodes) n.next = (n.next || []).filter((x) => !gone.has(x))
  }
  const stillUsed = lib.chapters.some((c) => c.nodes.some((n) => n.levelId === levelId))
  if (!stillUsed) lib.levels = lib.levels.filter((l) => l.id !== levelId)
  save()
}

// Все уровни истории — то, из чего редактор выбирает, ставя точку.
//
// Уровень принадлежит истории, а не главе: точка на карте лишь показывает его.
// Поэтому список собирается по всем главам истории, а не по одной.
export function levelsOf(storyId) {
  const lib = library()
  const seen = new Map()

  // Уровни, которые сами знают свою историю, — включая ещё не положенные ни на
  // одну карту.
  for (const l of lib.levels) if (l.storyId === storyId) seen.set(l.id, l)

  // Старые уровни поля не имеют: их видно только через точки, которые их
  // показывают. Обход карт остаётся ради них и уйдёт, когда уйдут они.
  for (const c of chaptersOf(storyId)) {
    for (const n of c.nodes) {
      const l = level(n.levelId)
      if (l && !seen.has(l.id)) seen.set(l.id, l)
    }
  }
  return [...seen.values()]
}

// Что игрок видит под точкой. Имя уровня — запасной вариант для старых данных
// и рабочее имя в панели автора.
export const nodeName = (node) => node?.name || level(node?.levelId)?.name || ''

// Уровни истории, которых нет ни на одной карте. В панели они первыми: автор
// только что их сделал и ещё не решил, куда положить.
export const unplacedLevels = (storyId) =>
  levelsOf(storyId).filter((l) => placesOf(storyId, l.id).length === 0)

// Сколько точек показывают этот уровень и в каких главах.
export function placesOf(storyId, levelId) {
  return chaptersOf(storyId)
    .flatMap((c) => c.nodes.filter((n) => n.levelId === levelId).map((n) => ({ chapter: c, node: n })))
}

/**
 * Поставить на карту ещё одну точку для уже существующего уровня.
 *
 * Ровно то, ради чего у точек появились собственные имена: один уровень,
 * встреченный в истории второй раз, ведёт дальше по-своему и заканчивается
 * своим роликом. Новый уровень при этом не создаётся — показывается тот же.
 */
export function pinLevel(chapterId, levelId, nodeId, at = {}) {
  const ch = chapter(chapterId)
  if (!ch || !level(levelId)) return null

  const n = ch.nodes.length

  // Имя, картинка и ролик живут на точке, а не на уровне. Один и тот же уровень,
  // встреченный в истории второй раз, — это другое место: у него своё название
  // на карте, своя картинка и свой ролик в конце. Держать их на уровне значило
  // бы, что второе появление обязано звать себя так же, как первое.
  const node = {
    id: nodeId,
    levelId,
    x: at.x ?? 12 + (n % 6) * 14,
    y: at.y ?? 25 + Math.floor(n / 6) * 22,
    next: [],
    name: at.name || '',
    image: at.image || '',
    outro: at.outro || '',
  }
  ch.nodes.push(node)
  save()

  return node
}

/**
 * Убрать точку, не трогая уровень.
 *
 * Отличается от removeLevel: та убирает уровень из истории целиком. Пока
 * уровень стоял ровно в одном месте, разницы не было; теперь есть, и путать их
 * — значит терять уровень, снимая с карты одно из его появлений.
 */
export function unpinNode(chapterId, nodeId) {
  const lib = library()
  const ch = chapter(chapterId)
  if (!ch) return

  const shown = ch.nodes.find((n) => n.id === nodeId)?.levelId
  ch.nodes = ch.nodes.filter((n) => n.id !== nodeId)
  for (const c of lib.chapters) for (const n of c.nodes) n.next = (n.next || []).filter((x) => x !== nodeId)

  const st = story(ch.storyId)
  if (st && st.start === nodeId) {
    st.start = lib.chapters.filter((c) => st.chapters.includes(c.id)).flatMap((c) => c.nodes)[0]?.id || null
  }

  // Уровень, который больше нигде не показан, из истории уходит: до него не
  // добраться, а в выгрузке он остался бы грузом, который никто не откроет.
  const stillUsed = lib.chapters.some((c) => c.nodes.some((n) => n.levelId === shown))
  if (shown && !stillUsed) lib.levels = lib.levels.filter((l) => l.id !== shown)

  save()
}

/** Показать в этой точке другой уровень. */
export function setNodeLevel(chapterId, nodeId, levelId) {
  const ch = chapter(chapterId)
  const node = ch?.nodes.find((n) => n.id === nodeId)
  if (!node || !level(levelId)) return
  node.levelId = levelId
  save()
}

export function copyLevel(chapterId, levelId, { id, nodeId }) {
  const src = level(levelId)
  if (!src) return null
  const lib = library()
  const copy = structuredClone(src)
  copy.id = id
  copy.name = src.name + ' — copy'
  lib.levels.push(copy)
  const ch = chapter(chapterId)
  const node = ch?.nodes.find((n) => n.levelId === levelId)
  ch?.nodes.push({ id: nodeId, levelId: copy.id, x: Math.min(92, (node?.x ?? 20) + 8), y: Math.min(90, (node?.y ?? 20) + 8), next: [], outro: '' })
  save()
  return copy
}

export function saveLevel(l) {
  const lib = library()
  const i = lib.levels.findIndex((x) => x.id === l.id)
  if (i >= 0) lib.levels[i] = l; else lib.levels.push(l)
  save()
  return l
}

// ---- ассеты ----------------------------------------------------------------
// Ассет — группа сущностей, а не одна.
//
// Переиспользовать обычно хочется не отдельную сущность, а сочетание: мотор
// вместе с рычагом, который он крутит. Сохраняя их по одной, теряешь ровно то,
// ради чего сохранял, — как они собраны. Одиночная сущность при этом просто
// группа из одной.
export function createAsset({ id, title, entities }) {
  const lib = library()
  const list = structuredClone(entities)
  const a = { id, title: title || list[0]?.type || 'asset', entities: list }
  lib.assets.push(a)
  save()
  return a
}

// Какие типы внутри — по ним палитра группирует. Группа из нескольких типов
// принадлежит каждому из них: тот, кто искал мотор, найдёт мотор с рычагом.
export const assetTypes = (a) => [...new Set((a.entities || []).map((e) => e.type))]

export function removeAsset(id) {
  const lib = library()
  lib.assets = lib.assets.filter((a) => a.id !== id)
  for (const holder of [...lib.stories, ...lib.chapters, ...lib.levels]) {
    if (holder.hot) holder.hot = holder.hot.filter((x) => x !== id)
  }
  save()
}

// Горячие ассеты складываются: уровень → глава → история, дубликаты убираются
export function hotAssets({ storyId, chapterId, levelId }) {
  const ids = [
    ...(level(levelId)?.hot || []),
    ...(chapter(chapterId)?.hot || []),
    ...(story(storyId)?.hot || []),
  ]
  const seen = new Set()
  return ids.filter((id) => !seen.has(id) && seen.add(id)).map((id) => assets().find((a) => a.id === id)).filter(Boolean)
}

export function toggleHot(scope, id, assetId) {
  const holder = scope === 'story' ? story(id) : scope === 'chapter' ? chapter(id) : level(id)
  if (!holder) return
  holder.hot ||= []
  holder.hot = holder.hot.includes(assetId) ? holder.hot.filter((x) => x !== assetId) : [...holder.hot, assetId]
  save()
}

export const isHot = (scope, id, assetId) => {
  const holder = scope === 'story' ? story(id) : scope === 'chapter' ? chapter(id) : level(id)
  return !!holder?.hot?.includes(assetId)
}

// ---- прогресс --------------------------------------------------------------
function progress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS)) || {} } catch { return {} }
}
export const isDone = (levelId) => !!progress()[levelId]
/**
 * Заменить прогресс целиком — тем, что пройдено в выбранном прохождении.
 *
 * Именно заменить, а не дополнить. Прогресс теперь принадлежит прохождению, и
 * второе обязано начинаться пустым; подмешивание к нему прошлых заслуг сделало
 * бы новый слот уже пройденным, то есть отменило бы смысл слотов.
 */
export function setProgress(levelIds) {
  localStorage.setItem(PROGRESS, JSON.stringify(Object.fromEntries(levelIds.map((id) => [id, true]))))
}

export function markDone(levelId) {
  const p = progress()
  p[levelId] = true
  localStorage.setItem(PROGRESS, JSON.stringify(p))
}

// Уровень открыт, если он входной (в него не ведёт ни одна тропа)
// или пройден хотя бы один из ведущих к нему.
// Точка открыта, если в неё не ведёт ничего (значит она вход) или пройдена
// хотя бы одна ведущая к ней. Считается по точкам, а не по уровням: уровень
// может стоять в нескольких местах, и пройденный в одном остальные не открывает.
export function nodeOpen(ch, nodeId) {
  const all = library().chapters
  const incoming = all.flatMap((c) => c.nodes.filter((n) => (n.next || []).includes(nodeId)))
  if (!incoming.length) return true
  return incoming.some((n) => isDone(n.levelId))
}
// Тропа видна, когда пройдено её начало
// Связь видна, когда пройдена точка, из которой она идёт.
export const linkVisible = (ch, fromNodeId) => {
  const n = ch.nodes.find((m) => m.id === fromNodeId)
  return !!n && isDone(n.levelId)
}

export const chapterDone = (ch) => ch.nodes.length > 0 && ch.nodes.every((n) => isDone(n.levelId))

// Глава открыта, если она первая или предыдущая пройдена целиком
export function chapterOpen(storyId, chapterId) {
  const list = chaptersOf(storyId)
  const i = list.findIndex((c) => c.id === chapterId)
  if (i <= 0) return true
  return chapterDone(list[i - 1])
}

// ---- файлы -----------------------------------------------------------------
function bundleOf(kind, ids) {
  const lib = library()
  const chapters = lib.chapters.filter((c) => ids.chapters.includes(c.id))
  const levelIds = new Set(chapters.flatMap((c) => c.nodes.map((n) => n.levelId)))
  const levels = lib.levels.filter((l) => levelIds.has(l.id))
  const hotIds = new Set([...ids.stories.map(story), ...chapters, ...levels].flatMap((h) => h?.hot || []))
  return {
    format: 'goo-bundle', version: 1, kind,
    stories: lib.stories.filter((s) => ids.stories.includes(s.id)),
    chapters, levels,
    assets: lib.assets.filter((a) => hotIds.has(a.id)),
  }
}

export function exportAll() {
  const lib = library()
  return { format: 'goo-bundle', version: 1, kind: 'library', ...structuredClone(lib) }
}
export const exportStory = (id) =>
  bundleOf('story', { stories: [id], chapters: story(id)?.chapters || [] })
export const exportChapter = (id) =>
  bundleOf('chapter', { stories: [], chapters: [id] })

/**
 * Влить содержимое с сервера в локальную библиотеку.
 *
 * Раньше здесь переименовывались конфликтующие id — потому что пакет мог
 * приехать из файла и столкнуться с уже имеющимся. Файлового ввоза больше нет:
 * единственные, кто сюда ходит, — downloadStory и downloadLibrary, то есть
 * сервер отдаёт то, что сам же и назвал. Переименовывать своё же значило
 * заводить вторую копию каждой истории при каждом обновлении.
 *
 * Поэтому теперь слияние по id, и сервер главнее: у него источник правды, а
 * здесь кэш. Имён клиент не придумывает вовсе.
 */
export function importBundle(bundle) {
  if (!bundle || bundle.format !== 'goo-bundle') throw new Error('This is not a Goo stories file')
  const lib = library()

  const upsert = (list, item) => {
    const i = list.findIndex((x) => x.id === item.id)
    if (i >= 0) list[i] = item
    else list.push(item)
  }

  for (const a of bundle.assets || []) upsert(lib.assets, structuredClone(a))
  for (const l of bundle.levels || []) upsert(lib.levels, structuredClone(l))
  for (const c of bundle.chapters || []) upsert(lib.chapters, structuredClone(c))

  const added = []
  for (const st of bundle.stories || []) {
    const copy = structuredClone(st)
    upsert(lib.stories, copy)
    added.push(copy)
  }

  // Глава знает свою историю по тому, кто её перечисляет.
  for (const c of lib.chapters) {
    const owner = lib.stories.find((st) => st.chapters.includes(c.id))
    if (owner) c.storyId = owner.id
  }

  // Ссылка на точку, которой в библиотеке нет, хуже её отсутствия: на карте это
  // выглядит дорогой вперёд, а за ней ничего.
  const known = new Set(lib.chapters.flatMap((c) => c.nodes.map((n) => n.id)))
  for (const c of lib.chapters) {
    for (const n of c.nodes) n.next = (n.next || []).filter((x) => known.has(x))
  }

  save()

  return added
}
