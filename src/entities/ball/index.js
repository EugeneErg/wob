// entities/ball/index.js

import BallGame from './BallGame.vue'
import BallEditor from './BallEditor.vue'
import { VerletPoint } from '../../core/verlet.js'
import { PROP, readProperty } from '../../core/GlobalProperties.js'

const COLORS = ['#e63946', '#2a9d8f', '#e9c46a', '#457b9d', '#f4a261']

export default {
  type: 'ball',
  name: 'Шар',
  icon: '⚫',

  createInstance(id, initProps = {}) {
    const radius = initProps.radius ?? 22
    const state = {
      radius,
      mass: initProps.mass ?? 1,
      smoothness: 0.3,
      color: initProps.color ?? COLORS[Math.floor(Math.random() * COLORS.length)],
      minBonds: initProps.minBonds ?? 1,
      maxBonds: initProps.maxBonds ?? 3,
      bondCount: 0,
    }
    const point = new VerletPoint(initProps.x ?? 0, initProps.y ?? 0, { radius, meta: { entityId: id } })
    return {
      id,
      type: 'ball',
      state,
      points: [point],
      sticks: [],
    }
  },

  properties: {
    [PROP.WEIGHT]: (state) => state.mass,
    [PROP.COLLISION]: true,
    [PROP.SMOOTHNESS]: (state) => state.smoothness,
    // Шар bondable только если уже часть конструкции (есть связи)
    [PROP.BONDABLE]: (state) => state.bondCount > 0,
    [PROP.Z_INDEX]: 10,
  },

  GameComponent: BallGame,
  EditorComponent: BallEditor,

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
      { key: 'mass', label: 'Вес', type: 'number', min: 0.1, step: 0.1 },
      { key: 'radius', label: 'Радиус', type: 'number', min: 5, step: 1 },
      { key: 'smoothness', label: 'Гладкость', type: 'range', min: 0, max: 1, step: 0.05 },
      { key: 'color', label: 'Цвет', type: 'color' },
      { key: 'minBonds', label: 'Мин. связей', type: 'number', min: 0, step: 1 },
      { key: 'maxBonds', label: 'Макс. связей', type: 'number', min: 1, step: 1 },
    ],
  },
}
