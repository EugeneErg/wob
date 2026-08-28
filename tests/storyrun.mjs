// История как граф глав. Проверяем маршруты, доступность и зачёт.
import { ChainRun, entryChapters, doneByChapter, openChapters, finalChapters,
  storyCategoryOf, storyPercent, categoryOf } from '../src/core/chain.js'
import { KIND, formatTime } from '../src/core/replays.js'
import { check } from './assert.mjs'

// История с развилкой:
//   Пролог ──▶ Развилка ──(мирный конец)──▶ Мирная ──▶ конец
//                       └─(тёмный конец)──▶ Тёмная ──▶ конец
// В каждой главе по паре уровней; выход главы — узел с привязкой next.
const ch = (id, levels, edges, exits = {}) => ({
  id,
  nodes: levels.map((l) => ({ levelId: l, ...(exits[l] ? { next: exits[l] } : {}) })),
  edges: edges.map(([from, to]) => ({ from, to })),
})

const chapters = [
  ch('prolog', ['p1', 'p2'], [['p1', 'p2']], { p2: 'razvilka' }),
  // в развилке две ветки, и каждая ведёт в свою главу
  ch('razvilka', ['r1', 'mir', 'tьma'], [['r1', 'mir'], ['r1', 'tьma']],
    { mir: 'mirnaya', 'tьma': 'temnaya' }),
  ch('mirnaya', ['m1', 'm2'], [['m1', 'm2']]),
  ch('temnaya', ['t1', 't2'], [['t1', 't2']]),
]
const story = { id: 'st', chapters: chapters.map((c) => c.id) }

console.log('начальные главы:', entryChapters(story, chapters).join(', '), '(в них никто не ведёт)')
console.log('концы истории:', finalChapters(story, chapters).join(', '), '(из них никуда не ведёт)')

const seg = (ticks, finished = true) => ({ ticks, finished, seed: 1, rate: 60, input: [], camera: [], checks: [] })

// --- прохождение мирной ветки ------------------------------------------------
const run = new ChainRun({ kind: KIND.STORY, targetId: 'st' })
const pass = (chapterId, levelId, ticks = 300) =>
  run.push(seg(ticks), { levelId, chapterId })

console.log('\nоткрыто в начале:', openChapters(story, chapters, doneByChapter(run)).join(', '))

pass('prolog', 'p1'); pass('prolog', 'p2')
console.log('после пролога открыто:', openChapters(story, chapters, doneByChapter(run)).join(', '))

pass('razvilka', 'r1')
console.log('внутри развилки — обе ветки на выбор, история пока не двигается:',
  openChapters(story, chapters, doneByChapter(run)).join(', '))

pass('razvilka', 'mir')   // пошли мирным концом
const afterFork = openChapters(story, chapters, doneByChapter(run))
console.log('вышли мирным концом — открылась:', afterFork.filter((c) => c === 'mirnaya').join(''))
check('вышли мирным концом — тёмная глава НЕ открылась', !afterFork.includes('temnaya'))

pass('mirnaya', 'm1'); pass('mirnaya', 'm2')

const doneMap = doneByChapter(run)
console.log('\nитог мирной ветки:')
check('одна ветка до конца — это any%', storyCategoryOf(story, chapters, doneMap) === 'any')
console.log('  пройдено глав:', storyPercent(story, chapters, doneMap) + '%')
console.log('  игровое время:', formatTime(run.ticks), `(${run.segments.length} заходов)`)
console.log('  тёмная глава не пройдена:', !categoryOf(chapters[3], doneMap.get('temnaya') || new Set()))

// --- 100%: нужно пройти все главы и все ветки --------------------------------
const full = new ChainRun({ kind: KIND.STORY, targetId: 'st' })
const passF = (chapterId, levelId) => full.push(seg(300), { levelId, chapterId })
for (const [c, l] of [
  ['prolog', 'p1'], ['prolog', 'p2'],
  ['razvilka', 'r1'], ['razvilka', 'mir'], ['razvilka', 'tьma'],
  ['mirnaya', 'm1'], ['mirnaya', 'm2'],
  ['temnaya', 't1'], ['temnaya', 't2'],
]) passF(c, l)

const fullMap = doneByChapter(full)
console.log('\n100%:')
check('все главы и все ветки — это 100%', storyCategoryOf(story, chapters, fullMap) === '100')
console.log('  пройдено глав:', storyPercent(story, chapters, fullMap) + '%')
console.log('  дольше, чем any%:', full.ticks > run.ticks,
  `(${formatTime(full.ticks)} против ${formatTime(run.ticks)})`)

// --- брошенная история -------------------------------------------------------
const quit = new ChainRun({ kind: KIND.STORY, targetId: 'st' })
quit.push(seg(300), { levelId: 'p1', chapterId: 'prolog' })
console.log('\nброшенная история:')
check('брошенная история зачёта не даёт', storyCategoryOf(story, chapters, doneByChapter(quit)) === null)
console.log('  но время записано:', formatTime(quit.ticks))

// --- сегменты помнят свою главу ----------------------------------------------
console.log('\nсегменты знают, к какой главе относятся:')
console.log(' ', run.segments.map((g) => `${g.chapterId}/${g.levelId}`).join(' → '))
