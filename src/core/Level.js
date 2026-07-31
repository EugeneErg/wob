// core/Level.js
//
// Единственное состояние уровня. Ни редактор, ни игра, ни физика не хранят
// сущности сами — все читают/пишут через этот объект. Это то место, где
// удобно завести и "связи" (bonds) — они не относятся к конкретной сущности,
// это межсущностная концепция, управляемая свойством PROP.BONDABLE.

import { reactive } from 'vue'
import { getEntityDefinition } from './EntityRegistry.js'
import { readProperty, PROP } from './GlobalProperties.js'
import { VerletStick } from './verlet.js'

let uid = 0
function nextId(type) {
  uid += 1
  return `${type}_${uid}_${Date.now().toString(36)}`
}

export function createLevel() {
  const state = reactive({
    entities: [], // [{ id, type, state, points?, sticks?, collisionShape? }]
    connections: [], // [{ id, aId, bId }] — только между bondable сущностями
  })

  function addEntity(type, initProps) {
    const definition = getEntityDefinition(type)
    if (!definition) throw new Error(`[Level] Неизвестная сущность "${type}"`)
    const id = nextId(type)
    const instance = definition.createInstance(id, initProps)
    state.entities.push(instance)
    return instance
  }

  function removeEntity(id) {
    const idx = state.entities.findIndex((e) => e.id === id)
    if (idx === -1) return
    state.entities.splice(idx, 1)
    state.connections = state.connections.filter((c) => c.aId !== id && c.bId !== id)
  }

  function getInstance(id) {
    return state.entities.find((e) => e.id === id)
  }

  function getDefinition(id) {
    const inst = getInstance(id)
    return inst && getEntityDefinition(inst.type)
  }

  /** Список [{instance, definition}] — то, что нужно PhysicsWorld/рендеру */
  function getEntitiesWithDefs() {
    return state.entities.map((instance) => ({
      instance,
      definition: getEntityDefinition(instance.type),
    }))
  }

  function connectionExists(aId, bId) {
    return state.connections.some(
      (c) => (c.aId === aId && c.bId === bId) || (c.aId === bId && c.bId === aId)
    )
  }

  /** Создаёт связь между двумя bondable-сущностями, либо снимает, если уже есть */
  function toggleConnection(aId, bId) {
    if (aId === bId) return
    const a = getInstance(aId)
    const b = getInstance(bId)
    const defA = getEntityDefinition(a.type)
    const defB = getEntityDefinition(b.type)
    if (!readProperty(a, defA, PROP.BONDABLE) || !readProperty(b, defB, PROP.BONDABLE)) return
    if (connectionExists(aId, bId)) {
      removeConnection(aId, bId)
      return
    }
    if (!a.points?.length || !b.points?.length) return
    const stick = new VerletStick(a.points[0], b.points[0], { stiffness: 1, breakable: true, maxStretch: 2.2 })
    const id = `bond_${aId}_${bId}`
    state.connections.push({ id, aId, bId, stick })
    // держим стик в sticks инициатора — так PhysicsWorld удовлетворяет его один раз за суб-шаг
    a.sticks?.push(stick)
  }

  function removeConnection(aId, bId) {
    const idx = state.connections.findIndex(
      (c) => (c.aId === aId && c.bId === bId) || (c.aId === bId && c.bId === aId)
    )
    if (idx === -1) return
    const [conn] = state.connections.splice(idx, 1)
    const a = getInstance(conn.aId)
    if (a?.sticks) {
      a.sticks = a.sticks.filter((s) => s !== conn.stick)
    }
  }

  /** Убираем связи, помеченные VerletStick как разорванные (растяжение сверх лимита) */
  function pruneBrokenConnections() {
    const broken = state.connections.filter((c) => c.stick.broken)
    broken.forEach((c) => removeConnection(c.aId, c.bId))
  }

  return {
    state,
    addEntity,
    removeEntity,
    getInstance,
    getDefinition,
    getEntitiesWithDefs,
    toggleConnection,
    removeConnection,
    connectionExists,
    pruneBrokenConnections,
  }
}
