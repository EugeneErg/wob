// В node нет localStorage — подставляем простейший
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const lib = await import('../src/core/library.js')

// --- встроенное содержимое ---
const s = lib.stories()[0]
const chs = lib.chaptersOf(s.id)
console.log(`история «${s.title}»: ${chs.length} главы, уровней ${chs.reduce((n, c) => n + c.nodes.length, 0)}`)
const orphans = lib.library().chapters.flatMap((c) => c.nodes).filter((n) => !lib.level(n.levelId))
console.log('точки без уровней:', orphans.length, '(должно быть 0)')

// --- открытие уровней по мере прохождения ---
const ch1 = chs[0], ch2 = chs[1]
const [a, b] = ch1.nodes.map((n) => n.levelId)
console.log(`\nсначала: «${lib.level(a).name}» открыт ${lib.levelOpen(ch1, a)}, «${lib.level(b).name}» открыт ${lib.levelOpen(ch1, b)}`)
console.log(`тропинка между ними видна: ${lib.edgeVisible(ch1.edges[0])} (ещё нет)`)
console.log(`вторая глава открыта: ${lib.chapterOpen(s.id, ch2.id)} (ещё нет)`)

lib.markDone(a)
console.log(`\nпосле первого уровня: второй открыт ${lib.levelOpen(ch1, b)}, тропинка видна ${lib.edgeVisible(ch1.edges[0])}`)
console.log(`вторая глава открыта: ${lib.chapterOpen(s.id, ch2.id)} (ещё нет — глава не пройдена)`)
lib.markDone(b)
console.log(`после всей главы: глава пройдена ${lib.chapterDone(ch1)}, вторая открыта ${lib.chapterOpen(s.id, ch2.id)}`)

// --- развилка: два пути из одной точки ---
const fork = lib.createChapter(s.id, 'Развилка')
const l0 = lib.createLevel(fork.id, 'Старт')
const l1 = lib.createLevel(fork.id, 'Левый путь')
const l2 = lib.createLevel(fork.id, 'Правый путь')
fork.edges = [{ from: l0.id, to: l1.id }, { from: l0.id, to: l2.id }]
lib.save()
console.log(`\nразвилка: старт открыт ${lib.levelOpen(fork, l0.id)}, ветки ${lib.levelOpen(fork, l1.id)}/${lib.levelOpen(fork, l2.id)}`)
lib.markDone(l0.id)
console.log(`после старта обе ветки открылись: ${lib.levelOpen(fork, l1.id) && lib.levelOpen(fork, l2.id)}`)

// --- горячие ассеты складываются по трём уровням ---
const mk = (t) => lib.createAsset({ type: 'game-ball', title: t, data: { x: 0, y: 0, r: 13 } })
const aS = mk('от истории'), aC = mk('от главы'), aL = mk('от уровня')
const lvlId = ch2.nodes[0].levelId
lib.toggleHot('story', s.id, aS.id)
lib.toggleHot('chapter', ch2.id, aC.id)
lib.toggleHot('level', lvlId, aL.id)
const hot = lib.hotAssets({ storyId: s.id, chapterId: ch2.id, levelId: lvlId })
const mine = hot.filter((h) => h.title.startsWith('от '))
console.log(`\nгорячие в уровне: ${hot.map((h) => h.title).join(', ')}`)
console.log('порядок «уровень → глава → история»:', mine.map((m) => m.title).join(' → ') === 'от уровня → от главы → от истории')
lib.toggleHot('level', lvlId, aL.id)
console.log('повторное нажатие снимает:', !lib.hotAssets({ storyId: s.id, chapterId: ch2.id, levelId: lvlId }).some((h) => h.id === aL.id))

// --- файлы ---
const bundle = lib.exportStory(s.id)
console.log(`\nэкспорт истории: глав ${bundle.chapters.length}, уровней ${bundle.levels.length}, ассетов ${bundle.assets.length}`)
const before = lib.stories().length
const added = lib.importBundle(JSON.parse(JSON.stringify(bundle)))
console.log(`импорт того же файла: историй было ${before}, стало ${lib.stories().length}, добавлено «${added[0].title}»`)
const copy = lib.stories().at(-1)
console.log('id не столкнулись:', copy.id !== s.id)
console.log('уровни скопировались, а не переиспользовались:',
  lib.chaptersOf(copy.id)[0].nodes[0].levelId !== chs[0].nodes[0].levelId)
console.log('прогресс к копии не прилип:', !lib.isDone(lib.chaptersOf(copy.id)[0].nodes[0].levelId))

// глава отдельным файлом
const chBundle = lib.exportChapter(ch2.id)
const added2 = lib.importBundle(JSON.parse(JSON.stringify(chBundle)))
console.log(`\nглава отдельным файлом: приютом стала история «${added2[0].title}» с ${lib.chaptersOf(added2[0].id).length} главой`)

try { lib.importBundle({ hello: 'world' }) } catch (e) { console.log('чужой файл отвергнут:', e.message) }
