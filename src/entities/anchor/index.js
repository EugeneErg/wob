// entities/anchor/index.js
//
// Якорь (системный шар) — для построения базовой конструкции.

import AnchorGame from './AnchorGame.vue'
import AnchorEditor from './AnchorEditor.vue'
import { VerletPoint } from '../../core/verlet.js'
import { PROP, readProperty } from '../../core/GlobalProperties.js'

export default {
  type: 'anchor',
  name: 'Якорь',
  icon: '⚓',

  createInstance(id, initProps = {}) {
    const radius = initProps.radius ?? 18
    const pinned = initProps.pinned ?? true
    const state = {
      radius,
      pinned,
      mass: initProps.mass ?? 1,
      color: initProps.color ?? '#8b5cf6',
      bondCount: 0,
    }
    const point = new VerletPoint(initProps.x ?? 0, initProps.y ?? 0, { radius, pinned, meta: { entityId: id } })
    return {
      id,
      type: 'anchor',
      state,
      points: [point],
      sticks: [],
    }
  },

  properties: {
    [PROP.WEIGHT]: (state) => state.pinned ? Infinity : state.mass,
    [PROP.COLLISION]: true,
    [PROP.SMOOTHNESS]: 0.5,
    [PROP.BONDABLE]: true,
    [PROP.Z_INDEX]: 10,
  },

  GameComponent: AnchorGame,
  EditorComponent: AnchorEditor,

  editor: {
    getBounds(instance) {
      const p = instance.points[0]
      const r = instance.state.radius
      return { x: p.x - r, y: p.y - r, width: r * 2, height: r * 2 }
    },

    onEntityClick(instance, otherInstance, otherDefinition, level) {
      if (otherInstance.id === instance.id) return
      const otherBondable = readProperty(otherInstance, otherDefinition, PROP.BONDABLE)
      if (!otherBondable) return
      level.toggleConnection(instance.id, otherInstance.id)
    },

    propertiesSchema: [
      { key: 'pinned', label: 'Закреплён', type: 'checkbox' },
      { key: 'mass', label: 'Вес', type: 'number', min: 0.1, step: 0.1 },
      { key: 'radius', label: 'Радиус', type: 'number', min: 5, step: 1 },
      { key: 'color', label: 'Цвет', type: 'color' },
    ],
  },
}
