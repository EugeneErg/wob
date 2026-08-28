import builtin from '../levels/library.json' with { type: 'json' }

// Библиотека — всё содержимое игры в одной структуре:
//   история → главы → уровни, плюс общий склад ассетов.
// Ассет — сохранённая настройка сущности (тип + данные). «Горячие» ассеты
// поднимаются наверх списка в редакторе; их список есть у истории, у главы
// и у уровня, и они складываются.

const KEY = 'goo.library.v1'
const PROGRESS = 'goo.progress.v1'

const uid = (p) => `${p}-${Math.random().toString(36).slice(2, 9)}`

let cache = null

export function library() {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) { cache = JSON.parse(raw); return cache }
  } catch { /* повреждённое хранилище — начнём с встроенного */ }
  cache = structuredClone(builtin)
  save()
  return cache
}

export function save(lib = cache) {
  cache = lib
  localStorage.setItem(KEY, JSON.stringify(lib))
  return lib
}

export function resetLibrary() {
  cache = structuredClone(builtin)
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
export function createStory(title = 'Новая история') {
  const lib = library()
  const s = { id: uid('story'), title, cover: 'linear-gradient(140deg,#2b4a5c,#16242b)', chapters: [], hot: [] }
  lib.stories.push(s)
  const c = createChapter(s.id, 'Глава 1')
  save()
  return { story: s, chapter: c }
}

export function createChapter(storyId, title = 'Новая глава') {
  const lib = library()
  const c = { id: uid('ch'), storyId, title, image: 'linear-gradient(160deg,#1d3040,#0f1a20)', nodes: [], edges: [], hot: [] }
  lib.chapters.push(c)
  story(storyId)?.chapters.push(c.id)
  save()
  return c
}

export function createLevel(chapterId, name = 'Новый уровень') {
  const lib = library()
  const l = {
    id: uid('lvl'), name,
    width: 1600, height: 900,
    gravity: { x: 0, y: 1800 },
    goal: 3, entities: [], hot: [],
  }
  lib.levels.push(l)
  const ch = chapter(chapterId)
  if (ch) {
    const n = ch.nodes.length
    ch.nodes.push({ levelId: l.id, x: 12 + (n % 6) * 14, y: 25 + Math.floor(n / 6) * 22 })
    if (n > 0) ch.edges.push({ from: ch.nodes[n - 1].levelId, to: l.id })
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

export function removeChapter(id, keepStory = false) {
  const lib = library()
  const ch = chapter(id)
  if (!ch) return
  const used = new Set(lib.chapters.filter((c) => c.id !== id).flatMap((c) => c.nodes.map((n) => n.levelId)))
  lib.levels = lib.levels.filter((l) => used.has(l.id) || !ch.nodes.some((n) => n.levelId === l.id))
  lib.chapters = lib.chapters.filter((c) => c.id !== id)
  // Узлы, которые выводили в удалённую главу, перестают быть выходами. Оставить
  // привязку висеть нельзя: узел выглядел бы выходом, вёл бы в никуда, и глава
  // засчитывалась бы пройденной по несуществующей дороге.
  for (const c of lib.chapters) {
    for (const n of c.nodes) if (n.next === id) delete n.next
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
    ch.nodes = ch.nodes.filter((n) => n.levelId !== levelId)
    ch.edges = ch.edges.filter((e) => e.from !== levelId && e.to !== levelId)
  }
  const stillUsed = lib.chapters.some((c) => c.nodes.some((n) => n.levelId === levelId))
  if (!stillUsed) lib.levels = lib.levels.filter((l) => l.id !== levelId)
  save()
}

export function copyLevel(chapterId, levelId) {
  const src = level(levelId)
  if (!src) return null
  const lib = library()
  const copy = structuredClone(src)
  copy.id = uid('lvl')
  copy.name = src.name + ' — копия'
  lib.levels.push(copy)
  const ch = chapter(chapterId)
  const node = ch?.nodes.find((n) => n.levelId === levelId)
  ch?.nodes.push({ levelId: copy.id, x: Math.min(92, (node?.x ?? 20) + 8), y: Math.min(90, (node?.y ?? 20) + 8) })
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
export function createAsset({ type, title, data }) {
  const lib = library()
  const a = { id: uid('as'), type, title: title || type, data: structuredClone(data) }
  lib.assets.push(a)
  save()
  return a
}

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
export function markDone(levelId) {
  const p = progress()
  p[levelId] = true
  localStorage.setItem(PROGRESS, JSON.stringify(p))
}

// Уровень открыт, если он входной (в него не ведёт ни одна тропа)
// или пройден хотя бы один из ведущих к нему.
export function levelOpen(ch, levelId) {
  const incoming = ch.edges.filter((e) => e.to === levelId)
  if (!incoming.length) return true
  return incoming.some((e) => isDone(e.from))
}
// Тропа видна, когда пройдено её начало
export const edgeVisible = (e) => isDone(e.from)

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

// Импорт всегда добавляет, а не затирает: конфликтующие id переименовываются.
export function importBundle(bundle) {
  if (!bundle || bundle.format !== 'goo-bundle') throw new Error('Это не файл историй Goo')
  const lib = library()
  const map = new Map()
  const fresh = (id, prefix) => {
    if (!map.has(id)) map.set(id, uid(prefix))
    return map.get(id)
  }
  const taken = (arr, id) => arr.some((x) => x.id === id)

  for (const a of bundle.assets || []) {
    const same = lib.assets.find((x) => x.type === a.type && x.title === a.title && JSON.stringify(x.data) === JSON.stringify(a.data))
    if (same) { map.set(a.id, same.id); continue }
    const id = taken(lib.assets, a.id) ? fresh(a.id, 'as') : a.id
    map.set(a.id, id)
    lib.assets.push({ ...a, id })
  }
  for (const l of bundle.levels || []) {
    const id = taken(lib.levels, l.id) ? fresh(l.id, 'lvl') : l.id
    map.set(l.id, id)
    lib.levels.push({ ...structuredClone(l), id, hot: (l.hot || []).map((h) => map.get(h) || h) })
  }
  // Имена всем главам пакета раздаются ДО того, как собираются сами главы.
  // Иначе привязка на главу, которая лежит в пакете ниже, не найдёт её нового
  // имени: в тот момент его ещё не существует, и ссылка уехала бы на старое.
  const inBundle = new Set((bundle.chapters || []).map((c) => c.id))
  for (const c of bundle.chapters || []) {
    map.set(c.id, taken(lib.chapters, c.id) ? fresh(c.id, 'ch') : c.id)
  }
  for (const c of bundle.chapters || []) {
    const id = map.get(c.id)
    lib.chapters.push({
      ...structuredClone(c), id,
      // next — ссылка на главу, и при ввозе она обязана указывать на главу
      // ИЗ ЭТОГО ЖЕ пакета. Если главы-цели в пакете нет, ссылка снимается:
      // оставить её — значит вывести привезённую главу в чужую историю, где
      // случайно совпал id. Автор привяжет заново, и это честнее.
      // next снимается через раскладку, а не «добавляется при условии»:
      // ...n уже принесла бы старую ссылку с собой, и условная вставка могла бы
      // её только перезаписать, но не убрать.
      nodes: c.nodes.map(({ next, ...n }) => ({
        ...n,
        levelId: map.get(n.levelId) || n.levelId,
        ...(next && inBundle.has(next) ? { next: map.get(next) } : {}),
      })),
      edges: c.edges.map((e) => ({ from: map.get(e.from) || e.from, to: map.get(e.to) || e.to })),
      hot: (c.hot || []).map((h) => map.get(h) || h),
    })
  }
  const added = []
  for (const s of bundle.stories || []) {
    const id = taken(lib.stories, s.id) ? fresh(s.id, 'story') : s.id
    const copy = {
      ...structuredClone(s), id,
      chapters: s.chapters.map((c) => map.get(c) || c),
      hot: (s.hot || []).map((h) => map.get(h) || h),
    }
    lib.stories.push(copy)
    added.push(copy)
  }
  // глава без истории — заводим ей приют
  if (!bundle.stories?.length && bundle.chapters?.length) {
    const s = { id: uid('story'), title: 'Импортированные главы', cover: 'linear-gradient(140deg,#4a3a5c,#16242b)', chapters: bundle.chapters.map((c) => map.get(c.id) || c.id), hot: [] }
    lib.stories.push(s)
    added.push(s)
  }
  for (const c of lib.chapters) {
    const owner = lib.stories.find((s) => s.chapters.includes(c.id))
    if (owner) c.storyId = owner.id
  }
  // Привезли главу, а ту, в которую она выводила, — нет. Ссылка в никуда
  // хуже её отсутствия: узел выглядел бы выходом. Снимаем, автор привяжет заново.
  const known = new Set(lib.chapters.map((c) => c.id))
  for (const c of lib.chapters) {
    for (const n of c.nodes) if (n.next && !known.has(n.next)) delete n.next
  }
  save()
  return added
}
