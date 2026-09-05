<template>
  <div class="screen">
    <header class="head">
      <button class="btn ghost" @click="$emit('back')">← Stories</button>
      <h2>{{ storyTitle }}</h2>
    </header>

    <p v-if="loading" class="state">Loading your runs…</p>
    <p v-else-if="failed" class="state err">{{ failed }}</p>

    <template v-else>
      <p class="state">
        A run of its own each time. Finishing a level in one leaves the others
        exactly where you left them.
      </p>

      <ul class="slots">
        <li v-for="slot in slots" :key="slot.id" class="slot">
          <button class="body" @click="$emit('play', slot)">
            <span class="num">Slot {{ slot.number }}</span>
            <span class="label">{{ slot.label || 'Unnamed run' }}</span>
            <span class="meta">
              {{ slot.completed.length }} {{ slot.completed.length === 1 ? 'level' : 'levels' }} finished
              <template v-if="slot.lastPlayedAt"> · {{ when(slot.lastPlayedAt) }}</template>
            </span>
          </button>

          <!--
            Предложение доиграть на свежей версии. Показывается только когда
            переход возможен: предлагать то, чего нельзя, хуже, чем молчать.
          -->
          <p v-if="offers[slot.id]?.available" class="offer">
            {{ offers[slot.id].reason }}
            <button class="link go" :disabled="moving === slot.id" @click="upgrade(slot)">
              {{ moving === slot.id ? 'Переносим…' : `Перейти на версию ${offers[slot.id].version}` }}
            </button>
          </p>

          <div class="acts">
            <button class="link" @click="rename(slot)">Rename</button>
            <button class="link" @click="erase(slot)">Start over</button>
            <button class="link danger" @click="remove(slot)">Delete</button>
          </div>
        </li>

        <!--
          The empty places are shown rather than hidden, because a save menu is
          as much about what is free as about what is filled.
        -->
        <li v-for="n in free" :key="`free-${n}`" class="slot empty">
          <button class="body" :disabled="busy" @click="begin">
            <span class="num">Slot {{ n }}</span>
            <span class="label">Start a new run</span>
          </button>
        </li>
      </ul>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import {
  deleteSlot, eraseSlot, renameSlot, slotsFor, startSlot, takeUpgrade, upgradeOffer,
} from '../core/slots.js'
import { story as getStory } from '../core/library.js'

const props = defineProps({ storyId: { type: String, required: true } })
defineEmits(['back', 'play'])

const slots = ref([])

/*
 * Что можно предложить каждому прогону.
 *
 * Спрашивается по одному запросу на слот: их не больше горстки, а вопрос у
 * каждого свой — он зависит от того, где именно остановился этот прогон.
 *
 * Отказ не показывается. «Нельзя перейти, потому что вашего уровня больше нет»
 * — это не новость для игрока, который просто хочет доиграть; он и так доиграет
 * свою версию.
 */
const offers = ref({})
const moving = ref(null)

async function askOffers() {
  const found = {}

  await Promise.all(slots.value.map(async (s) => {
    try {
      found[s.id] = await upgradeOffer(s.id)
    } catch {
      // Молча: предложение — не то, ради чего человек сюда пришёл, и падать
      // экраном сохранений из-за него неправильно.
    }
  }))

  offers.value = found
}

async function upgrade(slot) {
  moving.value = slot.id

  try {
    await takeUpgrade(slot.id)
    await load()
  } catch (e) {
    failed.value = e.message
  } finally {
    moving.value = null
  }
}
const max = ref(3)
const loading = ref(true)
const busy = ref(false)
const failed = ref(null)

const storyTitle = computed(() => getStory(props.storyId)?.title || 'Story')

// Which numbers are still free. Derived rather than stored: the server decides
// what a slot may be numbered, and a second copy of that rule here would be one
// more thing able to drift.
const free = computed(() => {
  const taken = new Set(slots.value.map((s) => s.number))

  return Array.from({ length: max.value }, (_, i) => i + 1).filter((n) => !taken.has(n))
})

async function load() {
  loading.value = true
  failed.value = null

  try {
    const data = await slotsFor(props.storyId)
    slots.value = data.slots
    max.value = data.max
    askOffers()
  } catch (e) {
    failed.value = `Could not load your runs: ${e.message}`
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function begin() {
  busy.value = true

  try {
    await startSlot(props.storyId)
    await load()
  } catch (e) {
    failed.value = e.message
  } finally {
    busy.value = false
  }
}

async function rename(slot) {
  const label = prompt('Name this run', slot.label || '')

  if (label === null) return

  await renameSlot(slot.id, label.trim() || null)
  await load()
}

async function erase(slot) {
  if (!confirm(`Start slot ${slot.number} over? Everything finished in it is cleared.`)) return

  await eraseSlot(slot.id)
  await load()
}

async function remove(slot) {
  if (!confirm(`Delete slot ${slot.number}?`)) return

  await deleteSlot(slot.id)
  await load()
}

const when = (iso) => new Date(iso).toLocaleDateString()
</script>

<style scoped>
.screen {
  position: absolute; inset: 0; overflow-y: auto;
  padding: clamp(20px, 5vw, 56px); background: var(--ink);
}
.head { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; }
.head h2 { font-family: var(--font-display); font-size: 30px; margin: 0; }

.state { max-width: 520px; margin: 0 0 18px; font-size: 13px; color: var(--muted); line-height: 1.5; }
.state.err { color: #e0736b; }

.slots { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; max-width: 520px; }
.slot {
  border: 1px solid var(--line); border-radius: 14px;
  background: rgba(16, 26, 32, 0.62); overflow: hidden;
}
.slot.empty { border-style: dashed; background: none; }

.body {
  display: block; width: 100%; text-align: left; font: inherit; color: var(--text);
  background: none; border: 0; padding: 14px 18px; cursor: pointer;
}
.body:hover { background: rgba(22, 36, 44, 0.7); }
.body:disabled { opacity: 0.5; cursor: default; }

.num {
  display: block; font-family: var(--font-mono); font-size: 10px;
  letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted);
}
.label { display: block; font-family: var(--font-display); font-size: 19px; margin-top: 2px; }
.meta { display: block; font-size: 12px; color: var(--muted); margin-top: 3px; }

.offer {
  margin: 6px 0 0; font-size: 12px; color: #e8c88f;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.offer .go { color: #e8c88f; }
.acts { display: flex; gap: 14px; padding: 0 18px 12px; }
.link {
  background: none; border: 0; padding: 0; font: inherit; font-size: 12px;
  color: var(--muted); text-decoration: underline; cursor: pointer;
}
.link:hover { color: var(--text); }
.link.danger:hover { color: #e0736b; }
</style>
