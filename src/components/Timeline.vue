<template>
  <div
    ref="track"
    class="tl"
    :class="{ off: disabled, dragging }"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="up"
    @keydown="key"
    tabindex="0"
    role="slider"
    :aria-valuemin="0"
    :aria-valuemax="max"
    :aria-valuenow="value"
  >
    <div class="bar">
      <!-- Развёрнутая часть: досюда перемотка мгновенна. Ровно та же мысль,
           что и полоса загрузки у видео — видно, докуда можно прыгнуть без
           ожидания. -->
      <div class="buf" :style="{ width: pct(buffered) }" />
      <div class="done" :style="{ width: pct(value) }" />
      <div class="knob" :style="{ left: pct(value) }" />
    </div>
  </div>
</template>

<script setup>
// Полоса времени с бегунком.
//
// Тянуть можно в обе стороны, и по дороге показывается тот кадр, над которым
// палец: перемотка происходит во время движения, а не после отпускания.
// Поэтому событий два — seek на каждое движение и commit на отпускание: первое
// нужно, чтобы видеть, куда ведёшь, второе — чтобы решить, что делать дальше
// (в игре, например, откатиться именно сюда).
import { ref } from 'vue'

const props = defineProps({
  value: { type: Number, default: 0 },
  max: { type: Number, default: 1 },
  // докуда развёрнуто; -1 — считать развёрнутым всё
  buffered: { type: Number, default: -1 },
  disabled: { type: Boolean, default: false },
  // шаг стрелками, в единицах value
  step: { type: Number, default: 60 },
})
const emit = defineEmits(['seek', 'commit'])

const track = ref(null)
const dragging = ref(false)

const pct = (v) => `${Math.max(0, Math.min(100, ((v < 0 ? props.max : v) / (props.max || 1)) * 100))}%`

function at(e) {
  const r = track.value.getBoundingClientRect()
  const k = (e.clientX - r.left) / (r.width || 1)
  return Math.round(Math.max(0, Math.min(1, k)) * props.max)
}

function down(e) {
  if (props.disabled) return
  track.value.setPointerCapture?.(e.pointerId)
  dragging.value = true
  emit('seek', at(e))
}
function move(e) {
  if (props.disabled || !dragging.value) return
  emit('seek', at(e))
}
function up(e) {
  if (!dragging.value) return
  dragging.value = false
  emit('commit', at(e))
}

// Стрелки — точная подводка, когда пальцем не попасть
function key(e) {
  if (props.disabled) return
  const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
  if (!d) return
  e.preventDefault()
  const next = Math.max(0, Math.min(props.max, props.value + d * (e.shiftKey ? 1 : props.step)))
  emit('seek', next)
  emit('commit', next)
}
</script>

<style scoped>
.tl { padding: 7px 0; cursor: pointer; touch-action: none; outline: none; }
.tl.off { cursor: default; opacity: 0.5; }
.bar {
  position: relative; height: 5px; border-radius: 3px;
  background: rgba(255, 255, 255, 0.14);
}
.buf { position: absolute; inset: 0 auto 0 0; background: rgba(255, 255, 255, 0.28); border-radius: 3px; }
.done { position: absolute; inset: 0 auto 0 0; background: var(--goo); border-radius: 3px; }
.knob {
  position: absolute; top: 50%; width: 13px; height: 13px; margin: -6.5px 0 0 -6.5px;
  border-radius: 50%; background: var(--goo);
  transition: transform 0.12s;
}
.tl:hover .knob, .tl.dragging .knob, .tl:focus .knob { transform: scale(1.35); }
.tl.off .knob { display: none; }
</style>
