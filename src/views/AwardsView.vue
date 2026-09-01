<template>
  <div class="screen">
    <header class="head">
      <button class="btn ghost" @click="$emit('back')">← Menu</button>
      <h2>Achievements</h2>
      <span v-if="!loading" class="score">{{ points }} points</span>
    </header>

    <p v-if="loading" class="state">Loading…</p>
    <p v-else-if="failed" class="state err">{{ failed }}</p>

    <template v-else>
      <nav class="tabs">
        <button class="tab" :class="{ on: tab === 'mine' }" @click="tab = 'mine'">Mine</button>
        <button class="tab" :class="{ on: tab === 'all' }" @click="openRanking">Everyone</button>
      </nav>

      <ul v-if="tab === 'mine'" class="list">
        <!--
          The unearned ones are shown too, and not greyed into invisibility.
          A list of what you have is a trophy cabinet; a list of what exists is
          a reason to play.
        -->
        <li v-for="a in achievements" :key="a.code" class="award" :class="{ got: a.earned }">
          <div class="what">
            <span class="title">{{ a.title }}</span>
            <span class="desc">{{ a.description }}</span>
          </div>
          <span class="pts">{{ a.points }}</span>
          <span v-if="a.times > 1" class="times">×{{ a.times }}</span>
        </li>
      </ul>

      <ol v-else class="list">
        <li v-for="row in board" :key="row.userId" class="rank">
          <span class="place">{{ row.place }}</span>
          <img v-if="row.avatar" :src="row.avatar" alt="" class="face" />
          <span class="who">{{ row.name }}</span>
          <span class="pts">{{ row.points }}</span>
        </li>
      </ol>
    </template>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { myAwards, ranking } from '../core/awards.js'

defineEmits(['back'])

const loading = ref(true)
const failed = ref(null)
const tab = ref('mine')
const points = ref(0)
const achievements = ref([])
const board = ref([])

onMounted(async () => {
  try {
    const data = await myAwards()
    points.value = data.points
    achievements.value = data.achievements
  } catch (e) {
    failed.value = `Could not load your achievements: ${e.message}`
  } finally {
    loading.value = false
  }
})

// Fetched when the tab is opened rather than up front: most visits are to see
// your own progress, and a board nobody looked at is a request nobody needed.
async function openRanking() {
  tab.value = 'all'

  if (board.value.length) return

  try {
    board.value = (await ranking()).ranking
  } catch (e) {
    failed.value = `Could not load the ranking: ${e.message}`
  }
}
</script>

<style scoped>
.screen {
  position: absolute; inset: 0; overflow-y: auto;
  padding: clamp(20px, 5vw, 56px); background: var(--ink);
}
.head { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; }
.head h2 { font-family: var(--font-display); font-size: 30px; margin: 0; }
.score { font-family: var(--font-mono); font-size: 13px; color: #ffd9a0; margin-left: auto; }

.state { font-size: 13px; color: var(--muted); }
.state.err { color: #e0736b; }

.tabs { display: flex; gap: 6px; margin-bottom: 14px; }
.tab {
  font: inherit; font-size: 12px; padding: 6px 14px; cursor: pointer;
  color: var(--muted); background: rgba(16, 26, 32, 0.6);
  border: 1px solid var(--line); border-radius: 999px;
}
.tab.on { color: var(--text); border-color: rgba(160, 190, 210, 0.6); }

.list { list-style: none; margin: 0; padding: 0; max-width: 560px; }
.award, .rank {
  display: flex; align-items: center; gap: 12px;
  padding: 11px 14px; border-bottom: 1px solid var(--line);
}
.award { opacity: 0.45; }
.award.got { opacity: 1; }
.what { flex: 1; display: flex; flex-direction: column; }
.title { font-size: 14px; color: var(--text); }
.desc { font-size: 12px; color: var(--muted); margin-top: 2px; }
.pts { font-family: var(--font-mono); font-size: 13px; color: #ffd9a0; }
.times { font-family: var(--font-mono); font-size: 11px; color: var(--muted); }

.place { font-family: var(--font-mono); font-size: 12px; color: var(--muted); min-width: 22px; }
.face { width: 24px; height: 24px; border-radius: 50%; }
.who { flex: 1; font-size: 14px; }
</style>
