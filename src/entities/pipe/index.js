// entities/pipe/index.js
//
// Труба засасывает шары. Важно: труба ищет не "сущности типа ball", а любую
// динамическую сущность (есть .points) с collision=true, попавшую в радиус
// действия у входного отверстия ("from"). Так труба будет засасывать и
// любую будущую сущность, если она физически на это похожа.

import PipeGame from './PipeGame.vue'
import PipeEditor from './PipeEditor.vue'
import { PROP, readProperty } from '../../core/GlobalProperties.js'

const SUCK_RADIUS = 70
const SUCK_STRENGTH = 900 // px/s^2 к устью трубы
const CONSUME_DISTANCE = 14

export default {
  type: 'pipe',
  name: 'Труба',
  icon: '🕳️',

  createInstance(id, initProps = {}) {
    const x = initProps.x ?? 0
    const y = initProps.y ?? 0
    return {
      id,
      type: 'pipe',
      state: {
        from: initProps.from ?? { x, y }, // устье — сюда засасывает
        to: initProps.to ?? { x: x + 90, y: y - 10 },
        width: 26,
        _selectedEndpoint: null,
      },
      // труба статична и физически "прозрачна" — коллизий с ней нет,
      // засасывание реализовано отдельным кастомным шагом ниже
    }
  },

  properties: {
    [PROP.WEIGHT]: Infinity,
    [PROP.COLLISION]: false,
    [PROP.SMOOTHNESS]: 0.5,
    [PROP.BONDABLE]: false,
    [PROP.Z_INDEX]: 5,
  },

  physics: {
    update(instance, dt, world) {
      const mouth = instance.state.from
      const entities = world.level.getEntitiesWithDefs()
      for (const { instance: other, definition: otherDef } of entities) {
        if (other.id === instance.id) continue
        if (!other.points?.length) continue // засасывать можно только "точечные" сущности
        if (!readProperty(other, otherDef, PROP.COLLISION, world)) continue

        const p = other.points[0]
        const dx = mouth.x - p.x
        const dy = mouth.y - p.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist > SUCK_RADIUS) continue

        if (dist < CONSUME_DISTANCE) {
          world.level.removeEntity(other.id)
          continue
        }
        const pull = (SUCK_STRENGTH * (1 - dist / SUCK_RADIUS)) * dt
        p.applyImpulse((dx / dist) * pull, (dy / dist) * pull)
      }
    },
  },

  GameComponent: PipeGame,
  EditorComponent: PipeEditor,

  editor: {
    getBounds(instance) {
      const { from, to } = instance.state
      return {
        x: Math.min(from.x, to.x) - 10,
        y: Math.min(from.y, to.y) - 10,
        width: Math.abs(to.x - from.x) + 20,
        height: Math.abs(to.y - from.y) + 20,
      }
    },

    onRectSelect(instance, rect) {
      const inRect = (p) => p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height
      if (inRect(instance.state.from)) instance.state._selectedEndpoint = 'from'
      else if (inRect(instance.state.to)) instance.state._selectedEndpoint = 'to'
      else instance.state._selectedEndpoint = null
    },

    onClearSelection(instance) {
      instance.state._selectedEndpoint = null
    },

    propertiesSchema: [{ key: 'width', label: 'Диаметр', type: 'number', min: 10, step: 2 }],
  },
}
