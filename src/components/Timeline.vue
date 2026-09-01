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
      <!-- The unrolled part: seeking this far is instant. The same idea as the
           buffered bar on a video — you can see how far you may jump without
           waiting. -->
      <div class="buf" :style="{ width: pct(buffered) }" />
      <div class="done" :style="{ width: pct(value) }" />
      <div class="knob" :style="{ left: pct(value) }" />
    </div>
  </div>
</template>

<script setup>
// A timeline with a scrubber.
//
// It drags both ways, and on the way it shows the frame under your finger:
// seeking happens while moving, not after letting go. Hence two events — seek
// on every move and commit on release. The first is so you can see where you
// are going; the second is so something can be decided afterwards (in game,
// rewinding to exactly this point).
import { ref } from 'vue'

const props = defineProps({
  value: { type: Number, default: 0 },
  max: { type: Number, default: 1 },
  // how far it is unrolled; -1 means treat everything as unrolled
  buffered: { type: Number, default: -1 },
  disabled: { type: Boolean, default: false },
  // arrow-key step, in units of value
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

// Arrow keys are for the fine adjustment a finger cannot manage
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
