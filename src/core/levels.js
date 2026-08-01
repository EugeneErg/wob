import tower from '../levels/tower.json'
import bridge from '../levels/bridge.json'

const KEY = 'goo.levels.v1'
const BUILTIN = [tower, bridge]

function read() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : null
  } catch { return null }
}

function write(list) {
  localStorage.setItem(KEY, JSON.stringify(list))
}

export function listLevels() {
  const stored = read()
  if (!stored) { write(structuredClone(BUILTIN)); return structuredClone(BUILTIN) }
  return stored
}

export function getLevel(id) {
  return listLevels().find((l) => l.id === id) || null
}

export function saveLevel(level) {
  const list = listLevels()
  const i = list.findIndex((l) => l.id === level.id)
  if (i >= 0) list[i] = level
  else list.push(level)
  write(list)
  return level
}

export function deleteLevel(id) {
  write(listLevels().filter((l) => l.id !== id))
}

export function copyLevel(id) {
  const src = getLevel(id)
  if (!src) return null
  const copy = structuredClone(src)
  copy.id = 'lvl-' + Math.random().toString(36).slice(2, 9)
  copy.name = src.name + ' — копия'
  return saveLevel(copy)
}

export function blankLevel() {
  return saveLevel({
    id: 'lvl-' + Math.random().toString(36).slice(2, 9),
    name: 'Новый уровень',
    width: 1600,
    height: 900,
    gravity: { x: 0, y: 1800 },
    goal: 3,
    entities: [],
  })
}

export function resetLevels() {
  write(structuredClone(BUILTIN))
}
