import { getEntity } from './registry.js'

// Собирает фигуры со всех сущностей и раскладывает по слоям.
// Слой берётся из самой фигуры (s.layer), иначе — из z сущности.
// Порядок внутри слоя стабильный: кто раньше в списке, тот ниже.
export function composeShapes(items) {
  const acc = []
  for (const it of items) {
    if (!it.def) continue
    const base = it.def.z || 0
    const shapes = it.def.shapes(it.data, it.rt ?? null, it.ctx ?? null) || []
    for (const s of shapes) acc.push({ s, layer: s.layer ?? base, i: acc.length })
  }
  acc.sort((a, b) => a.layer - b.layer || a.i - b.i)
  return acc.map((v) => v.s)
}

// Статичное превью уровня (редактор, список уровней): рантайма нет.
export function shapesForLevel(level) {
  const items = (level.entities || []).map((e) => ({
    def: getEntity(e.type),
    data: e.data,
    rt: null,
    // тот же peers(), что и в игре, только без рантайма
    ctx: {
      id: e.id,
      peers: () => (level.entities || [])
        .filter((o) => o.type === e.type && o.id !== e.id)
        .map((o) => ({ id: o.id, data: o.data, rt: null })),
      peer: (id) => {
        const o = (level.entities || []).find((q) => q.id === id && q.type === e.type)
        return o ? { id: o.id, data: o.data, rt: null } : null
      },
    },
  }))
  return composeShapes(items)
}
