import { getEntity } from './registry.js'
import { EntityContext, CONTEXT_MUTATORS } from './world.js'

// В редакторе рантайма нет, но shapes() получает контекст той же формы:
// читающие методы возвращают пустоту, меняющие мир — честно ругаются.
// tests/contract.mjs следит, чтобы этот список не отстал от EntityContext.
export function readOnlyContext(level, entity) {
  const ctx = {
    id: entity.id,
    gravity: level.gravity || { x: 0, y: 0 },
    // В редакторе мира нет, поэтому поле — одна его однородная составляющая.
    // Источники притяжения сущность и так знает по своим же данным (peers).
    gravityAt: () => ({ x: (level.gravity || {}).x || 0, y: (level.gravity || {}).y || 0 }),
    time: 0,
    bounds: { x: 0, y: 0, w: level.width || 0, h: level.height || 0 },
    pointer: null,
    signal: () => undefined,
    frame: 0,
    place: (x, y) => [x, y],
    dir: (x, y) => [x, y],
    placePoints: (pts) => pts,
    angle: 0,
    points: [],
    links: [],
    query: () => [],
    nearest: () => null,
    neighbors: () => [],
    solidAt: () => false,
    liquidAt: () => false,
    pathFrom: () => null,
    isBlocked: () => false,
    closestOnLinks: () => null,
    peers: () => (level.entities || [])
      .filter((o) => o.type === entity.type && o.id !== entity.id)
      .map((o) => ({ id: o.id, data: o.data, rt: null })),
    peer: (id) => {
      const o = (level.entities || []).find((q) => q.id === id && q.type === entity.type)
      return o ? { id: o.id, data: o.data, rt: null } : null
    },
  }
  for (const m of CONTEXT_MUTATORS) {
    ctx[m] = () => { throw new Error(`ctx.${m}() недоступен в редакторе: shapes() должна быть чистой`) }
  }
  return ctx
}

// имена, которые обязан покрывать заглушечный контекст
export const contextSurface = () => {
  const proto = EntityContext.prototype
  return Object.getOwnPropertyNames(proto).filter((k) => k !== 'constructor' && k !== 'owned')
}

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
    ctx: readOnlyContext(level, e),
  }))
  return composeShapes(items)
}
