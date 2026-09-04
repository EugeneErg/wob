import '../src/entities/index.js'
import { shapesForLevel } from '../src/core/scene.js'
import { LAYERS } from '../src/core/globals.js'
const lvl = level('lvl-tower')
const sh = shapesForLevel(lvl)
const links = sh.filter((s) => s.layer === LAYERS.structure)
console.log('связи опор видны в редакторе:', links.length > 0, '| фигур на слое связей:', links.length)
const _idx = (l) => sh.findIndex((s) => (s.layer ?? null) === l)
console.log('порядок слоёв:', [...new Set(sh.map((s) => s.layer ?? 'z'))].join(' → '))
// труба должна быть под телами
import { getEntity } from '../src/core/registry.js'
import { level } from './level.mjs'
console.log('z трубы', getEntity('pipe').z, '< z шара', getEntity('game-ball').z, '→', getEntity('pipe').z < getEntity('game-ball').z)
