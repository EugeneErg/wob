// entities/ball/index.js
//
// Шар — игрок может им управлять, шары создают связи друг с другом.
// Физически — одна VerletPoint. "Управление" в этом каркасе реализовано
// как перетаскивание в игровом режиме (см. GameCanvas) через applyImpulse.

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
    }
    const point = new VerletPoint(initProps.x ?? 0, initProps.y ?? 0, { radius, meta: { entityId: id } })
    return {
      id,
      type: 'ball',
      state,
      points: [point], // подхватывается PhysicsWorld как обычная динамическая точка
      sticks: [], // сюда попадают связи (VerletStick), инициированные ЭТИМ шаром
    }
  },

  properties: {
    [PROP.WEIGHT]: (state) => state.mass,
    [PROP.COLLISION]: true,
    [PROP.SMOOTHNESS]: (state) => state.smoothness,
    [PROP.BONDABLE]: true,
    [PROP.Z_INDEX]: 10, // шары всегда рисуются поверх породы/труб
  },

  GameComponent: BallGame,
  EditorComponent: BallEditor,

  editor: {
    getBounds(instance) {
      const p = instance.points[0]
      const r = instance.state.radius
      return { x: p.x - r, y: p.y - r, width: r * 2, height: r * 2 }
    },

    // Клик по ДРУГОЙ сущности, пока мы в контексте этого шара — пробуем
    // создать связь. Через свойство BONDABLE, а не через проверку типа "ball".
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
    ],
  },
}
