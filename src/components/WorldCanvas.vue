<template>
  <svg
    ref="svg"
    class="stage"
    :viewBox="`0 0 ${w} ${h}`"
    preserveAspectRatio="xMidYMid slice"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
    @pointerleave="onLeave"
  >
    <rect :width="w" :height="h" fill="url(#sky)" />
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#101c25" />
        <stop offset="0.55" stop-color="#16242b" />
        <stop offset="1" stop-color="#1d2a24" />
      </linearGradient>
    </defs>
    <SvgScene :shapes="shapes" />
  </svg>
</template>

<script setup>
import { ref, shallowRef, onMounted, onBeforeUnmount, computed } from 'vue'
import { World } from '../core/world.js'
import { EVENTS } from '../core/globals.js'
import { svgPoint } from '../core/svgPoint.js'
import SvgScene from './SvgScene.js'

const props = defineProps({
  level: { type: Object, required: true },
  interactive: { type: Boolean, default: true },
  paused: { type: Boolean, default: false },
})
const emit = defineEmits(['progress', 'missing'])

const svg = ref(null)
const shapes = shallowRef([])
const world = shallowRef(null)
const w = computed(() => props.level.width || 1600)
const h = computed(() => props.level.height || 900)

let raf = 0
let last = 0
let off = null

function build() {
  off?.()
  world.value = new World(structuredClone(props.level))
  off = world.value.on(EVENTS.progress, (e) => emit('progress', e?.delta ?? 1))
  if (world.value.missing.length) emit('missing', [...world.value.missing])
  shapes.value = world.value.scene()
}

function loop(t) {
  raf = requestAnimationFrame(loop)
  const dt = Math.min((t - last) / 1000 || 0, 0.05)
  last = t
  if (props.paused) return
  world.value.step(dt)
  shapes.value = world.value.scene()
}

onMounted(() => { build(); last = performance.now(); raf = requestAnimationFrame(loop) })
onBeforeUnmount(() => { cancelAnimationFrame(raf); off?.() })

const pt = (e) => svgPoint(svg.value, e)
function onDown(e) {
  if (!props.interactive) return
  svg.value.setPointerCapture?.(e.pointerId)
  world.value.pointerDown(pt(e))
}
function onMove(e) { if (props.interactive) world.value.pointerMove(pt(e)) }
function onLeave(e) { if (!props.interactive) return; world.value.pointerUp(pt(e)); world.value.pointerHover(null) }
function onUp(e) { if (props.interactive) world.value.pointerUp(pt(e)) }

defineExpose({ restart: build })
</script>

<style scoped>
.stage { display: block; width: 100%; height: 100%; touch-action: none; }
</style>
