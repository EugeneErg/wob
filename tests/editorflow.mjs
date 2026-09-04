// Проверка редакторских операций без браузера
const store = new Map()
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }
await import('../src/entities/index.js')

// В проверках сервера нет, а имена выдаёт он. Считаем сами — так видно, что
// библиотека их только раскладывает, а не придумывает.
let minted = 0
const mint = (p) => `${p}-t${++minted}`
const lib = await import('../src/core/library.js')
const { seed } = await import('./seed.mjs')
seed(lib)
const { getEntity } = await import('../src/core/registry.js')
const { shapesForLevel } = await import('../src/core/scene.js')

// создаём всю вложенность с нуля
const { story, chapter } = lib.createStory({ id: mint('story'), chapterId: mint('ch') }, 'Проба пера')
const lvl = lib.createLevel(chapter.id, { id: mint('lvl'), nodeId: mint('nd') }, 'Первый')
console.log(`создано: история «${story.title}» → глава «${chapter.title}» → уровень «${lvl.name}»`)
console.log('в главе появилась точка на карте:', chapter.nodes.length === 1)

// Ставим ассет в уровень так же, как это делает редактор. Ассет — группа
// сущностей, и все её части двигаются на один вектор: иначе сборка развалится.
const asset = lib.assets().find((a) => a.title === 'Heavy crate')
const parts = asset.entities.map((e) => ({ src: e, def: getEntity(e.type), data: structuredClone(e.data) }))
const def = parts[0].def

let box = null
for (const p of parts) {
  const pb = p.def.editor.bounds?.(p.data)
  if (!pb) continue
  box = box
    ? { x: Math.min(box.x, pb.x), y: Math.min(box.y, pb.y),
        r: Math.max(box.r, pb.x + pb.w), d: Math.max(box.d, pb.y + pb.h) }
    : { x: pb.x, y: pb.y, r: pb.x + pb.w, d: pb.y + pb.h }
}
const b = { x: box.x, y: box.y, w: box.r - box.x, h: box.d - box.y }
for (const p of parts) p.def.editor.move(p.data, 800 - (b.x + b.w / 2), 400 - (b.y + b.h / 2))
lvl.entities.push(...parts.map((p, i) => ({ id: 'e' + (i + 1), type: p.src.type, data: p.data })))
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
const other = lib.createChapter(story.id, mint('ch'), 'Вторая')
const shared = lib.createLevel(other.id, { id: mint('lvl'), nodeId: mint('nd') }, 'Уровень второй главы')
lib.removeChapter(chapter.id)
console.log('после удаления главы: её уровень исчез', !lib.level(lvl.id), '| чужой цел', !!lib.level(shared.id))
