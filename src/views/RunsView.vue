<template>
  <div class="screen">
    <header class="bar">
      <button class="btn ghost small" @click="$emit('back')">← Back</button>
      <h2>Runs: {{ title }}</h2>
      <span v-if="best" class="best">best {{ fmt(best.ticks, best.rate) }}</span>
    </header>

    <!--
      Two lists, and they answer different questions. The board is how you
      compare against everyone; the recordings below are your own attempts,
      including the ones that fell apart — which are usually the interesting
      ones to watch back.
    -->
    <nav class="tabs">
      <button class="tab" :class="{ on: tab === 'mine' }" @click="tab = 'mine'">My runs</button>
      <button class="tab" :class="{ on: tab === 'board' }" @click="openBoard">Leaderboard</button>
    </nav>

    <section v-if="tab === 'board'" class="board">
      <p v-if="!releaseId" class="empty">
        This is the author's draft, so there is no board: times only compare
        within one published version.
      </p>
      <p v-else-if="boardLoading" class="empty">Loading the board…</p>
      <p v-else-if="boardError" class="empty err">{{ boardError }}</p>
      <p v-else-if="!board.length" class="empty">Nobody has set a time here yet.</p>

      <ol v-else class="ranks">
        <li v-for="row in board" :key="row.recordId" class="rank">
          <span class="place">{{ row.place }}</span>
          <img v-if="row.avatar" :src="row.avatar" alt="" class="face" />
          <span class="who">{{ row.runner }}</span>
          <span class="ticks">{{ fmt(row.ticks, 60) }}</span>
          <!--
            Nothing is verified until the replay worker exists, and a board that
            presented claims as checked facts would be lying by omission.
          -->
          <i v-if="!row.verified" class="unchecked" title="Not yet re-run by the server">unverified</i>
        </li>
      </ol>

      <p v-if="personalBest" class="mine">
        Your best here: {{ fmt(personalBest.ticks, 60) }}
      </p>
    </section>

    <template v-else>

    <p v-if="!loading && !list.length" class="empty">
      Nothing here yet. Finish a level and the run records itself,
      ready to watch back.
    </p>
    <p v-else-if="loading" class="empty">Reading recordings…</p>

    <ul v-else class="runs">
      <li v-for="r in list" :key="r.id" class="run" :class="{ best: best && r.id === best.id }">
        <div class="left">
          <span class="time">{{ fmt(r.ticks, r.rate) }}</span>
          <span class="tags">
            <i v-if="r.speedrun" class="tag sr">speedrun</i>
            <i v-else class="tag">playthrough</i>
            <i v-if="r.kind !== 'level'" class="tag">{{ r.category === '100' ? '100%' : 'any%' }}</i>
            <i v-if="!r.finished" class="tag dim">unfinished</i>
            <i v-if="r.clean === false" class="tag warn">rewound</i>
          </span>
        </div>

        <div class="mid">
          <span class="when">{{ when(r.at) }}</span>
          <span v-if="r.segments" class="sub">{{ r.segments.length }} visits</span>
          <span v-else-if="r.input" class="sub">{{ r.input.length / 4 }} inputs</span>
          <!-- A stale recording is neither hidden nor unplayable, just plainly
               marked: it was taken on a different version, so there is nothing
               to compare its time against today's records. -->
          <span v-if="stale(r)" class="sub old">{{ stale(r) }}</span>
        </div>

        <div class="right">
          <button class="btn small primary" :disabled="!playable(r)" @click="$emit('watch', r)">
            Watch
          </button>
          <button class="btn small danger" @click="drop(r)">Delete</button>
        </div>
      </li>
    </ul>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { runsFor, bestRun, removeRun, formatTime, checkRecord } from '../core/replays.js'
import { leaderboard } from '../core/records.js'
import * as lib from '../core/library.js'

const props = defineProps({
  kind: { type: String, default: 'level' },   // level | chapter | story
  targetId: { type: String, required: true },
  // Which published version these runs belong to. Null for the author's draft,
  // where a board would be meaningless: times only compare within one frozen
  // version of the content.
  releaseId: { type: String, default: null },
})
defineEmits(['back', 'watch'])

const list = ref([])

const tab = ref('mine')
const board = ref([])
const personalBest = ref(null)
const boardLoading = ref(false)
const boardError = ref(null)

// Fetched when the tab is opened rather than on mount: most visits here are to
// rewatch your own attempt, and a board nobody looked at is a request nobody
// needed.
async function openBoard() {
  tab.value = 'board'

  if (!props.releaseId || board.value.length) return

  boardLoading.value = true
  boardError.value = null

  try {
    const data = await leaderboard(props.releaseId, { scope: props.kind, target: props.targetId })
    board.value = data.board
    personalBest.value = data.personalBest
  } catch (e) {
    boardError.value = `Could not load the board: ${e.message}`
  } finally {
    boardLoading.value = false
  }
}
const best = ref(null)
const loading = ref(true)

const title = computed(() =>
  props.kind === 'level' ? lib.level(props.targetId)?.name || '?'
    : props.kind === 'chapter' ? lib.chapter(props.targetId)?.title || '?'
      : lib.story(props.targetId)?.title || '?')

const fmt = (ticks, rate) => formatTime(ticks, rate || 60)

// Sorted by time: the fast ones are the interesting ones to watch. Unfinished
// runs go last — they are not about the result but about how it fell apart.
async function load() {
  loading.value = true
  const all = await runsFor(props.targetId, { kind: props.kind })
  list.value = all.sort((a, b) => (b.finished - a.finished) || (a.ticks - b.ticks))
  best.value = await bestRun(props.targetId, { kind: props.kind })
  loading.value = false
}
onMounted(load)

// A recording from another version can still be played; claiming it matches
// would be the lie.
const stale = (r) => {
  const v = checkRecord(r)
  return v.ok ? null : v.text
}
// There is nothing to watch only when there is no input recording at all
const playable = (r) => !!(r.input?.length || r.segments?.length)

const when = (t) => {
  const d = new Date(t)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay
    ? `today ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

async function drop(r) {
  if (!confirm(`Delete the ${fmt(r.ticks, r.rate)} run?`)) return
  await removeRun(r.id)
  await load()
}
</script>

<style scoped>
.tabs { display: flex; gap: 6px; margin-bottom: 14px; }
.tab {
  font: inherit; font-size: 12px; padding: 6px 14px; cursor: pointer;
  color: var(--muted); background: rgba(16, 26, 32, 0.6);
  border: 1px solid var(--line); border-radius: 999px;
}
.tab.on { color: var(--text); border-color: rgba(160, 190, 210, 0.6); }

.ranks { list-style: none; margin: 0; padding: 0; max-width: 520px; }
.rank {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 12px; border-bottom: 1px solid var(--line);
}
.place { font-family: var(--font-mono); font-size: 12px; color: var(--muted); min-width: 22px; }
.face { width: 22px; height: 22px; border-radius: 50%; }
.who { flex: 1; font-size: 13px; }
.ticks { font-family: var(--font-mono); font-size: 13px; color: #ffd9a0; }
.unchecked {
  font-style: normal; font-size: 10px; font-family: var(--font-mono);
  color: var(--muted); border: 1px solid var(--line); border-radius: 5px; padding: 1px 5px;
}
.mine { margin: 12px 0 0; font-size: 12px; color: var(--muted); }
.empty.err { color: #e0736b; }

.screen { position: absolute; inset: 0; overflow: auto; display: flex; flex-direction: column; }
.bar { display: flex; align-items: center; gap: 12px; padding: 18px clamp(16px, 4vw, 44px) 12px; }
.bar h2 { flex: 1; margin: 0; font-family: var(--font-display); font-size: 24px; }
.best { font-family: var(--font-mono); font-size: 13px; color: var(--moss); }
.empty { margin: 40px clamp(16px, 4vw, 44px); color: var(--muted); font-size: 14px; max-width: 46ch; line-height: 1.5; }

.runs { list-style: none; margin: 0; padding: 0 clamp(16px, 4vw, 44px) 32px; display: grid; gap: 8px; }
.run {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding: 12px 16px; border: 1px solid var(--line); border-radius: 12px;
  background: var(--panel);
}
.run.best { border-color: var(--moss); }
.left { display: flex; flex-direction: column; gap: 6px; min-width: 150px; }
.time { font-family: var(--font-mono); font-size: 20px; color: #ffd9a0; }
.tags { display: flex; gap: 5px; flex-wrap: wrap; }
.tag {
  font-style: normal; font-family: var(--font-mono); font-size: 9.5px;
  letter-spacing: 0.1em; text-transform: uppercase;
  border: 1px solid var(--line); border-radius: 999px; padding: 2px 7px; color: var(--muted);
}
.tag.sr { color: #ffd9a0; border-color: #8c5a2c; }
.tag.dim { opacity: 0.6; }
.tag.warn { color: #ffb9a4; border-color: #8c3b2c; }

.mid { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 140px; }
.when { font-size: 12.5px; color: var(--text); }
.sub { font-family: var(--font-mono); font-size: 10.5px; color: var(--muted); }
.sub.old { color: #d8b98a; }
.right { display: flex; gap: 8px; margin-left: auto; }
</style>
