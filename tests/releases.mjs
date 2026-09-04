// Выпуски: сырое не попадает в бой.
//
// Черновик автора правится в любой момент, поэтому соревноваться по нему
// нельзя — сегодня уровень один, завтра другой. Выпуск замораживает снимок
// целиком: он больше не меняется, и записи по нему сравнимы между собой.
const store = new Map()
globalThis.localStorage = {
  get length() { return store.size },
  key: (i) => [...store.keys()][i],
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { check } = await import('./assert.mjs')
const lib = await import('../src/core/library.js')
const { seed } = await import('./seed.mjs')
seed(lib)
const {
  publish, releases, latestRelease, drifted, release, levelFrom, _chapterFrom,
  _storyHash, levelHash, checkRecord, seedFor,
} = await import('../src/core/releases.js')
const { saveRun, _bestRun, KIND } = await import('../src/core/replays.js')
const { contentFor } = await import('../src/core/content.js')

seed(lib)
const st = lib.stories()[0]
const ch = lib.chaptersOf(st.id)[0]
const lvlId = ch.nodes[0].levelId

check('пока выпусков нет, черновик считается разошедшимся', drifted(st.id))
check('и последнего выпуска тоже нет', latestRelease(st.id) === null)

// --- выпускаем ---------------------------------------------------------------
const v1 = publish(st.id, 'первая версия')
check('выпуск создан с номером 1', v1.version === 1)
check('после выпуска черновик совпадает с ним', !drifted(st.id))
check('выпуск несёт содержимое, а не ссылки',
  v1.levels.length > 0 && v1.chapters.length > 0 && !!v1.story)

const frozen = levelFrom(v1, lvlId)
const goalBefore = frozen.goal
const hashBefore = levelHash(frozen)

// --- автор правит черновик ---------------------------------------------------
const draft = lib.level(lvlId)
draft.goal = (draft.goal || 1) + 5
draft.entities.push({
  id: 'новый', type: 'terrain',
  data: { points: [[10, 10], [60, 10], [60, 60], [10, 60]], smoothness: 0.3, fill: '#2a3326', edge: '#66804f' },
})
lib.save()

check('черновик снова разошёлся с выпуском', drifted(st.id))
check('в выпуске уровень не изменился', levelFrom(release(v1.id), lvlId).goal === goalBefore,
  `в выпуске ${levelFrom(release(v1.id), lvlId).goal}, в черновике ${lib.level(lvlId).goal}`)
check('и отпечаток выпущенного уровня прежний', levelHash(levelFrom(release(v1.id), lvlId)) === hashBefore)
check('а у черновика отпечаток другой', levelHash(lib.level(lvlId)) !== hashBefore)

// Сид считается из содержимого, значит у выпуска и черновика он тоже разный —
// это правильно: уровни разные, и случайность у них своя.
check('сид выпуска не совпал с сидом изменённого черновика',
  seedFor(levelFrom(release(v1.id), lvlId)) !== seedFor(lib.level(lvlId)))

// --- второй выпуск -----------------------------------------------------------
const v2 = publish(st.id, 'после правки')
check('номер увеличился', v2.version === 2)
check('выпусков стало два, свежий первым', releases(st.id).length === 2 && releases(st.id)[0].version === 2)
check('первый выпуск не переписан', levelFrom(release(v1.id), lvlId).goal === goalBefore)
check('во втором лежит правка', levelFrom(release(v2.id), lvlId).goal === goalBefore + 5)
check('отпечатки выпусков отличаются', v1.hash !== v2.hash)

// --- записи привязаны к выпуску ---------------------------------------------
// Запись хранит ссылку на версию, а снимок по ней отдаёт хранилище содержимого.
const rec = await saveRun(
  { levelId: lvlId, seed: 1, rate: 60, ticks: 300, finished: true, input: [0, 0, 1, 2], camera: [], checks: [] },
  { kind: KIND.LEVEL, targetId: lvlId, releaseId: v1.id },
)
check('запись помнит, какой выпуск играли', rec.releaseId === v1.id)

const back = await contentFor(rec)
check('по записи достаётся содержимое ТОГО выпуска, а не нынешний черновик',
  back && back.goal === goalBefore, back ? `goal ${back.goal}` : 'не нашлось')

// --- черновик соревнованием не считается ------------------------------------
const draftRec = await saveRun(
  { levelId: lvlId, seed: 1, rate: 60, ticks: 200, finished: true, input: [0, 0, 1, 2], camera: [], checks: [] },
  { kind: KIND.LEVEL, targetId: lvlId },   // без releaseId — черновик
)
check('запись по черновику тоже сохраняется', !!draftRec.id)

// Правим черновик ещё раз — запись по нему устаревает сразу же
lib.level(lvlId).goal += 1
lib.save()
check('запись по черновику устарела после правки', checkRecord(draftRec).ok === false,
  checkRecord(draftRec).text)
// Запись по выпуску правки черновика не замечает: она ссылается на замороженный
// снимок, а не на то, что лежит в библиотеке сегодня.
const stillThere = await contentFor(rec)
check('запись по выпуску правкой черновика не задета',
  stillThere && stillThere.goal === goalBefore, stillThere ? `goal ${stillThere.goal}` : 'потерялась')
check('и в рекорды она по-прежнему годится', checkRecord(rec).ok)

// --- рекорды не смешиваются между версиями ----------------------------------
// Уровень во втором выпуске другой, значит и состязание другое: класть их
// в одну таблицу нельзя, даже если игрок один и тот же.
const v2rec = await saveRun(
  { levelId: lvlId, seed: 1, rate: 60, ticks: 100, finished: true, input: [0, 0, 1, 2], camera: [], checks: [] },
  { kind: KIND.LEVEL, targetId: lvlId, releaseId: v2.id },
)
check('запись по второму выпуску помнит свою версию', v2rec.releaseId === v2.id)
const v2content = await contentFor(v2rec)
check('и достаёт содержимое второго выпуска', v2content && v2content.goal === goalBefore + 5,
  v2content ? `goal ${v2content.goal}` : 'не нашлось')


// Обе записи «пройдены» и на своих версиях годны, но состязания разные:
// уровень во втором выпуске другой. Смешивать их в одну таблицу нельзя.
check('запись первого выпуска годна', checkRecord(rec).ok)
check('запись второго выпуска годна', checkRecord(v2rec).ok)
check('но версии у них разные, значит и таблицы разные',
  rec.releaseId !== v2rec.releaseId && rec.hash !== v2rec.hash,
  `${rec.hash} против ${v2rec.hash}`)

// Выпуск удалили (или его нет на этой машине) — сверять не с чем, и врать об
// этом нельзя: запись просто не годится в рекорды.
const orphan = { ...rec, releaseId: 'rel-которого-нет' }
check('запись на исчезнувший выпуск в рекорды не идёт', checkRecord(orphan).ok === false,
  checkRecord(orphan).text)
