// Привязка узла к следующей главе — ссылка между главами. Проверяем не то,
// что её можно поставить, а что она не переживает свою цель и переживает
// переименование: висячая ссылка опаснее отсутствующей, потому что узел
// выглядит выходом и глава засчитывается пройденной по несуществующей дороге.

// Библиотека живёт в localStorage; в узле его нет, поэтому подменяем.
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { check } = await import('./assert.mjs')

// В проверках сервера нет, а имена выдаёт он. Считаем сами — так видно, что
// библиотека их только раскладывает, а не придумывает.
let minted = 0
const mint = (p) => `${p}-t${++minted}`
const lib = await import('../src/core/library.js')
const { seed } = await import('./seed.mjs')
seed(lib)
const { endingNodes, exitNodes, _isAnyPercent, categoryOf } = await import('../src/core/chain.js')

seed(lib)

// Две главы: из первой выход во вторую
const { story } = lib.createStory({ id: mint('story'), chapterId: mint('ch') }, 'Проверка')
const a = lib.createChapter(story.id, mint('ch'), 'Первая')
const b = lib.createChapter(story.id, mint('ch'), 'Вторая')
const l1 = lib.createLevel(a.id, { id: mint('lvl'), nodeId: mint('nd') }, 'Развилка')
const l2 = lib.createLevel(a.id, { id: mint('lvl'), nodeId: mint('nd') }, 'Настоящий конец')
const l3 = lib.createLevel(a.id, { id: mint('lvl'), nodeId: mint('nd') }, 'Боковой тупик')

// Точку ищем по уровню: здесь каждый уровень стоит в одном месте.
const nd = (ch, levelId) => ch.nodes.find((n) => n.levelId === levelId).id

// createLevel связывает точки в цепочку — сделаем развилку
a.nodes.find((n) => n.levelId === l1.id).next = [nd(a, l2.id), nd(a, l3.id)]
a.nodes.find((n) => n.levelId === l2.id).next = []
a.nodes.find((n) => n.levelId === l3.id).next = []
lib.save()

console.log('до связи наружу:')
console.log('  финалов:', endingNodes(a).length, '| выходов:', exitNodes(a).length)
console.log('  оба конца засчитываются:',
  categoryOf(a, new Set([nd(a, l1.id), nd(a, l2.id)])),
  categoryOf(a, new Set([nd(a, l1.id), nd(a, l3.id)])))

// Автор ведёт настоящий конец в следующую главу
const l4 = lib.createLevel(b.id, { id: mint('lvl'), nodeId: mint('nd') }, 'Продолжение')
a.nodes.find((n) => n.levelId === l2.id).next = [nd(lib.chapter(b.id), l4.id)]
lib.save()

console.log('\nпосле связи наружу:')
console.log('  выходов:', exitNodes(a).length, '| финалов:', endingNodes(a).map((id) => lib.level(a.nodes.find((n) => n.id === id).levelId).name).join(', '))

// --- цель связи удалена ------------------------------------------------------
lib.removeChapter(b.id)
const a2 = lib.chapter(a.id)
console.log('\nпосле удаления главы, в которую вели:')
check('удалили главу — связь на неё снята', !a2.nodes.some((n) => (n.next || []).length && n.levelId === l2.id))
console.log('  точка снова финал:', endingNodes(a2).length === 2)
check('и выходов из главы не осталось', exitNodes(a2).length === 0)

// --- ввоз с переименованием --------------------------------------------------
// Возвращаем связь наружу и выгружаем историю, потом ввозим её обратно: id
// столкнутся и будут переименованы. Связь обязана указывать на ввезённую точку,
// а не на прежнюю.
const b2 = lib.createChapter(story.id, mint('ch'), 'Вторая снова')
const l5 = lib.createLevel(b2.id, { id: mint('lvl'), nodeId: mint('nd') }, 'Продолжение снова')
lib.chapter(a.id).nodes.find((n) => n.levelId === l2.id).next = [nd(lib.chapter(b2.id), l5.id)]
lib.save()

const bundle = JSON.parse(JSON.stringify(lib.exportStory(story.id)))
const added = lib.importBundle(bundle)
const copyChapters = lib.chaptersOf(added[0].id)
const copyA = copyChapters.find((c) => c.title === 'Первая')
const link = copyA.nodes.find((n) => (n.next || []).length && !copyA.nodes.some((m) => m.id === n.next[0]))
const allCopyNodes = new Set(copyChapters.flatMap((c) => c.nodes.map((n) => n.id)))

console.log('\nпосле выгрузки и ввоза обратно:')
console.log('  связь приехала:', !!link)
check('после ввоза связь ведёт во ввезённую точку, а не в исходную',
  !!link && allCopyNodes.has(link.next[0]))
