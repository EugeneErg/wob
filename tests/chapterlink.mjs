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
const lib = await import('../src/core/library.js')
const { deadEnds, exitNodes, needsRouting, isAnyPercent, categoryOf } = await import('../src/core/chain.js')

lib.resetLibrary()

// Две главы: из первой выход во вторую
const { story } = lib.createStory('Проверка')
const a = lib.createChapter(story.id, 'Первая')
const b = lib.createChapter(story.id, 'Вторая')
const l1 = lib.createLevel(a.id, 'Развилка')
const l2 = lib.createLevel(a.id, 'Настоящий конец')
const l3 = lib.createLevel(a.id, 'Боковой тупик')

// createLevel связывает уровни в цепочку — уберём лишнее и сделаем развилку
a.edges = [{ from: l1.id, to: l2.id }, { from: l1.id, to: l3.id }]
lib.save()

console.log('до привязки:')
console.log('  тупиков:', deadEnds(a).length, '| выходов:', exitNodes(a).length)
console.log('  главе нужна рука автора:', needsRouting(a))
console.log('  зачёт за настоящий конец:', categoryOf(a, new Set([l1.id, l2.id])), '(нет: концы неразличимы)')

// Автор привязывает продолжение к настоящему концу
a.nodes.find((n) => n.levelId === l2.id).next = b.id
lib.save()

console.log('\nпосле привязки:')
console.log('  выходов:', exitNodes(a).length, '| тупиков:', deadEnds(a).map((id) => lib.level(id).name).join(', '))
console.log('  через настоящий конец:', categoryOf(a, new Set([l1.id, l2.id])))
console.log('  через тупик:', categoryOf(a, new Set([l1.id, l3.id])), '(тупик главу не завершает)')

// --- цель привязки удалена ---------------------------------------------------
lib.removeChapter(b.id)
const a2 = lib.chapter(a.id)
console.log('\nпосле удаления главы, в которую вели:')
check('удалили главу — привязка на неё снята', !a2.nodes.some((n) => n.next))
console.log('  узел снова тупик:', deadEnds(a2).length === 2)
console.log('  и зачёта больше нет:', isAnyPercent(a2, new Set([l1.id, l2.id])) === false)

// --- импорт с переименованием ------------------------------------------------
// Возвращаем привязку и выгружаем историю, потом ввозим её обратно: id
// столкнутся и будут переименованы. Привязка обязана указывать на ввезённую
// главу, а не на прежнюю.
const b2 = lib.createChapter(story.id, 'Вторая снова')
lib.chapter(a.id).nodes.find((n) => n.levelId === l2.id).next = b2.id
lib.save()

const bundle = JSON.parse(JSON.stringify(lib.exportStory(story.id)))
const added = lib.importBundle(bundle)
const copyStory = added[0]
const copyChapters = lib.chaptersOf(copyStory.id)
const copyA = copyChapters.find((c) => c.title === 'Первая')
const link = copyA.nodes.find((n) => n.next)

console.log('\nпосле экспорта и ввоза обратно:')
console.log('  привязка приехала:', !!link)
check('после ввоза привязка ведёт во ввезённую главу, а не в исходную',
  link.next !== b2.id && copyChapters.some((c) => c.id === link.next))
console.log('  цель существует:', !!lib.chapter(link.next))

// --- ввезли главу без её продолжения ----------------------------------------
// Выгружаем ТОЛЬКО первую главу: та, в которую она выводит, в пакет не попадёт.
const onlyA = JSON.parse(JSON.stringify(lib.exportChapter(a.id)))
const added2 = lib.importBundle(onlyA)
const lone = lib.chaptersOf(added2[0].id)[0]
console.log('\nввезли главу без её продолжения:')
check('ввезли главу без продолжения — ссылка в никуда снята', !lone.nodes.some((n) => n.next))
console.log('  (автор привяжет заново — это честнее, чем выход в пустоту)')
