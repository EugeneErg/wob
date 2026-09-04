// Сквозной проход главы: то, что делает App.vue, но без интерфейса.
// Проверяем не отрисовку, а правила: что открыто, как копится время,
// когда даётся зачёт и чем спидран отличается от прохождения.

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { check } = await import('./assert.mjs')
const lib = await import('../src/core/library.js')
const { seed } = await import('./seed.mjs')
seed(lib)
const { ChainRun, categoryOf, openNodes } = await import('../src/core/chain.js')
const { saveRun, runsFor, bestRun, formatTime, KIND } = await import('../src/core/replays.js')

seed(lib)
const story = lib.stories()[0]
const chapters = lib.chaptersOf(story.id)
const ch = chapters[0]
const links = ch.nodes.reduce((n, x) => n + (x.next || []).length, 0)
console.log(`глава «${ch.title}»: точек ${ch.nodes.length}, связей ${links}`)

// Встроенная библиотека уже сшита: последняя точка главы ведёт в первую точку
// следующей. Отдельно привязывать нечего.
const out = ch.nodes.find((n) => (n.next || []).some((c) => !ch.nodes.some((m) => m.id === c)))
if (out) console.log(`выход главы: «${lib.level(out.levelId).name}» → «${chapters[1].title}»`)

// --- прохождение главы, как его ведёт App -----------------------------------
const seg = (ticks, finished = true) => ({ ticks, finished, seed: 1, rate: 60, input: [], camera: [], checks: [] })

const run = new ChainRun({ kind: KIND.CHAPTER, targetId: ch.id })
console.log('\nход попытки:')
let guard = 0
while (guard++ < 20) {
  const open = openNodes(ch, run.done, { chapters }).filter((id) => !run.done.has(id))
  if (!open.length) break
  const node = ch.nodes.find((n) => n.id === open[0])
  const name = lib.level(node.levelId).name
  // первый заход на вторую точку проваливаем — время всё равно идёт
  if (node.id === ch.nodes[1]?.id && !run.attempts(node.levelId)) {
    run.push(seg(150, false), { levelId: node.levelId, nodeId: node.id })
    console.log(`  ${name}: слил, +${formatTime(150)}, всего ${formatTime(run.ticks)}`)
    continue
  }
  run.push(seg(300), { levelId: node.levelId, nodeId: node.id })
  console.log(`  ${name}: прошёл, всего ${formatTime(run.ticks)}`)
  if (categoryOf(ch, run.done)) break
}

const cat = categoryOf(ch, run.done)
console.log('\nитог:')
console.log('  категория:', cat)
console.log('  игровое время:', formatTime(run.ticks), `(${run.segments.length} заходов)`)
console.log('  провальный заход в сумме:', run.ticks === run.segments.reduce((s, g) => s + g.ticks, 0))

// --- запись попытки главы ----------------------------------------------------
const snap = run.snapshot()
const rec = await saveRun(snap, { kind: KIND.CHAPTER, targetId: ch.id, category: cat, speedrun: true })
console.log('\nзапись главы сохранена:')
console.log('  вид:', rec.kind, '| категория:', rec.category, '| спидран:', rec.speedrun)
console.log('  сегментов внутри:', rec.segments.length)
console.log('  отпечаток версии есть:', !!rec.hash)

const all = await runsFor(ch.id, { kind: KIND.CHAPTER })
const best = await bestRun(ch.id, { kind: KIND.CHAPTER })
console.log('  попыток главы в хранилище:', all.length, '| лучшее:', best ? formatTime(best.ticks) : 'нет')

// --- спидран не пользуется общим прогрессом ----------------------------------
// Отмечаем в общем сохранении, что первый уровень пройден когда-то раньше.
// Обычная карта это учтёт, а попытка спидрана — нет: у неё свой прогресс.
lib.markDone(ch.nodes[0].levelId)
const fresh = new ChainRun({ kind: KIND.CHAPTER, targetId: ch.id })
const openForRun = openNodes(ch, fresh.done, { chapters })
const openForSave = ch.nodes.filter((n) => lib.nodeOpen(ch, n.id)).map((n) => n.id)
console.log('\nстарое сохранение не открывает главу с середины:')
console.log('  открыто в новой попытке:', openForRun.length, 'точк(и)')
console.log('  открыто по общему прогрессу:', openForSave.length)
console.log('  попытка строже:', openForRun.length <= openForSave.length)


// --- брошенная попытка тоже записывается ------------------------------------
// Неудачный прогон интереснее для разбора, чем удачный: по нему видно, где
// попытка развалилась. Но в зачёт он не идёт — категории нет, значит и
// пройденным он не считается.
const quit = new ChainRun({ kind: KIND.CHAPTER, targetId: ch.id })
quit.push(seg(300), { levelId: ch.nodes[0].levelId, chapterId: ch.id, hash: 'h' })
quit.push(seg(90, false), { levelId: ch.nodes[1].levelId, chapterId: ch.id, hash: 'h' })

const quitRec = await saveRun(quit.snapshot(), {
  kind: KIND.CHAPTER, targetId: ch.id, speedrun: true, category: null,
})

check('брошенная попытка сохранена', !!quitRec.id)
check('но пройденной не считается', quitRec.finished === false)
check('и категории у неё нет', !quitRec.category || quitRec.category === 'any')
check('время в ней записано', quitRec.ticks === 390, `${quitRec.ticks} тиков`)
check('её заходы можно пересмотреть', quitRec.segments.length === 2)

const all2 = await runsFor(ch.id, { kind: KIND.CHAPTER })
check('в списке попыток она есть', all2.some((r) => r.id === quitRec.id), `всего попыток ${all2.length}`)

const best2 = await bestRun(ch.id, { kind: KIND.CHAPTER })
check('в рекорды брошенная не попала', best2 && best2.id !== quitRec.id,
  best2 ? `лучшее ${formatTime(best2.ticks)}` : 'рекорда нет')
check('и рекорд не испортился, хотя брошенная короче',
  best2.ticks > quitRec.ticks, `${best2.ticks} против ${quitRec.ticks}`)
