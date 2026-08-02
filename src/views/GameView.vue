<template>
  <div class="game">
    <WorldCanvas ref="canvas" :level="level" @progress="onProgress" />

    <div class="hud">
      <button class="btn ghost small" @click="$emit('back')">← Уровни</button>
      <div class="counter" :class="{ done: collected >= level.goal }">
        <span class="num">{{ collected }}</span>
        <span class="of">/ {{ level.goal }}</span>
        <span class="cap">в трубе</span>
      </div>
      <button class="btn small" @click="restart">Заново</button>
    </div>

    <transition name="pop">
      <div v-if="collected >= level.goal" class="win">
        <p class="eyebrow">Уровень пройден</p>
        <h2>{{ level.name }}</h2>
        <div class="row">
          <button class="btn primary" @click="$emit('back')">К уровням</button>
          <button class="btn" @click="restart">Ещё раз</button>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import WorldCanvas from '../components/WorldCanvas.vue'

defineProps({ level: { type: Object, required: true } })
defineEmits(['back'])

const canvas = ref(null)
const collected = ref(0)
const onProgress = (n) => (collected.value += n)
function restart() { collected.value = 0; canvas.value.restart() }
</script>

<style scoped>
.game { position: absolute; inset: 0; background: var(--ink); }
.hud {
  position: absolute; top: 0; left: 0; right: 0;
  display: flex; align-items: center; gap: 16px; padding: 14px 18px;
  pointer-events: none;
}
.hud > * { pointer-events: auto; }
.counter {
  margin-left: auto; margin-right: auto;
  display: flex; align-items: baseline; gap: 8px;
  background: rgba(11, 16, 20, 0.72); border: 1px solid var(--line);
  border-radius: 999px; padding: 8px 20px; backdrop-filter: blur(6px);
}
.counter .num { font-family: var(--font-display); font-size: 30px; line-height: 1; color: var(--goo); }
.counter .of { font-family: var(--font-mono); color: var(--muted); font-size: 14px; }
.counter .cap { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); }
.counter.done .num { color: var(--moss); }

.win {
  position: absolute; inset: auto 0 0 0; margin: auto; bottom: 12%;
  width: max-content; text-align: center;
  background: rgba(11, 16, 20, 0.9); border: 1px solid var(--line);
  border-radius: 16px; padding: 26px 40px;
}
.win h2 { font-family: var(--font-display); font-size: 40px; margin: 6px 0 18px; }
.win .row { display: flex; gap: 10px; justify-content: center; }
.pop-enter-active { transition: all 0.35s cubic-bezier(0.2, 1.3, 0.4, 1); }
.pop-enter-from { opacity: 0; transform: translateY(20px) scale(0.96); }
</style>
