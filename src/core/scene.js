import { getEntity } from './registry.js'

// Собирает фигуры со всех сущностей и раскладывает по слоям.
// Слой берётся из самой фигуры (s.layer), иначе — из z сущности.
// Порядок внутри слоя стабильный: кто раньше в списке, тот ниже.
export function composeShapes(items) {
  const acc = []
  for (const it of items) {
    if (!it.def) continue
    const base = it.def.z || 0
    const shapes = it.def.shapes(it.data, it.rt ?? null) || []
    for (const s of shapes) acc.push({ s, layer: s.layer ?? base, i: acc.length })
  }
  acc.sort((a, b) => a.layer - b.layer || a.i - b.i)
  return acc.map((v) => v.s)
}

// Статичное превью уровня (редактор, список уровней): рантайма нет.
export function shapesForLevel(level) {
  return composeShapes((level.entities || []).map((e) => ({ def: getEntity(e.type), data: e.data, rt: null })))
}
