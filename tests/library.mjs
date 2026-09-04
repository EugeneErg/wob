// В node нет localStorage — подставляем простейший
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const lib = await import('../src/core/library.js')

// В проверках сервера нет, а имена выдаёт он. Считаем сами — так видно, что
// библиотека их только раскладывает, а не придумывает.
let minted = 0
const mint = (p) => `${p}-t${++minted}`
const { seed } = await import('./seed.mjs')
seed(lib)

// Точку ищем по уровню: в этих проверках уровень стоит ровно в одном месте.
const nd = (ch, levelId) => ch.nodes.find((n) => n.levelId === levelId).id

// --- встроенное содержимое ---
const s = lib.stories()[0]
const chs = lib.chaptersOf(s.id)
console.log(`история «${s.title}»: ${chs.length} главы, уровней ${chs.reduce((n, c) => n + c.nodes.length, 0)}`)
const orphans = lib.library().chapters.flatMap((c) => c.nodes).filter((n) => !lib.level(n.levelId))
console.log('точки без уровней:', orphans.length, '(должно быть 0)')

// --- открытие уровней по мере прохождения ---
const ch1 = chs[0], ch2 = chs[1]
const [a, b] = ch1.nodes.map((n) => n.levelId)
console.log(`\nсначала: «${lib.level(a).name}» открыт ${lib.nodeOpen(ch1, nd(ch1, a))}, «${lib.level(b).name}» открыт ${lib.nodeOpen(ch1, nd(ch1, b))}`)
console.log(`тропинка между ними видна: ${lib.linkVisible(ch1, nd(ch1, a))} (ещё нет)`)
console.log(`вторая глава открыта: ${lib.chapterOpen(s.id, ch2.id)} (ещё нет)`)

lib.markDone(a)
console.log(`\nпосле первого уровня: второй открыт ${lib.nodeOpen(ch1, nd(ch1, b))}, тропинка видна ${lib.linkVisible(ch1, nd(ch1, a))}`)
console.log(`вторая глава открыта: ${lib.chapterOpen(s.id, ch2.id)} (ещё нет — глава не пройдена)`)
lib.markDone(b)
console.log(`после всей главы: глава пройдена ${lib.chapterDone(ch1)}, вторая открыта ${lib.chapterOpen(s.id, ch2.id)}`)

// --- развилка: два пути из одной точки ---
const fork = lib.createChapter(s.id, mint('ch'), 'Развилка')
const l0 = lib.createLevel(fork.id, { id: mint('lvl'), nodeId: mint('nd') }, 'Старт')
const l1 = lib.createLevel(fork.id, { id: mint('lvl'), nodeId: mint('nd') }, 'Левый путь')
const l2 = lib.createLevel(fork.id, { id: mint('lvl'), nodeId: mint('nd') }, 'Правый путь')
fork.edges = [{ from: l0.id, to: l1.id }, { from: l0.id, to: l2.id }]
lib.save()
console.log(`\nразвилка: старт открыт ${lib.nodeOpen(fork, nd(fork, l0.id))}, ветки ${lib.nodeOpen(fork, nd(fork, l1.id))}/${lib.nodeOpen(fork, nd(fork, l2.id))}`)
lib.markDone(l0.id)
console.log(`после старта обе ветки открылись: ${lib.nodeOpen(fork, nd(fork, l1.id)) && lib.nodeOpen(fork, nd(fork, l2.id))}`)

// --- горячие ассеты складываются по трём уровням ---
const mk = (t) => lib.createAsset({ id: mint('as'), type: 'game-ball', title: t, data: { x: 0, y: 0, r: 13 } })
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

// Глава без истории больше не усыновляется.
//
// Раньше обе стороны заводили ей историю-приют с придуманным названием. Названий
// система не выдумывает: какой истории принадлежит глава, знает только автор.
// А поскольку загрузки из файла больше нет, взяться такой главе неоткуда.
const chBundle = lib.exportChapter(ch2.id)
const added2 = lib.importBundle(JSON.parse(JSON.stringify(chBundle)))
console.log('\nистории для беспризорной главы не выдумано:', added2.length === 0)

try { lib.importBundle({ hello: 'world' }) } catch (e) { console.log('чужой файл отвергнут:', e.message) }
