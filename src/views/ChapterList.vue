<template>
  <div class="screen">
    <header class="bar">
      <button class="btn ghost small" @click="$emit('back')">← Stories</button>
      <h2>{{ story?.title }}</h2>
      <template v-if="mode === 'edit'">
        <button class="btn small" @click="hotOpen = !hotOpen">Pinned assets</button>
        <button class="btn small" @click="relOpen = !relOpen">
          Releases<i v-if="unreleased" class="dot" />
        </button>
        <button class="btn small primary" @click="add">New chapter</button>
      </template>
      <template v-else>
        <span v-if="run" class="igt" :class="{ sr: speedrun }">
          {{ igt }}<i>{{ speedrun ? 'story speedrun' : 'playthrough' }}</i>
        </span>
        <!-- Which version is being played. A release is frozen: its levels
             will not change again, which is what makes records on it
             comparable. The author's draft changes at any moment — playable,
             but there is nothing to compete against, and the screen says so. -->
        <label v-if="rels.length" class="ver">
          <select :value="releaseId || ''" @change="$emit('version', $event.target.value || null)">
            <option v-for="r in rels" :key="r.id" :value="r.id">Version {{ r.version }}</option>
            <option value="">Author's draft</option>
          </select>
        </label>
        <button class="btn small" @click="$emit('runs', { kind: 'story', targetId: storyId })">
          Story runs
        </button>
      </template>
    </header>

    <ul class="grid">
      <li v-for="(c, i) in list" :key="c.id" class="card" :class="{ locked: locked(c) }">
        <div class="cover" :style="coverStyle(c.image)" @click="open(c)">
          <span class="badge">Chapter {{ i + 1 }} · {{ c.nodes.length }} levels</span>
          <span v-if="locked(c)" class="lock">Locked</span>
          <span v-else-if="mode === 'play'" class="progress">{{ passed(c) }} / {{ c.nodes.length }}</span>
        </div>
        <div class="meta">
          <input v-if="mode === 'edit'" v-model="c.title" class="title-input" @change="persist" />
          <h3 v-else>{{ c.title }}</h3>
          <div class="row">
            <template v-if="mode === 'play'">
              <button class="btn small primary" :disabled="locked(c)" @click="open(c, false)">
                Play through
              </button>
              <!-- Inside a running speedrun there is nothing to choose: it was chosen above -->
              <button v-if="!speedrun" class="btn small sr" :disabled="locked(c)" @click="open(c, true)">
                Speedrun
              </button>
            </template>
            <button v-else class="btn small primary" @click="open(c)">Open</button>
            <template v-if="mode === 'edit'">
              <button class="btn small" @click="pic(c)">Image</button>
              <button class="btn small" @click="save(c)">Save to file</button>
              <button class="btn small danger" @click="drop(c)">Delete</button>
            </template>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import * as lib from '../core/library.js'
import { createChapter, deleteChapter } from '../core/authoring.js'
import { session } from '../core/session.js'
import { doneByChapter, openChapters } from '../core/chain.js'
import { formatTime } from '../core/replays.js'
import { publish, releases, drifted } from '../core/releases.js'
import { downloadJSON, pickImage, fileName, coverStyle } from '../core/fileio.js'

const props = defineProps({
  mode: { type: String, default: 'play' },
  storyId: String,
  // The story attempt in progress (ChainRun), if there is one
  run: { type: Object, default: null },
  speedrun: { type: Boolean, default: false },
  // where the speedrun began: null | 'story' | 'chapter' | 'level'
  srScope: { type: String, default: null },
  // which release is being played; null means the author's draft
  releaseId: { type: String, default: null },
  // The frozen snapshot of a release. When present, chapters and levels come
  // from it: playing a release must show what was released, not what the author
  // happens to be editing right now.
  release: { type: Object, default: null },
})
const emit = defineEmits(['back', 'open', 'runs', 'version'])

const story = computed(() => props.release?.story || lib.story(props.storyId))
const chaptersNow = () => props.release?.chapters || lib.chaptersOf(props.storyId)
const list = ref(chaptersNow())
const refresh = () => (list.value = chaptersNow())
const persist = () => lib.save()

const allAssets = computed(() => lib.assets())
const hotOpen = ref(false)
const isHot = (id) => lib.isHot('story', props.storyId, id)
const toggle = (id) => { lib.toggleHot('story', props.storyId, id); refresh() }

// What is unlocked. Within a story attempt, only what a finished exit inside
// THAT attempt leads to: past achievements do not open a chapter, or the story
// could be started from the middle.
const doneMap = computed(() => (props.run ? doneByChapter(props.run) : null))
const openSet = computed(() =>
  (doneMap.value && story.value
    ? new Set(openChapters(story.value, list.value, doneMap.value))
    : null))

const locked = (c) => {
  if (props.mode !== 'play') return false
  if (openSet.value) return !openSet.value.has(c.id)
  return !lib.chapterOpen(props.storyId, c.id)
}

// How many of the chapter's levels are done: within an attempt its own count,
// otherwise the overall one
const passed = (c) => {
  const d = doneMap.value?.get(c.id)
  return d ? c.nodes.filter((n) => d.has(n.levelId)).length
    : c.nodes.filter((n) => lib.isDone(n.levelId)).length
}

const igt = computed(() => (props.run ? formatTime(props.run.ticks) : '0.000'))

// Asked once, never nagged again: declining a speedrun must not bring the same
// question back every time the screen is looked at. The rule about whether to
// ask at all lives in modes.js and has a test.
// Releases
const relOpen = ref(false)
// Releases are re-read via a counter: publishing writes to localStorage, which
// Vue cannot observe, so the counter has to be nudged by hand.
const relTick = ref(0)
const rels = computed(() => (relTick.value, releases(props.storyId)))
const unreleased = computed(() => (relTick.value, props.storyId ? drifted(props.storyId) : false))
function doPublish() {
  const r = publish(props.storyId)
  relTick.value++
  if (r) relOpen.value = true
}
const when = (t) => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

// The second argument says whether a speedrun was asked for. It travels with
// the choice of chapter so that deciding and entering are one action rather
// than two screens.
function open(c, speedrun = false) { if (!locked(c)) emit('open', c.id, speedrun) }
function add() {
  const c = lib.createChapter(props.storyId)
  refresh()

  // Its own write, the moment it exists.
  if (session.status === 'signed-in') createChapter(props.storyId, c)

  emit('open', c.id)
}
function drop(c) {
  if (!confirm(`Delete "${c.title}" and its levels?`)) return

  lib.removeChapter(c.id)

  if (session.status === 'signed-in') deleteChapter(props.storyId, c.id)

  refresh()
}
async function pic(c) {
  const url = await pickImage().catch(() => null)
  if (url) { c.image = url; persist(); refresh() }
}
const save = (c) => downloadJSON(lib.exportChapter(c.id), fileName('chapter', c.title))
</script>

<style scoped>
.screen { position: absolute; inset: 0; overflow: auto; padding-bottom: 60px; }
.ver select {
  font: inherit; font-size: 12px; padding: 5px 9px;
  background: #101a20; color: var(--text); border: 1px solid var(--line); border-radius: 7px;
}
.draft-warn {
  margin: 0 clamp(16px, 4vw, 44px) 14px; padding: 9px 13px;
  border: 1px solid #8c5a2c; background: rgba(140, 90, 44, 0.14); color: #ffd9a0;
  border-radius: 10px; font-size: 12.5px; line-height: 1.45;
}
.sr { background: #8c5a2c; border-color: #a86c34; color: #fff2df; }
.rel {
  margin: 0 clamp(16px, 4vw, 44px) 18px; padding: 16px 18px;
  border: 1px solid var(--line); border-radius: 14px; background: var(--panel);
}
.rel-head { display: flex; align-items: center; gap: 12px; }
.rel-head h3 { flex: 1; margin: 0; font-family: var(--font-display); font-size: 19px; }
.rel-note { margin: 10px 0 0; font-size: 12.5px; color: var(--muted); line-height: 1.45; }
.rel-list { list-style: none; margin: 14px 0 0; padding: 0; display: grid; gap: 6px; }
.rel-list li {
  display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
  padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px;
  font-size: 12.5px;
}
.rel-list .when, .rel-list .what { color: var(--muted); }
.rel-list .hash { margin-left: auto; font-family: var(--font-mono); font-size: 10.5px; color: var(--muted); }
.dot {
  display: inline-block; width: 6px; height: 6px; margin-left: 6px;
  border-radius: 50%; background: var(--goo); vertical-align: middle;
}
.pick {
  margin: 0 clamp(16px, 4vw, 44px) 18px; padding: 16px 18px;
  border: 1px solid var(--line); border-radius: 14px; background: var(--panel);
}
.pick h3 { margin: 0 0 12px; font-family: var(--font-display); font-size: 20px; }
.pick .row { display: flex; gap: 10px; flex-wrap: wrap; }
.pick .btn i {
  display: block; font-style: normal; font-family: var(--font-mono);
  font-size: 10.5px; opacity: 0.75; margin-top: 3px;
}
.note-pick { margin: 12px 0 0; font-size: 12px; color: var(--muted); }
.igt {
  font-family: var(--font-mono); font-size: 15px; color: var(--text);
  border: 1px solid var(--line); border-radius: 999px; padding: 5px 14px;
}
.igt i { display: block; font-style: normal; font-size: 9.5px; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--muted); }
.igt.sr { color: #ffd9a0; border-color: #8c5a2c; }
.bar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 20px clamp(16px, 4vw, 44px); position: sticky; top: 0; z-index: 2;
  background: linear-gradient(var(--ink) 70%, transparent);
}
.bar h2 { flex: 1; margin: 0; font-family: var(--font-display); font-size: 26px; }
.hot {
  margin: 0 clamp(16px, 4vw, 44px) 18px; padding: 14px 16px;
  border: 1px solid var(--line); border-radius: 12px; background: var(--panel);
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
}
.note { width: 100%; margin: 0 0 4px; color: var(--muted); font-size: 12px; }
.chip {
  font: inherit; font-size: 12px; padding: 5px 11px; border-radius: 999px;
  border: 1px solid var(--line); background: #101a20; color: var(--muted); cursor: pointer;
}
.chip.on { border-color: var(--goo); color: #ffd9a0; background: rgba(226, 112, 74, 0.14); }
.grid {
  list-style: none; margin: 0; padding: 0 clamp(16px, 4vw, 44px);
  display: grid; gap: 20px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
}
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
.card.locked { opacity: 0.55; }
.cover { aspect-ratio: 16 / 9; cursor: pointer; position: relative; display: flex; align-items: flex-end; padding: 12px; }
.card.locked .cover { cursor: not-allowed; filter: grayscale(0.6); }
.badge, .progress, .lock {
  font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em;
  background: rgba(11, 16, 20, 0.72); border-radius: 999px; padding: 4px 10px; color: var(--text);
}
.progress { margin-left: auto; color: var(--moss); }
.lock { margin-left: auto; color: var(--muted); }
.meta { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 12px; }
.meta h3 { margin: 0; font-size: 17px; }
.title-input {
  background: none; border: 1px solid transparent; color: var(--text);
  font: inherit; font-size: 17px; font-weight: 700; padding: 4px 6px; border-radius: 8px; width: 100%;
}
.title-input:hover, .title-input:focus { border-color: var(--line); outline: none; background: #101a20; }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
