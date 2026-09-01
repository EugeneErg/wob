<template>
  <div v-if="visible" class="rate">
    <p v-if="done" class="thanks">Thanks — rated {{ chosen }}/10.</p>

    <template v-else>
      <p class="ask">How was this level?</p>
      <div class="scale">
        <button
          v-for="n in 10" :key="n" class="pip" :class="{ hot: n <= hover }"
          :disabled="busy"
          @mouseenter="hover = n" @mouseleave="hover = 0" @click="send(n)"
        >{{ n }}</button>
      </div>
      <p v-if="error" class="err">{{ error }}</p>
    </template>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { rateLevel } from '../core/records.js'
import { session } from '../core/session.js'

const props = defineProps({
  releaseId: { type: String, default: null },
  levelId: { type: String, required: true },
})

const hover = ref(0)
const chosen = ref(0)
const done = ref(false)
const busy = ref(false)
const error = ref(null)

// Asked only of people who can actually answer: signed in, and playing a
// published version. A draft has no release to attach an opinion to, and a
// signed-out visitor has one level — rating it would be a survey of one.
const visible = ref(!!props.releaseId && session.status === 'signed-in')

async function send(rating) {
  busy.value = true
  error.value = null

  try {
    await rateLevel(props.releaseId, props.levelId, rating)
    chosen.value = rating
    done.value = true
  } catch (e) {
    // The likely refusal is "you have not finished this level in this version",
    // which happens when the finish has not reached the server yet. Saying so
    // beats a silent no-op.
    error.value = e.status === 403
      ? 'Finish the level first — your run has not reached the server yet.'
      : e.message
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.rate { margin-top: 14px; }
.ask { margin: 0 0 8px; font-size: 12px; color: var(--muted); }
.thanks { margin: 0; font-size: 12px; color: var(--muted); }

.scale { display: flex; gap: 4px; justify-content: center; }
.pip {
  width: 26px; height: 26px; padding: 0; cursor: pointer;
  font: inherit; font-size: 11px; font-family: var(--font-mono);
  color: var(--muted); background: rgba(16, 26, 32, 0.8);
  border: 1px solid var(--line); border-radius: 7px;
  transition: color 0.12s, border-color 0.12s, background 0.12s;
}
.pip.hot { color: #0b1014; background: #ffd9a0; border-color: #ffd9a0; }
.pip:disabled { opacity: 0.5; cursor: default; }

.err { margin: 8px 0 0; font-size: 11.5px; color: #e0736b; }
</style>
