<script setup>
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
  rafId = requestAnimationFrame(loop)
  updateSize()
  ro = new ResizeObserver(updateSize)
  ro.observe(svgRef.value)
})

onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId)
  if (ro) ro.disconnect()
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

// --- drag + потенциальная связь ---
const dragging = ref(null)
const potentialBond = ref(null)
const BOND_RANGE = 150

const draggingPoint = computed(() => {
  if (!dragging.value) return null
  return props.level.getInstance(dragging.value.instanceId)?.points?.[0]
})

function toSvgCoords(e) {
  const rect = svgRef.value.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function canDrag(instance, definition) {
  if (instance.type === 'anchor') return false
  return readProperty(instance, definition, PROP.COLLISION)
}

function bondCount(instance) {
  return instance.state?.bondCount ?? 0
}

function maxBonds(instance) {
  return instance.state?.maxBonds ?? Infinity
}

function canAcceptBond(targetInstance, targetDef) {
  if (!readProperty(targetInstance, targetDef, PROP.BONDABLE)) return false
  const current = bondCount(targetInstance)
  const max = maxBonds(targetInstance)
  return current < max
}

function canCreateBond(sourceId, targetId) {
  const source = props.level.getInstance(sourceId)
  const target = props.level.getInstance(targetId)
  if (!source || !target) return false
  const sourceDef = getEntityDefinition(source.type)
  const targetDef = getEntityDefinition(target.type)

  const sourceCurrent = bondCount(source)
  const sourceMax = maxBonds(source)
  if (sourceCurrent >= sourceMax) return false

  return canAcceptBond(target, targetDef)
}

function onPointerDown(e) {
  const { x, y } = toSvgCoords(e)
  const hit = renderList.value.find(({ instance, definition }) => {
    if (!instance.points?.length) return false
    if (!canDrag(instance, definition)) return false
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
  inst.points[0].setPosition(x, y)

  // Источник должен иметь свободный слот
  const sourceCurrent = bondCount(inst)
  const sourceMax = maxBonds(inst)
  if (sourceCurrent >= sourceMax) {
    potentialBond.value = null
    return
  }

  // Ищем ближайшую подходящую цель
  let best = null
  let bestDist = Infinity
  for (const { instance: other, definition: otherDef } of renderList.value) {
    if (other.id === inst.id) continue
    if (!other.points?.length) continue
    if (!canAcceptBond(other, otherDef)) continue
    const p = other.points[0]
    const dx = p.x - x, dy = p.y - y
    const d = Math.sqrt(dx * dx + dy * dy)
    if (d < BOND_RANGE && d < bestDist) {
      bestDist = d
      best = { instance: other, point: p }
    }
  }
  potentialBond.value = best
}

function onPointerUp() {
  if (dragging.value && potentialBond.value) {
    if (canCreateBond(dragging.value.instanceId, potentialBond.value.instance.id)) {
      props.level.toggleConnection(dragging.value.instanceId, potentialBond.value.instance.id)
    }
  }
  dragging.value = null
  potentialBond.value = null
}
</script>

<template>
  <svg
    ref="svgRef"
    class="game-canvas"
    width="100%"
    height="100%"
    :viewBox="viewBox"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointerleave="onPointerUp"
  >
    <rect x="0" y="0" width="100%" height="100%" fill="#bfe3ff" />

    <line
      v-for="c in connections"
      :key="c.id"
      :x1="c.a.x" :y1="c.a.y" :x2="c.b.x" :y2="c.b.y"
      stroke="#3a3a3a" stroke-width="5" stroke-linecap="round"
    />

    <line
      v-if="dragging && potentialBond"
      :x1="draggingPoint.x"
      :y1="draggingPoint.y"
      :x2="potentialBond.point.x"
      :y2="potentialBond.point.y"
      stroke="#ffd166"
      stroke-width="4"
      stroke-dasharray="10 5"
      opacity="0.8"
      stroke-linecap="round"
    />
    <circle
      v-if="dragging && potentialBond"
      :cx="potentialBond.point.x"
      :cy="potentialBond.point.y"
      :r="potentialBond.instance.points?.[0]?.radius ?? 12"
      fill="none"
      stroke="#ffd166"
      stroke-width="3"
      stroke-dasharray="6 4"
      opacity="0.6"
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
  display: block;
  touch-action: none;
  cursor: grab;
}
</style>
