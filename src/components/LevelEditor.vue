<script setup>
// Редактор НЕ импортирует rock/ball/pipe. Всё, что он знает про сущности,
// приходит через EntityRegistry (список кнопок) и через definition.editor.*
// (что делать при выделении рамкой / удалении / клике по другой сущности).
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { getAllEntityDefinitions, getEntityDefinition } from '../core/EntityRegistry.js'
import { useDragSelect } from '../composables/useDragSelect.js'

const props = defineProps({
  level: { type: Object, required: true },
})

const defs = getAllEntityDefinitions()

// --- контекст редактора: 'none' (нулевой) или { entity: id } ---
const context = ref({ type: 'none' })
const selection = ref(new Set()) // выделение сущностей в нулевом контексте
const armedType = ref(null) // сущность, "заряженная" в тулбаре для установки

const svgRef = ref(null)
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

// --- клик по фону: снять выделение / выйти из контекста / поставить сущность ---
function onBackgroundPointerDown(e) {
  const { x, y } = toSvgCoords(e)

  if (armedType.value) {
    const def = getEntityDefinition(armedType.value)
    const instance = props.level.addEntity(armedType.value, { x, y })
    armedType.value = null
    context.value = { type: 'entity', entity: instance.id }
    return
  }

  beginDrag(x, y)
}

function onPointerMove(e) {
  if (draggingHandle.value) {
    updateHandle(toSvgCoords(e))
    return
  }
  const { x, y } = toSvgCoords(e)
  moveDrag(x, y)
}

function onPointerUp(e) {
  if (draggingHandle.value) {
    draggingHandle.value = null
    return
  }
  const moved = endDrag()
  if (!moved) {
    // клик без движения по пустому месту — выходим в нулевой контекст / снимаем выделение
    if (context.value.type === 'entity') {
      activeDefinition.value?.editor?.onClearSelection?.(activeInstance.value)
    }
    context.value = { type: 'none' }
    selection.value = new Set()
  }
}

// --- выбор сущности кликом (событие 'select' от EditorComponent) ---
function onEntitySelect(instance, definition, e) {
  if (context.value.type === 'entity' && context.value.entity !== instance.id) {
    const currentDef = activeDefinition.value
    if (currentDef?.editor?.onEntityClick) {
      // текущая сущность сама решает, что значит клик по другой (например — связать)
      currentDef.editor.onEntityClick(activeInstance.value, instance, definition, props.level)
      return
    }
  }
  context.value = { type: 'entity', entity: instance.id }
  selection.value = new Set()
}

// --- перетаскивание "частей" сущности (вершина полигона / конец трубы) ---
const draggingHandle = ref(null) // { instanceId, kind: 'vertex'|'endpoint', index?, end? }

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

// --- Del ---
function onKeydown(e) {
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
        :class="{ armed: armedType === def.type }"
        @click="armedType = armedType === def.type ? null : def.type"
      >
        <span class="icon">{{ def.icon }}</span>
        <span>{{ def.name }}</span>
      </button>
      <p class="hint" v-if="armedType">Кликните по сцене, чтобы поставить сущность</p>

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
        </label>
      </div>
    </aside>

    <svg
      ref="svgRef"
      class="editor-canvas"
      viewBox="0 0 960 540"
      @pointerdown="onBackgroundPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerUp"
    >
      <rect x="0" y="0" width="960" height="540" fill="#eef3f7" />

      <line
        v-for="c in connections" :key="c.id"
        :x1="c.a.x" :y1="c.a.y" :x2="c.b.x" :y2="c.b.y"
        stroke="#3a3a3a" stroke-width="5" stroke-linecap="round"
      />

      <g
        v-for="entry in renderList"
        :key="entry.instance.id"
        :class="{ 'sel-ring': selection.has(entry.instance.id) }"
      >
        <component
          :is="entry.definition.EditorComponent"
          :instance="entry.instance"
          :active="context.type === 'entity' && context.entity === entry.instance.id"
          @select="() => onEntitySelect(entry.instance, entry.definition)"
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
  flex: 1;
  touch-action: none;
  cursor: crosshair;
}
</style>
