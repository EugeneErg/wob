<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { getAllEntityDefinitions, getEntityDefinition } from '../core/EntityRegistry.js'
import { useDragSelect } from '../composables/useDragSelect.js'

const props = defineProps({
  level: { type: Object, required: true },
})

const defs = getAllEntityDefinitions()

const context = ref({ type: 'none' })
const selection = ref(new Set())
const armedType = ref(null)
const buildMode = ref(null)

const svgRef = ref(null)
const viewBox = ref('0 0 960 540')

function updateSize() {
  const el = svgRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  viewBox.value = `0 0 ${Math.round(rect.width)} ${Math.round(rect.height)}`
}

let ro = null
onMounted(() => {
  updateSize()
  ro = new ResizeObserver(updateSize)
  ro.observe(svgRef.value)
  window.addEventListener('pointerup', onGlobalPointerUp)
  window.addEventListener('pointermove', onGlobalPointerMove)
})
onBeforeUnmount(() => {
  if (ro) ro.disconnect()
  window.removeEventListener('pointerup', onGlobalPointerUp)
  window.removeEventListener('pointermove', onGlobalPointerMove)
})

function toSvgCoords(e) {
  const rect = svgRef.value.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

const renderList = computed(() =>
  props.level.state.entities
    .map((instance) => ({ instance, definition: getEntityDefinition(instance.type) }))
    .filter((e) => e.definition)
)

const connections = computed(() =>
  props.level.state.connections
    .map((c) => ({
      id: c.id,
      a: props.level.getInstance(c.aId)?.points?.[0],
      b: props.level.getInstance(c.bId)?.points?.[0],
    }))
    .filter((c) => c.a && c.b)
)

const activeInstance = computed(() =>
  context.value.type === 'entity' ? props.level.getInstance(context.value.entity) : null
)
const activeDefinition = computed(() =>
  activeInstance.value ? getEntityDefinition(activeInstance.value.type) : null
)

function rectsOverlap(r1, r2) {
  return !(r2.x > r1.x + r1.width || r2.x + r2.width < r1.x || r2.y > r1.y + r1.height || r2.y + r2.height < r1.y)
}

// --- выделение рамкой ---
const { isDragging, rect: selectRect, begin: beginDrag, move: moveDrag, end: endDrag } = useDragSelect((rect) => {
  if (context.value.type === 'none') {
    selection.value = new Set(
      renderList.value
        .filter((e) => e.definition.editor?.getBounds && rectsOverlap(rect, e.definition.editor.getBounds(e.instance)))
        .map((e) => e.instance.id)
    )
  } else {
    activeDefinition.value?.editor?.onRectSelect?.(activeInstance.value, rect)
  }
})

// --- drag ---
const draggingEntity = ref(null)
const draggingSelection = ref(null)
const draggingHandle = ref(null)

function getOrigData(instance) {
  const origData = {}
  if (instance.points?.length) {
    const p = instance.points[0]
    origData.x = p.x; origData.y = p.y
  }
  if (instance.state?.points) {
    origData.points = instance.state.points.map(p => ({ x: p.x, y: p.y }))
  }
  if (instance.state?.from && instance.state?.to) {
    origData.from = { ...instance.state.from }
    origData.to = { ...instance.state.to }
  }
  return origData
}

function applyOffset(inst, orig, dx, dy) {
  if (orig.x !== undefined) {
    inst.points[0].x = orig.x + dx
    inst.points[0].y = orig.y + dy
    inst.points[0].oldX = orig.x + dx
    inst.points[0].oldY = orig.y + dy
  }
  if (orig.points) {
    inst.state.points = orig.points.map(p => ({ x: p.x + dx, y: p.y + dy }))
    if (inst.collisionShape) inst.collisionShape.points = inst.state.points
  }
  if (orig.from) {
    inst.state.from = { x: orig.from.x + dx, y: orig.from.y + dy }
    inst.state.to = { x: orig.to.x + dx, y: orig.to.y + dy }
  }
}

function onEntityPointerDown(e, instance, definition) {
  if (e.target.closest('[data-handle]')) return
  if (armedType.value) return
  if (buildMode.value) return

  // Связь: если в контексте сущности и кликнули по другой — пробуем связать
  if (context.value.type === 'entity' && context.value.entity !== instance.id) {
    const currentDef = activeDefinition.value
    if (currentDef?.editor?.onEntityClick) {
      currentDef.editor.onEntityClick(activeInstance.value, instance, definition, props.level)
      e.stopPropagation()
      return
    }
  }

  e.stopPropagation()

  // Массовый drag выделенных
  if (selection.value.has(instance.id) && selection.value.size > 1) {
    const { x, y } = toSvgCoords(e)
    const items = []
    for (const id of selection.value) {
      const inst = props.level.getInstance(id)
      if (!inst) continue
      items.push({ instanceId: id, origData: getOrigData(inst) })
    }
    draggingSelection.value = { startX: x, startY: y, items }
    return
  }

  // Одиночный выбор + drag
  context.value = { type: 'entity', entity: instance.id }
  selection.value = new Set()

  const { x, y } = toSvgCoords(e)
  draggingEntity.value = { instanceId: instance.id, startX: x, startY: y, origData: getOrigData(instance) }
}

// --- клик по фону ---
function onBackgroundPointerDown(e) {
  const { x, y } = toSvgCoords(e)

  if (buildMode.value?.type === 'rock') {
    buildMode.value.points.push({ x, y })
    if (buildMode.value.points.length >= 3) {
      const first = buildMode.value.points[0]
      const dist = Math.hypot(x - first.x, y - first.y)
      if (dist < 20) {
        buildMode.value.points.pop()
        props.level.addEntity('rock', { points: buildMode.value.points })
        buildMode.value = null
      }
    }
    return
  }

  if (buildMode.value?.type === 'pipe') {
    const inst = props.level.addEntity('pipe', { from: { x, y }, to: { x, y } })
    context.value = { type: 'entity', entity: inst.id }
    draggingHandle.value = { instanceId: inst.id, kind: 'endpoint', end: 'to' }
    buildMode.value = null
    return
  }

  if (armedType.value) {
    const instance = props.level.addEntity(armedType.value, { x, y })
    armedType.value = null
    context.value = { type: 'entity', entity: instance.id }
    return
  }

  beginDrag(x, y)
}

function onPointerMove(e) {
  if (draggingSelection.value) {
    const { x, y } = toSvgCoords(e)
    const dx = x - draggingSelection.value.startX
    const dy = y - draggingSelection.value.startY
    for (const item of draggingSelection.value.items) {
      const inst = props.level.getInstance(item.instanceId)
      if (!inst) continue
      applyOffset(inst, item.origData, dx, dy)
    }
    return
  }

  if (draggingEntity.value) {
    const { x, y } = toSvgCoords(e)
    const dx = x - draggingEntity.value.startX
    const dy = y - draggingEntity.value.startY
    const inst = props.level.getInstance(draggingEntity.value.instanceId)
    if (!inst) return
    applyOffset(inst, draggingEntity.value.origData, dx, dy)
    return
  }

  if (draggingHandle.value) {
    updateHandle(toSvgCoords(e))
    return
  }

  const { x, y } = toSvgCoords(e)
  moveDrag(x, y)
}

function onPointerUp(e) {
  if (draggingSelection.value) {
    draggingSelection.value = null
    return
  }
  if (draggingEntity.value) {
    draggingEntity.value = null
    return
  }
  if (draggingHandle.value) {
    draggingHandle.value = null
    return
  }
  const moved = endDrag()
  if (!moved) {
    if (context.value.type === 'entity') {
      activeDefinition.value?.editor?.onClearSelection?.(activeInstance.value)
    }
    context.value = { type: 'none' }
    selection.value = new Set()
  }
}

// Глобальные обработчики: сбрасываем drag, но не трогаем контекст/выделение
function onGlobalPointerUp() {
  draggingEntity.value = null
  draggingSelection.value = null
  draggingHandle.value = null
  endDrag()
}

function onGlobalPointerMove(e) {
  if (!draggingEntity.value && !draggingSelection.value && !draggingHandle.value && !isDragging.value) return
  onPointerMove(e)
}

// --- перетаскивание частей сущности ---
function onVertexDrag({ instanceId, index }) {
  draggingHandle.value = { instanceId, kind: 'vertex', index }
}
function onEndpointDrag({ instanceId, end }) {
  draggingHandle.value = { instanceId, kind: 'endpoint', end }
}
function updateHandle(pos) {
  const inst = props.level.getInstance(draggingHandle.value.instanceId)
  if (!inst) return
  if (draggingHandle.value.kind === 'vertex') {
    inst.state.points[draggingHandle.value.index] = pos
    if (inst.collisionShape) inst.collisionShape.points = inst.state.points
  } else if (draggingHandle.value.kind === 'endpoint') {
    inst.state[draggingHandle.value.end] = pos
  }
}

// --- Build mode ---
function startBuild(type) {
  if (buildMode.value?.type === type) {
    if (buildMode.value?.type === 'rock' && buildMode.value.points.length >= 3) {
      props.level.addEntity('rock', { points: buildMode.value.points })
    }
    buildMode.value = null
    return
  }
  if (type === 'rock') {
    buildMode.value = { type: 'rock', points: [] }
    armedType.value = null
  } else if (type === 'pipe') {
    buildMode.value = { type: 'pipe' }
    armedType.value = null
  } else {
    armedType.value = armedType.value === type ? null : type
    buildMode.value = null
  }
}

// --- Del / Esc ---
function onKeydown(e) {
  if (e.key === 'Escape') {
    if (buildMode.value?.type === 'rock' && buildMode.value.points.length >= 3) {
      props.level.addEntity('rock', { points: buildMode.value.points })
    }
    buildMode.value = null
    armedType.value = null
    return
  }

  if (e.key !== 'Delete' && e.key !== 'Backspace') return

  if (context.value.type === 'entity') {
    const inst = activeInstance.value
    const def = activeDefinition.value
    const handled = def?.editor?.deleteSelection?.(inst)
    if (!handled) {
      props.level.removeEntity(inst.id)
      context.value = { type: 'none' }
    }
  } else if (selection.value.size) {
    selection.value.forEach((id) => props.level.removeEntity(id))
    selection.value = new Set()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="editor-layout">
    <aside class="toolbar">
      <h3>Сущности</h3>
      <button
        v-for="def in defs"
        :key="def.type"
        class="tool-btn"
        :class="{ armed: armedType === def.type || buildMode?.type === def.type }"
        @click="startBuild(def.type)"
      >
        <span class="icon">{{ def.icon }}</span>
        <span>{{ def.name }}</span>
      </button>

      <p class="hint" v-if="armedType">Кликните по сцене, чтобы поставить сущность</p>
      <p class="hint" v-if="buildMode?.type === 'rock'">
        Кликайте для вершин полигона. Клик рядом с первой — замкнуть. Esc — завершить.
      </p>
      <p class="hint" v-if="buildMode?.type === 'pipe'">
        Кликните для начала трубы, затем потяните второй конец.
      </p>

      <div v-if="activeInstance" class="properties">
        <h3>Свойства: {{ activeDefinition.name }}</h3>
        <label v-for="field in activeDefinition.editor?.propertiesSchema || []" :key="field.key">
          {{ field.label }}
          <input
            v-if="field.type === 'range' || field.type === 'number'"
            :type="field.type === 'range' ? 'range' : 'number'"
            :min="field.min" :max="field.max" :step="field.step"
            v-model.number="activeInstance.state[field.key]"
          />
          <input v-else-if="field.type === 'color'" type="color" v-model="activeInstance.state[field.key]" />
          <input v-else-if="field.type === 'checkbox'" type="checkbox" v-model="activeInstance.state[field.key]" />
        </label>
      </div>
    </aside>

    <svg
      ref="svgRef"
      class="editor-canvas"
      width="100%"
      height="100%"
      :viewBox="viewBox"
      @pointerdown="onBackgroundPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
    >
      <rect x="0" y="0" width="100%" height="100%" fill="#eef3f7" />

      <line
        v-for="c in connections" :key="c.id"
        :x1="c.a.x" :y1="c.a.y" :x2="c.b.x" :y2="c.b.y"
        stroke="#3a3a3a" stroke-width="5" stroke-linecap="round"
      />

      <!-- Строящийся полигон -->
      <template v-if="buildMode?.type === 'rock'">
        <polygon
          v-if="buildMode.points.length >= 2"
          :points="buildMode.points.map(p => `${p.x},${p.y}`).join(' ')"
          fill="rgba(107,91,69,0.25)"
          stroke="#6b5b45"
          stroke-width="2"
          stroke-dasharray="6 4"
        />
        <line
          v-if="buildMode.points.length >= 2"
          :x1="buildMode.points[buildMode.points.length - 1].x"
          :y1="buildMode.points[buildMode.points.length - 1].y"
          :x2="buildMode.points[0].x"
          :y2="buildMode.points[0].y"
          stroke="#ffd166"
          stroke-width="1"
          stroke-dasharray="4 4"
        />
        <circle
          v-for="(p, i) in buildMode.points"
          :key="i"
          :cx="p.x" :cy="p.y" r="5"
          fill="#ffd166"
          stroke="#6b5b45"
          stroke-width="1"
        />
      </template>

      <g
        v-for="entry in renderList"
        :key="entry.instance.id"
        :class="{ 'sel-ring': selection.has(entry.instance.id) }"
        @pointerdown.capture="(e) => onEntityPointerDown(e, entry.instance, entry.definition)"
      >
        <component
          :is="entry.definition.EditorComponent"
          :instance="entry.instance"
          :active="context.type === 'entity' && context.entity === entry.instance.id"
          @select="() => {}"
          @vertex-drag="onVertexDrag"
          @endpoint-drag="onEndpointDrag"
        />
        <rect
          v-if="selection.has(entry.instance.id) && entry.definition.editor?.getBounds"
          v-bind="entry.definition.editor.getBounds(entry.instance)"
          fill="none" stroke="#ffd166" stroke-width="2" stroke-dasharray="6 4"
        />
      </g>

      <rect
        v-if="isDragging"
        :x="selectRect.x" :y="selectRect.y" :width="selectRect.width" :height="selectRect.height"
        fill="rgba(66,133,244,0.15)" stroke="#4285f4" stroke-width="1.5"
      />
    </svg>
  </div>
</template>

<style scoped>
.editor-layout {
  display: flex;
  width: 100%;
  height: 100%;
}
.toolbar {
  width: 220px;
  flex-shrink: 0;
  padding: 12px;
  background: #20232a;
  color: #eee;
  overflow-y: auto;
}
.toolbar h3 {
  font-size: 13px;
  text-transform: uppercase;
  opacity: 0.6;
  margin: 12px 0 8px;
}
.tool-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  margin-bottom: 6px;
  background: #2c2f38;
  border: 1px solid transparent;
  border-radius: 6px;
  color: #eee;
  cursor: pointer;
  text-align: left;
}
.tool-btn.armed {
  border-color: #ffd166;
  background: #3a3520;
}
.icon {
  font-size: 18px;
}
.hint {
  font-size: 12px;
  opacity: 0.7;
}
.properties label {
  display: block;
  font-size: 12px;
  margin-bottom: 10px;
}
.properties input {
  display: block;
  width: 100%;
  margin-top: 4px;
}
.editor-canvas {
  display: block;
  touch-action: none;
  cursor: crosshair;
}
</style>
