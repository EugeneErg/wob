<template>
  <div class="screen">
    <header class="head">
      <button class="btn ghost" @click="$emit('back')">← Menu</button>
      <h2>Settings</h2>
    </header>

    <section class="block">
      <h3>Display</h3>

      <label class="field">
        <span>Frames per second</span>
        <select :value="fpsCap" @change="setFps(+$event.target.value)">
          <option v-for="f in FPS_OPTIONS" :key="f" :value="f">{{ fpsLabel(f) }}</option>
        </select>
      </label>

      <p class="note">
        The simulation always runs at 60 ticks per second, so this changes how
        smooth the game looks and never what a run is worth.
      </p>
    </section>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { settings, setSetting, FPS_OPTIONS, fpsLabel } from '../core/settings.js'

defineEmits(['back'])

const fpsCap = ref(settings().fpsCap)
const setFps = (v) => {
  fpsCap.value = v
  setSetting('fpsCap', v)
}
</script>

<style scoped>
.screen {
  position: absolute; inset: 0; overflow-y: auto;
  padding: clamp(20px, 5vw, 56px); background: var(--ink);
}
.head { display: flex; align-items: center; gap: 14px; margin-bottom: 26px; }
.head h2 { font-family: var(--font-display); font-size: 30px; margin: 0; }

.block {
  max-width: 520px; margin-bottom: 18px; padding: 18px 20px;
  border: 1px solid var(--line); border-radius: 14px; background: rgba(16, 26, 32, 0.6);
}
.block h3 {
  margin: 0 0 12px; font-family: var(--font-mono); font-size: 11px;
  letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted);
}

.who { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.who img { width: 40px; height: 40px; border-radius: 50%; }
.name { margin: 0; font-size: 15px; color: var(--text); }

.note { margin: 0 0 12px; font-size: 12.5px; line-height: 1.55; color: var(--muted); }
.note code { font-size: 11.5px; }

.gbtn { min-height: 34px; }
.failed { margin-top: 12px; }
.err { margin: 10px 0 0; font-size: 12.5px; color: #e0736b; }

.field { display: block; font-size: 12.5px; color: var(--muted); margin-bottom: 12px; }
.field span { display: block; margin-bottom: 6px; }
.field select {
  font: inherit; font-size: 13px; padding: 7px 12px; min-width: 190px;
  background: rgba(11, 16, 20, 0.9); color: var(--text);
  border: 1px solid var(--line); border-radius: 9px;
}
</style>
