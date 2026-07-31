// composables/useDragSelect.js
//
// Генерик "зажать и вести курсор — получить прямоугольник". Используется
// и нулевым контекстом редактора (выделение сущностей), и контекстом
// конкретной сущности (выделение того, что решит сущность — see entities/*/editor.onRectSelect).

import { ref, computed } from 'vue'

export function useDragSelect(onComplete) {
  const isDragging = ref(false)
  const start = ref({ x: 0, y: 0 })
  const current = ref({ x: 0, y: 0 })

  const rect = computed(() => {
    const x1 = Math.min(start.value.x, current.value.x)
    const y1 = Math.min(start.value.y, current.value.y)
    const x2 = Math.max(start.value.x, current.value.x)
    const y2 = Math.max(start.value.y, current.value.y)
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
  })

  function begin(x, y) {
    isDragging.value = true
    start.value = { x, y }
    current.value = { x, y }
  }

  function move(x, y) {
    if (!isDragging.value) return
    current.value = { x, y }
  }

  function end() {
    if (!isDragging.value) return
    isDragging.value = false
    // клик без движения — не считаем выделением прямоугольником
    const moved = rect.value.width > 3 || rect.value.height > 3
    if (moved) onComplete?.(rect.value)
    return moved
  }

  return { isDragging, rect, begin, move, end }
}

/** Пересекается ли прямоугольная область выделения с точкой/кругом сущности */
export function rectIntersectsCircle(rect, cx, cy, radius = 0) {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.width))
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.height))
  const dx = cx - closestX
  const dy = cy - closestY
  return dx * dx + dy * dy <= radius * radius
}

/** Пересекается ли прямоугольная область выделения хотя бы с одной точкой полигона */
export function rectIntersectsPolygon(rect, points) {
  return points.some(
    (p) => p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height
  )
}
