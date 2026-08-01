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
  world.step(dt)
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
    aId: c.aId,
    bId: c.bId,
    a: props.level.getInstance(c.aId)?.points?.[0],
    b: props.level.getInstance(c.bId)?.points?.[0],
  })).filter((c) => c.a && c.b)
)

const dragging = ref(null)
const potentialBonds = ref([])
const existingBonds = ref([])
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
  return props.level.countBonds(instance.id)
}

function maxBonds(instance) {
  return instance.state?.maxBonds ?? Infinity
}

function canAcceptBond(targetInstance, targetDef) {
  return readProperty(targetInstance, targetDef, PROP.BONDABLE)
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

  const p = hit.instance.points[0]
  // tearOrigin — позиция в момент захвата. Связи тянутся к ней, не к курсору.
  world.tearing = p
  world.tearOrigin = { x: p.x, y: p.y }

  // Собираем существующие связи для визуализации
  existingBonds.value = props.level.state.connections
    .filter(c => c.aId === hit.instance.id || c.bId === hit.instance.id)
    .map(c => {
      const otherId = c.aId === hit.instance.id ? c.bId : c.aId
      const otherInst = props.level.getInstance(otherId)
      return {
        stick: c.stick,
        otherPoint: otherInst?.points?.[0],
        otherInstance: otherInst,
      }
    })
    .filter(b => b.otherPoint)
}

function onPointerMove(e) {
  if (!dragging.value) return
  const inst = props.level.getInstance(dragging.value.instanceId)
  if (!inst) return
  const { x, y } = toSvgCoords(e)
  inst.points[0].setPosition(x, y)

  // Обновляем визуализацию существующих связей
  existingBonds.value = existingBonds.value.filter(b => {
    if (!b.otherPoint) return false
    const stillExists = props.level.connectionExists(inst.id, b.otherInstance.id)
    if (!stillExists) return false
    const dx = b.otherPoint.x - x
    const dy = b.otherPoint.y - y
    const dist = Math.sqrt(dx * dx + dy * dy)
    const limit = b.stick.length * (b.stick.maxStretch ?? 2.2)
    return dist <= limit
  })

  // Ищем новые потенциальные связи
  const current = bondCount(inst)
  const max = maxBonds(inst)
  const min = inst.state?.minBonds ?? 1
  const slots = max - current
  if (slots <= 0) {
    potentialBonds.value = []
    return
  }
  const want = Math.max(min, 1)
  const take = Math.min(want, slots)

  const candidates = []
  for (const { instance: other, definition: otherDef } of renderList.value) {
    if (other.id === inst.id) continue
    if (!other.points?.length) continue
    if (!canAcceptBond(other, otherDef)) continue
    const p = other.points[0]
    const dx = p.x - x, dy = p.y - y
    const d = Math.sqrt(dx * dx + dy * dy)
    if (d < BOND_RANGE) {
      candidates.push({ instance: other, point: p, dist: d })
    }
  }

  candidates.sort((a, b) => a.dist - b.dist)
  potentialBonds.value = candidates.slice(0, take)
}

function onPointerUp() {
  if (dragging.value) {
    const draggedId = dragging.value.instanceId
    const inst = props.level.getInstance(draggedId)

    if (inst) {
      // Порвём связи, которые слишком далеко
      const allConns = props.level.state.connections.filter(c => c.aId === draggedId || c.bId === draggedId)
      for (const c of allConns) {
        const otherId = c.aId === draggedId ? c.bId : c.aId
        const otherInst = props.level.getInstance(otherId)
        if (!otherInst || !otherInst.points?.length) continue
        const dx = otherInst.points[0].x - inst.points[0].x
        const dy = otherInst.points[0].y - inst.points[0].y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const limit = c.stick.length * (c.stick.maxStretch ?? 2.2)
        if (dist > limit) {
          props.level.removeConnection(draggedId, otherId)
        }
      }
    }

    for (const target of potentialBonds.value) {
      props.level.toggleConnection(draggedId, target.instance.id)
    }
  }

  dragging.value = null
  potentialBonds.value = []
  existingBonds.value = []
  world.tearing = null
  world.tearOrigin = null
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

    <!-- Постоянные связи (скрываем связи перетаскиваемого шара) -->
    <line
      v-for="c in connections"
      :key="c.id"
      v-show="!dragging || (c.aId !== dragging.instanceId && c.bId !== dragging.instanceId)"
      :x1="c.a.x" :y1="c.a.y" :x2="c.b.x" :y2="c.b.y"
      stroke="#3a3a3a" stroke-width="5" stroke-linecap="round"
    />

    <!-- Существующие связи при drag -->
    <g v-if="dragging && existingBonds.length">
      <line
        v-for="(b, i) in existingBonds"
        :key="`ex${i}`"
        :x1="draggingPoint.x"
        :y1="draggingPoint.y"
        :x2="b.otherPoint.x"
        :y2="b.otherPoint.y"
        stroke="#ff6b6b"
        stroke-width="3"
        stroke-dasharray="8 4"
        opacity="0.8"
        stroke-linecap="round"
      />
    </g>

    <!-- Потенциальные новые связи -->
    <g v-if="dragging && potentialBonds.length">
      <line
        v-for="(pb, i) in potentialBonds"
        :key="`pb${i}`"
        :x1="draggingPoint.x"
        :y1="draggingPoint.y"
        :x2="pb.point.x"
        :y2="pb.point.y"
        stroke="#ffd166"
        stroke-width="4"
        stroke-dasharray="10 5"
        opacity="0.9"
        stroke-linecap="round"
      />
      <circle
        v-for="(pb, i) in potentialBonds"
        :key="`pc${i}`"
        :cx="pb.point.x"
        :cy="pb.point.y"
        :r="pb.instance.points?.[0]?.radius ?? 12"
        fill="none"
        stroke="#ffd166"
        stroke-width="3"
        stroke-dasharray="6 4"
        opacity="0.6"
      />
    </g>

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
