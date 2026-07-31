<script setup>
// Игровой компонент НЕ знает про rock/ball/pipe. Он:
//  - для каждой сущности берёт GameComponent из её definition (реестр)
//  - сортирует отрисовку по PROP.Z_INDEX
//  - рисует связи (bonds) как генерик-слой поверх точечных сущностей
//  - даёт "схватить" любую сущность с .points (генерик-механика, а не "шар")
import { onMounted, onBeforeUnmount, computed, ref } from 'vue'
import { getEntityDefinition } from '../core/EntityRegistry.js'
import { PhysicsWorld } from '../core/PhysicsWorld.js'
import { readProperty, PROP } from '../core/GlobalProperties.js'

const props = defineProps({
  level: { type: Object, required: true },
})

const world = new PhysicsWorld(props.level)
let rafId = null
let lastTime = 0

function loop(t) {
  if (!lastTime) lastTime = t
  const dt = Math.min((t - lastTime) / 1000, 1 / 30)
  lastTime = t
  if (!dragging.value) world.step(dt)
  rafId = requestAnimationFrame(loop)
}

onMounted(() => {
  rafId = requestAnimationFrame(loop)
})
onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId)
})

const renderList = computed(() =>
  props.level.state.entities
    .map((instance) => ({ instance, definition: getEntityDefinition(instance.type) }))
    .filter((e) => e.definition)
    .sort((a, b) => readProperty(a.instance, a.definition, PROP.Z_INDEX) - readProperty(b.instance, b.definition, PROP.Z_INDEX))
)

const connections = computed(() =>
  props.level.state.connections.map((c) => ({
    id: c.id,
    a: props.level.getInstance(c.aId)?.points?.[0],
    b: props.level.getInstance(c.bId)?.points?.[0],
  })).filter((c) => c.a && c.b)
)

// --- генерик "грэб" любой точечной сущности мышью ---
const dragging = ref(null) // { instanceId }
const svgRef = ref(null)

function toSvgCoords(e) {
  const rect = svgRef.value.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function onPointerDown(e) {
  const { x, y } = toSvgCoords(e)
  const hit = renderList.value.find(({ instance, definition }) => {
    if (!instance.points?.length) return false
    if (!readProperty(instance, definition, PROP.COLLISION)) return false
    const p = instance.points[0]
    const dx = p.x - x, dy = p.y - y
    return Math.sqrt(dx * dx + dy * dy) <= (p.radius ?? 12) + 4
  })
  if (!hit) return
  dragging.value = { instanceId: hit.instance.id }
}

function onPointerMove(e) {
  if (!dragging.value) return
  const inst = props.level.getInstance(dragging.value.instanceId)
  if (!inst) return
  const { x, y } = toSvgCoords(e)
  inst.points[0].setPosition(x, y) // временно "телепортируем" точку под курсор
}

function onPointerUp() {
  dragging.value = null
}
</script>

<template>
  <svg
    ref="svgRef"
    class="game-canvas"
    viewBox="0 0 960 540"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointerleave="onPointerUp"
  >
    <rect x="0" y="0" width="960" height="540" fill="#bfe3ff" />

    <line
      v-for="c in connections"
      :key="c.id"
      :x1="c.a.x" :y1="c.a.y" :x2="c.b.x" :y2="c.b.y"
      stroke="#3a3a3a" stroke-width="5" stroke-linecap="round"
    />

    <component
      :is="entry.definition.GameComponent"
      v-for="entry in renderList"
      :key="entry.instance.id"
      :instance="entry.instance"
    />
  </svg>
</template>

<style scoped>
.game-canvas {
  width: 100%;
  height: 100%;
  touch-action: none;
  cursor: grab;
  display: block;
}
</style>
