// Версии контента и релизы.
//
// Задача: запись, снятая полгода назад, обязана проигрываться ровно так, как
// её сняли, — или честно говорить, что она снята на другом. Молча проиграть
// старую запись на новом уровне нельзя: расхождение в одну частицу через
// десять секунд превращается в другой финал, и рекорд оказывается враньём.
//
// Решение — считать версию из самого содержимого, а не назначать руками.
// Автор не обязан помнить, что подвинув один камень, он обесценил рекорды:
// хеш уровня меняется сам. Хеш главы включает хеши её уровней, хеш истории —
// хеши глав, поэтому правка одного камня поднимает версию и главы, и истории.
// Это дерево Меркла, тот же приём, что у git с деревьями коммитов.
//
// Отдельно от контента стоит версия правил (физика и сущности — то есть код
// репозитория). Уровень может не меняться годами, но если поправили решатель,
// старая запись всё равно пойдёт иначе. Поэтому запись хранит обе версии.

import { library, story, chapter, level } from './library.js'

// Версия правил симуляции. Поднимается вручную при любой правке физики или
// поведения сущностей. Держать её в коде, а не в package.json, чтобы правка
// решателя и поднятие версии лежали в одном коммите и ревьюер видел их рядом.
export const RULES_VERSION = 1

// --- хеш содержимого ---------------------------------------------------------
// FNV-1a: короткий, быстрый, без зависимостей. Криптостойкость тут не нужна —
// защищаемся от случайной правки, а не от злого умысла (подделку записи ловит
// не хеш, а перепроверка прогона на сервере).
function fnv(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0).toString(16).padStart(8, '0')
}

// Устойчивая сериализация: ключи по алфавиту. Без этого хеш прыгал бы от
// порядка полей в объекте, а он зависит от того, как объект собирали.
function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
}

// Из хеша уровня выброшено всё, что не влияет на игру: имя, положение точки
// на карте, горячие ассеты. Переименовать уровень — не значит сломать рекорды.
export function levelHash(l) {
  if (!l) return null
  const { id, width, height, gravity, goal, entities } = l
  return fnv(stable({ id, width, height, gravity, goal, entities }))
}

// Хеш главы — её структура плюс хеши уровней. Картинка и заголовок не в счёт,
// а вот тропы (edges) в счёт: они задают, какие ветки вообще существуют,
// то есть меняют смысл 100%.
export function chapterHash(ch) {
  if (!ch) return null
  const levels = ch.nodes.map((n) => `${n.levelId}:${levelHash(level(n.levelId))}`).sort()
  const edges = ch.edges.map((e) => `${e.from}>${e.to}`).sort()
  return fnv(stable({ id: ch.id, levels, edges }))
}

export function storyHash(s) {
  if (!s) return null
  return fnv(stable({ id: s.id, chapters: s.chapters.map((c) => `${c}:${chapterHash(chapter(c))}`) }))
}

// Сид уровня выводится из самого уровня, а не из попытки.
//
// Соблазн был сделать сид случайным на каждую попытку или производным от
// места уровня в главе. И то и другое неверно: тогда один и тот же уровень
// вёл бы себя по-разному, если играть его первым и четвёртым, и сравнивать
// прохождение уровня отдельно с ним же внутри главы стало бы нельзя. Физика
// и так достаточно чувствительна, чтобы повторить прогон было тяжело; менять
// под игроком ещё и случайный поток — значит сделать это невозможным.
//
// Поэтому случайность здесь — часть содержимого уровня, а не свойство сеанса:
// сид считается из хеша уровня. Автор поправил уровень — поменялся и хеш,
// и сид, но одновременно поменялась версия, так что старые записи знают,
// что они с другого уровня.
export function seedFor(l) {
  const h = typeof l === 'string' ? l : levelHash(l)
  return h ? parseInt(h, 16) >>> 0 : 1
}

// Отпечаток того, что именно проходили. Кладётся в каждую запись.
//
// Если играли выпуск, отпечаток берётся из него, а не из библиотеки: в
// библиотеке лежит черновик автора, и он к выпуску отношения не имеет. Раньше
// этого не было, и запись по выпуску получала отпечаток черновика — а значит
// протухала от первой же авторской правки, хотя игрок играл замороженное.
export function stampFor({ kind, targetId, releaseId }) {
  if (!releaseId) return stampOf({ kind, targetId })
  return stampOfRelease({ kind, targetId, releaseId })
}

export function stampOf({ kind, targetId }) {
  const hash = kind === 'story' ? storyHash(story(targetId))
    : kind === 'chapter' ? chapterHash(chapter(targetId))
      : levelHash(level(targetId))
  return { hash, rules: RULES_VERSION }
}

// Годится ли запись к честному повтору. Три ответа, а не два: «контент другой»
// и «код другой» — разные беды, и игроку полезно видеть, какая именно.
//
// Запись по выпуску сверяется с выпуском, а не с черновиком. Иначе выпуски не
// делали бы того, ради чего заведены: автор правит черновик — и рекорды по
// замороженной версии начинают считаться устаревшими, хотя игрок играл ровно
// то, что и было выпущено, и оно не изменилось.
export function checkRecord(rec) {
  if (rec.releaseId && !release(rec.releaseId)) {
    // Выпуска нет: он удалён или это чужая машина. Сверить запись не с чем,
    // и молча признать её годной нельзя — она может быть с чего угодно.
    return { ok: false, why: 'release', text: 'Выпуск, на котором снята запись, недоступен' }
  }
  const now = rec.releaseId
    ? stampOfRelease(rec)
    : stampOf({ kind: rec.kind, targetId: rec.targetId })
  if (rec.rules !== now.rules) return { ok: false, why: 'rules', text: 'Запись снята на другой версии физики' }
  if (rec.hash && now.hash && rec.hash !== now.hash) return { ok: false, why: 'content', text: 'С тех пор уровень изменили' }
  return { ok: true }
}

// Отпечаток содержимого внутри выпуска. Выпуск заморожен, поэтому отпечаток
// у него не меняется никогда — на то он и выпуск.
function stampOfRelease(rec) {
  const rel = release(rec.releaseId)
  if (!rel) return { hash: null, rules: rec.rules }   // выпуск исчез — сверять не с чем
  const found = rec.kind === 'story' ? rel.story
    : rec.kind === 'chapter' ? chapterFrom(rel, rec.targetId)
      : levelFrom(rel, rec.targetId)
  if (!found) return { hash: null, rules: rel.rules }
  const hash = rec.kind === 'story' ? storyHashOf(rel)
    : rec.kind === 'chapter' ? chapterHashOf(rel, found)
      : levelHash(found)
  return { hash, rules: rel.rules }
}

// Хеши внутри выпуска считаются по его же содержимому, а не по библиотеке:
// в библиотеке лежит черновик, и он к выпуску отношения не имеет.
const chapterHashOf = (rel, ch) => {
  const levels = ch.nodes.map((n) => `${n.levelId}:${levelHash(levelFrom(rel, n.levelId))}`).sort()
  const edges = ch.edges.map((e) => `${e.from}>${e.to}`).sort()
  return fnv(stable({ id: ch.id, levels, edges }))
}
const storyHashOf = (rel) =>
  fnv(stable({
    id: rel.story.id,
    chapters: rel.story.chapters.map((c) => `${c}:${chapterHashOf(rel, chapterFrom(rel, c))}`),
  }))

// --- релизы -------------------------------------------------------------------
// Черновик правится сколько угодно и рекордов не имеет: пока автор двигает
// камни, соревноваться не в чем. Релиз — снимок содержимого, замороженный
// целиком: он больше не меняется никогда, и правка после релиза создаёт
// следующий, а не переписывает прошлый. Рекорды и записи привязаны к релизу.
//
// Так решается то, о чём вы говорили: если поправить один уровень внутри
// выпущенной главы, это не «тихо другая глава» — это новый номер релиза,
// у которого своя таблица рекордов, а старая остаётся при старом релизе.

const RELEASES = 'goo.releases.v1'

const all = () => { try { return JSON.parse(localStorage.getItem(RELEASES)) || [] } catch { return [] } }
const put = (list) => localStorage.setItem(RELEASES, JSON.stringify(list))

// Снимок берётся глубоким копированием: релиз обязан пережить любые
// дальнейшие правки библиотеки, поэтому ссылаться на её объекты нельзя.
export function publish(storyId, note = '') {
  const s = story(storyId)
  if (!s) return null
  const lib = library()
  const chapters = s.chapters.map(chapter).filter(Boolean)
  const levelIds = new Set(chapters.flatMap((c) => c.nodes.map((n) => n.levelId)))
  const list = all()
  const prev = list.filter((r) => r.storyId === storyId)
  const rel = {
    id: `rel-${storyId}-${prev.length + 1}`,
    storyId,
    version: prev.length + 1,           // «увеличенная цифра», как вы и просили
    at: Date.now(),
    note,
    rules: RULES_VERSION,
    hash: storyHash(s),
    // содержимое целиком, а не ссылки: релиз самодостаточен
    story: structuredClone(s),
    chapters: structuredClone(chapters),
    levels: structuredClone(lib.levels.filter((l) => levelIds.has(l.id))),
  }
  list.push(rel)
  put(list)
  return rel
}

export const releases = (storyId) =>
  all().filter((r) => !storyId || r.storyId === storyId).sort((a, b) => b.version - a.version)

export const release = (id) => all().find((r) => r.id === id) || null

export const latestRelease = (storyId) => releases(storyId)[0] || null

// Уровень берётся из релиза, а не из живой библиотеки: играя релиз, игрок
// играет именно то, что было выпущено, даже если автор уже правит следующий.
export function levelFrom(rel, levelId) {
  return rel?.levels.find((l) => l.id === levelId) || null
}
export function chapterFrom(rel, chapterId) {
  return rel?.chapters.find((c) => c.id === chapterId) || null
}

// Изменился ли черновик с последнего релиза — автору видно, что есть что
// выпускать, а игроку, что он смотрит не самое свежее.
export function drifted(storyId) {
  const rel = latestRelease(storyId)
  if (!rel) return true
  return rel.hash !== storyHash(story(storyId))
}
