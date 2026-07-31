// core/Level.js

import { reactive } from 'vue'
import { getEntityDefinition } from './EntityRegistry.js'
import { readProperty, PROP } from './GlobalProperties.js'
import { VerletStick, distance } from './verlet.js'

let uid = 0
function nextId(type) {
  uid += 1
  return `${type}_${uid}_${Date.now().toString(36)}`
}

export function createLevel() {
  const state = reactive({
    entities: [],
    connections: [],
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

  function countBonds(id) {
    return state.connections.filter((c) => c.aId === id || c.bId === id).length
  }

  function updateBondCount(id) {
    const inst = getInstance(id)
    if (inst && inst.state) {
      inst.state.bondCount = countBonds(id)
    }
  }

  function updateAllBondCounts() {
    for (const e of state.entities) {
      if (e.state) e.state.bondCount = countBonds(e.id)
    }
  }

  function toggleConnection(aId, bId) {
    if (aId === bId) return
    const a = getInstance(aId)
    const b = getInstance(bId)
    if (!a || !b) return

    if (connectionExists(aId, bId)) {
      removeConnection(aId, bId)
      return
    }

    if (!a.points?.length || !b.points?.length) return

    // Проверка maxBonds для обеих сторон (BONDABLE проверяется в UI)
    const aBonds = countBonds(aId)
    const bBonds = countBonds(bId)
    if (a.state?.maxBonds !== undefined && aBonds >= a.state.maxBonds) return
    if (b.state?.maxBonds !== undefined && bBonds >= b.state.maxBonds) return

    const p1 = a.points[0]
    const p2 = b.points[0]
    const dist = distance(p1, p2)
    const minLength = (p1.radius || 10) + (p2.radius || 10)
    const length = Math.max(dist, minLength)

    const stick = new VerletStick(p1, p2, {
      length,
      stiffness: 0.6,
      breakable: true,
      maxStretch: 2.2,
    })
    const id = `bond_${aId}_${bId}`
    state.connections.push({ id, aId, bId, stick })
    a.sticks?.push(stick)

    updateBondCount(aId)
    updateBondCount(bId)
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
    updateBondCount(conn.aId)
    updateBondCount(conn.bId)
  }

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
    countBonds,
    updateAllBondCounts,
  }
}
