// Сквозное прохождение истории: то, что делает App.vue, без интерфейса.
// Проверяем на встроенной библиотеке, а не на выдуманном графе.

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { check } = await import('./assert.mjs')
const lib = await import('../src/core/library.js')
const {
  ChainRun, doneByChapter, openChapters, entryChapters, finalChapters,
  storyCategoryOf, storyPercent, openNodes, categoryOf,
} = await import('../src/core/chain.js')
const { saveRun, runsFor, bestRun, formatTime, KIND } = await import('../src/core/replays.js')

lib.resetLibrary()
const st = lib.stories()[0]
const chapters = lib.chaptersOf(st.id)
console.log(`история «${st.title}»: глав ${chapters.length}`)

// Связываем главы в цепочку: выход каждой ведёт в следующую
for (let i = 0; i < chapters.length - 1; i++) {
  const c = chapters[i]
  const last = c.nodes.find((n) => !c.edges.some((e) => e.from === n.levelId))
  last.next = chapters[i + 1].id
}
lib.save()
console.log('начальные главы:', entryChapters(st, chapters).map((id) => lib.chapter(id).title).join(', '))
console.log('концы истории:', finalChapters(st, chapters).map((id) => lib.chapter(id).title).join(', '))

const seg = (ticks, finished = true) => ({ ticks, finished, seed: 1, rate: 60, input: [], camera: [], checks: [] })

// Проходим историю целиком, как её вёл бы App
const run = new ChainRun({ kind: KIND.STORY, targetId: st.id })
let guard = 0
console.log('\nход попытки:')
while (guard++ < 40) {
  const map = doneByChapter(run)
  const open = openChapters(st, chapters, map)
  // берём первую главу, которая ещё не пройдена
  const ch = chapters.find((c) => open.includes(c.id) && !categoryOf(c, map.get(c.id) || new Set()))
  if (!ch) break
  const done = map.get(ch.id) || new Set()
  const next = openNodes(ch, done).find((id) => !done.has(id))
  if (!next) break
  run.push(seg(300), { levelId: next, chapterId: ch.id, hash: 'h' })
  console.log(`  ${ch.title} / ${lib.level(next).name} — всего ${formatTime(run.ticks)}`)
  if (storyCategoryOf(st, chapters, doneByChapter(run))) break
}

const map = doneByChapter(run)
const cat = storyCategoryOf(st, chapters, map)
console.log('\nитог:')
console.log('  категория истории:', cat)
console.log('  пройдено глав:', storyPercent(st, chapters, map) + '%')
console.log('  игровое время:', formatTime(run.ticks), `(${run.segments.length} заходов)`)

const snap = run.snapshot()
const rec = await saveRun(snap, { kind: KIND.STORY, targetId: st.id, category: cat, speedrun: true })
console.log('\nзапись истории сохранена:')
console.log('  вид:', rec.kind, '| категория:', rec.category, '| завершена:', rec.finished)
console.log('  сегментов:', rec.segments.length)
console.log('  сегменты знают главу:', rec.segments.every((g) => !!g.chapterId))
const best = await bestRun(st.id, { kind: KIND.STORY })
console.log('  попыток истории:', (await runsFor(st.id, { kind: KIND.STORY })).length,
  '| лучшее:', best ? formatTime(best.ticks) : 'нет')

// Записи истории и главы не смешиваются: это разные состязания
const chRuns = await runsFor(chapters[0].id, { kind: KIND.CHAPTER })
console.log('\nпопытка истории не засчиталась как попытка главы:', chRuns.length === 0)


// --- брошенная история -------------------------------------------------------
const quit = new ChainRun({ kind: KIND.STORY, targetId: st.id })
quit.push(seg(300), { levelId: chapters[0].nodes[0].levelId, chapterId: chapters[0].id })
const qRec = await saveRun(quit.snapshot(), {
  kind: KIND.STORY, targetId: st.id, speedrun: true, category: null,
})
check('брошенная история записана', !!qRec.id && qRec.finished === false)
const bestAfter = await bestRun(st.id, { kind: KIND.STORY })
check('рекорд истории от неё не пострадал', bestAfter && bestAfter.id !== qRec.id,
  bestAfter ? formatTime(bestAfter.ticks) : 'нет')
check('её сегменты помнят главу', qRec.segments.every((g) => !!g.chapterId))


// --- линейная история не заканчивается после первой главы -------------------
// Случай из жизни: во встроенной библиотеке привязок next нет вовсе, и правило
// «конец истории — глава, из которой никуда не ведёт» объявляло концом каждую.
// Игрок проходил первую главу и получал зачёт за всю историю.
lib.resetLibrary()
const st2 = lib.stories()[0]
const chs2 = lib.chaptersOf(st2.id)
check('во встроенной библиотеке привязок нет',
  !chs2.some((c) => c.nodes.some((n) => n.next)))
check('концом считается только последняя глава по составу',
  finalChapters(st2, chs2).length === 1 && finalChapters(st2, chs2)[0] === st2.chapters.at(-1),
  finalChapters(st2, chs2).join(','))

const one = new ChainRun({ kind: KIND.STORY, targetId: st2.id })
for (const n of chs2[0].nodes) one.push(seg(300), { levelId: n.levelId, chapterId: chs2[0].id })
const m1 = doneByChapter(one)
check('первая глава пройдена на 100%', categoryOf(chs2[0], m1.get(chs2[0].id)) === '100')
check('но история ещё не пройдена', storyCategoryOf(st2, chs2, m1) === null)
check('и следующая глава открылась',
  openChapters(st2, chs2, m1).includes(chs2[1].id))

for (const n of chs2[1].nodes) one.push(seg(300), { levelId: n.levelId, chapterId: chs2[1].id })
const m2 = doneByChapter(one)
check('после последней главы история пройдена', storyCategoryOf(st2, chs2, m2) === '100')
