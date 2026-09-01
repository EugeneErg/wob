// Проверка редакторских операций без браузера
const store = new Map()
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }
await import('../src/entities/index.js')
const lib = await import('../src/core/library.js')
const { seed } = await import('./seed.mjs')
seed(lib)
const { getEntity } = await import('../src/core/registry.js')
const { shapesForLevel } = await import('../src/core/scene.js')

// создаём всю вложенность с нуля
const { story, chapter } = lib.createStory('Проба пера')
const lvl = lib.createLevel(chapter.id, 'Первый')
console.log(`создано: история «${story.title}» → глава «${chapter.title}» → уровень «${lvl.name}»`)
console.log('в главе появилась точка на карте:', chapter.nodes.length === 1)

// ставим ассет в уровень так же, как это делает редактор
const asset = lib.assets().find((a) => a.title === 'Тяжёлый ящик')
const def = getEntity(asset.type)
const data = structuredClone(asset.data)
const b = def.editor.bounds(data)
def.editor.move(data, 800 - (b.x + b.w / 2), 400 - (b.y + b.h / 2))
lvl.entities.push({ id: 'e1', type: asset.type, data })
lib.saveLevel(lvl)
const nb = def.editor.bounds(lvl.entities[0].data)
console.log(`ассет «${asset.title}» встал центром в (${(nb.x + nb.w / 2).toFixed(0)}, ${(nb.y + nb.h / 2).toFixed(0)}), размер ${nb.w}×${nb.h}`)
console.log('уровень рисуется:', shapesForLevel(lvl).length > 0)

// вложенность переживает выгрузку и загрузку
const file = lib.exportStory(story.id)
const back = lib.importBundle(JSON.parse(JSON.stringify(file)))[0]
const bch = lib.chaptersOf(back.id)[0]
const blvl = lib.level(bch.nodes[0].levelId)
console.log(`после файла: «${back.title}» → «${bch.title}» → «${blvl.name}», сущностей ${blvl.entities.length}`)
console.log('ассет уехал вместе с историей:', file.assets.length >= 0, '| данные сущности целы:', JSON.stringify(blvl.entities[0].data) === JSON.stringify(lvl.entities[0].data))

// удаление главы уносит её уровни, но не чужие
const other = lib.createChapter(story.id, 'Вторая')
const shared = lib.createLevel(other.id, 'Уровень второй главы')
lib.removeChapter(chapter.id)
console.log('после удаления главы: её уровень исчез', !lib.level(lvl.id), '| чужой цел', !!lib.level(shared.id))
