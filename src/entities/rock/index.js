// entities/rock/index.js
//
// Порода — статический ландшафт, задаётся полигоном. Не двигается,
// с ней сталкиваются все остальные сущности с collision=true.

import RockGame from './RockGame.vue'
import RockEditor from './RockEditor.vue'
import { PROP } from '../../core/GlobalProperties.js'

function defaultPolygon(x, y) {
  return [
    { x: x - 60, y: y - 25 },
    { x: x + 60, y: y - 25 },
    { x: x + 70, y: y + 35 },
    { x: x - 70, y: y + 35 },
  ]
}

export default {
  type: 'rock',
  name: 'Порода',
  icon: '🪨',

  createInstance(id, initProps = {}) {
    const points = initProps.points ?? defaultPolygon(initProps.x ?? 0, initProps.y ?? 0)
    const state = {
      points,
      color: '#6b5b45',
      smoothness: 0.35,
      _selectedVertices: [],
    }
    return {
      id,
      type: 'rock',
      state,
      // ссылка на тот же массив point-ов: PhysicsWorld читает форму коллизии
      // напрямую отсюда, и она остаётся синхронной при редактировании вершин
      collisionShape: { points },
    }
  },

  properties: {
    [PROP.WEIGHT]: Infinity,
    [PROP.COLLISION]: true,
    // гладкость хранится в state сущности и может быть открыта в UI свойств —
    // поэтому здесь функция, а не константа
    [PROP.SMOOTHNESS]: (state) => state.smoothness,
    [PROP.BONDABLE]: false,
    [PROP.Z_INDEX]: 0,
  },

  GameComponent: RockGame,
  EditorComponent: RockEditor,

  editor: {
    // AABB для попадания в прямоугольник выделения в нулевом контексте
    getBounds(instance) {
      const xs = instance.state.points.map((p) => p.x)
      const ys = instance.state.points.map((p) => p.y)
      return {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      }
    },

    // Мы в контексте этой сущности: рамка выделения выбирает вершины полигона
    onRectSelect(instance, rect) {
      const selected = []
      instance.state.points.forEach((p, i) => {
        if (p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height) {
          selected.push(i)
        }
      })
      instance.state._selectedVertices = selected
    },

    onClearSelection(instance) {
      instance.state._selectedVertices = []
    },

    // Del в контексте этой сущности: удаляем выбранные вершины, но не даём
    // развалить полигон меньше треугольника. Возвращаем true — значит
    // редактор сущности "сам разобрался" и не должен удалять всю сущность.
    deleteSelection(instance) {
      const selected = instance.state._selectedVertices || []
      if (!selected.length) return false
      if (instance.state.points.length - selected.length < 3) return true // ничего не делаем, но обрабатываем
      instance.state.points = instance.state.points.filter((_, i) => !selected.includes(i))
      instance.state._selectedVertices = []
      return true
    },

    propertiesSchema: [
      { key: 'smoothness', label: 'Гладкость', type: 'range', min: 0, max: 1, step: 0.05 },
      { key: 'color', label: 'Цвет', type: 'color' },
    ],
  },
}
