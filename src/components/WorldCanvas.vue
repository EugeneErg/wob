<template>
  <svg
    ref="svg"
    class="stage"
    :viewBox="`${cam.x} ${cam.y} ${cam.w} ${cam.h}`"
    preserveAspectRatio="xMidYMid meet"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
    @pointerleave="onLeave"
  >
    <rect :x="0" :y="0" :width="w" :height="h" fill="url(#sky)" />
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

// Камера. Зума нет: окно постоянного размера ездит по уровню.
// Когда курсор зажат и подходит к краю экрана, вид едет в ту сторону.
const cam = ref({ x: 0, y: 0, w: 1600, h: 900 })
const EDGE = 0.14      // доля экрана у края, где начинается прокрутка
const SPEED = 900      // предельная скорость прокрутки, единиц мира в секунду
let scroll = { x: 0, y: 0 }
let held = false

function setupCamera() {
  const cw = Math.min(props.level.camera?.w || 1600, w.value)
  const chh = Math.min(props.level.camera?.h || 900, h.value)
  cam.value = { x: (w.value - cw) / 2, y: (h.value - chh) / 2, w: cw, h: chh }
  clampCam()
}
function clampCam() {
  const c = cam.value
  c.x = w.value <= c.w ? (w.value - c.w) / 2 : Math.max(0, Math.min(w.value - c.w, c.x))
  c.y = h.value <= c.h ? (h.value - c.h) / 2 : Math.max(0, Math.min(h.value - c.h, c.y))
}
function edgePush(e) {
  if (!held || !svg.value) { scroll = { x: 0, y: 0 }; return }
  const r = svg.value.getBoundingClientRect()
  const fx = (e.clientX - r.left) / r.width
  const fy = (e.clientY - r.top) / r.height
  const ramp = (f) => (f < EDGE ? -(1 - f / EDGE) : f > 1 - EDGE ? (1 - (1 - f) / EDGE) : 0)
  scroll = { x: ramp(fx) * SPEED, y: ramp(fy) * SPEED }
}

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
  if (scroll.x || scroll.y) {
    cam.value.x += scroll.x * dt
    cam.value.y += scroll.y * dt
    clampCam()
    cam.value = { ...cam.value }
  }
  world.value.step(dt)
  shapes.value = world.value.scene()
}

onMounted(() => { build(); setupCamera(); last = performance.now(); raf = requestAnimationFrame(loop) })
onBeforeUnmount(() => { cancelAnimationFrame(raf); off?.() })

const pt = (e) => svgPoint(svg.value, e)
function onDown(e) {
  if (!props.interactive) return
  svg.value.setPointerCapture?.(e.pointerId)
  held = true
  world.value.pointerDown(pt(e))
}
function onMove(e) {
  if (!props.interactive) return
  edgePush(e)
  world.value.pointerMove(pt(e))
}
function onLeave(e) { if (!props.interactive) return; stop(e); world.value.pointerHover(null) }
function onUp(e) { if (props.interactive) stop(e) }
function stop(e) {
  held = false
  scroll = { x: 0, y: 0 }
  world.value.pointerUp(pt(e))
}

defineExpose({ restart: () => { build(); setupCamera() } })
</script>

<style scoped>
.stage {
  display: block; width: 100%; height: 100%; touch-action: none;
  background: linear-gradient(#101c25, #16242b 55%, #1d2a24);
}
</style>
