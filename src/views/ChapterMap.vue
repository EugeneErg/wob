<template>
  <div class="screen">
    <header class="bar">
      <button class="btn ghost small" @click="$emit('back')">← Chapters</button>
      <h2>{{ ch?.title }}</h2>
      <template v-if="mode === 'edit'">
        <button class="btn small" @click="hotOpen = !hotOpen">Pinned assets</button>
        <button class="btn small" @click="pic">Image</button>
        <button class="btn small primary" @click="addLevel">New level</button>
      </template>
      <template v-else>
        <span class="counter">{{ passed }} / {{ nodes.length }}</span>
        <!-- The attempt clock. It only runs inside levels: the map produces no
             ticks, so choosing a branch and thinking cost nothing. -->
        <span v-if="run" class="igt" :class="{ sr: speedrun }">
          {{ igt }}<i>{{ inStory ? 'whole story' : speedrun ? 'speedrun' : 'playthrough' }}</i>
        </span>
        <button class="btn small" @click="$emit('runs', { kind: 'chapter', targetId: chapterId })">
          Chapter runs
        </button>
      </template>
    </header>

    <section v-if="hotOpen && mode === 'edit'" class="hot">
      <p class="note">Pinned assets rise to the top of the editor list in every level of this chapter.</p>
      <button
        v-for="a in allAssets" :key="a.id"
        class="chip" :class="{ on: isHot(a.id) }"
        @click="toggleHot(a.id)"
      >{{ a.title }}</button>
    </section>

    <!-- Choosing the mode. What sets a speedrun apart is that only what this
         attempt has opened is open: no starting from the middle on an old save,
         and no rewinding inside a level either. -->
    <div class="map-wrap">
      <div
        ref="map" class="map" :style="coverStyle(ch?.image)"
        @pointerdown="onEmpty" @pointermove="onMove" @pointerup="onUp" @pointerleave="onUp"
      >
        <svg class="paths" viewBox="0 0 100 100" preserveAspectRatio="none">
          <line
            v-for="(e, i) in shownEdges" :key="i"
            :x1="pos(e.from).x" :y1="pos(e.from).y" :x2="pos(e.to).x" :y2="pos(e.to).y"
            :class="{ dim: mode === 'edit' && !visible(e) }"
          />
        </svg>

        <button
          v-for="n in nodes" :key="n.levelId"
          class="node"
          :class="{ done: isDone(n.levelId), locked: isLocked(n), sel: sel === n.levelId, exit: !!n.next }"
          :style="{ left: n.x + '%', top: n.y + '%' }"
          @pointerdown.stop="onDown(n, $event)"
          @dblclick.stop="mode === 'edit' && $emit('edit', n.levelId)"
        >
          <span class="dot" />
          <span class="cap">{{ name(n.levelId) }}<span v-if="n.next" class="arrow">→ {{ chapterName(n.next) }}</span></span>
        </button>

        <!-- the menu next to the node itself -->
        <div
          v-if="mode === 'edit' && selectedNode"
          class="menu"
          :style="menuStyle"
          @pointerdown.stop @click.stop
        >
          <div class="menu-head">{{ selected?.name }}</div>
          <button class="item" @click="$emit('edit', sel)">Edit</button>
          <button class="item" @click="copy">Duplicate</button>
          <button class="item danger" @click="drop">Delete level</button>

          <!-- Where the chapter leads if the player left through this level.
               The link is what makes a node an exit: without it a node with no
               paths out is a dead end, and finishing it does not complete the
               chapter. -->
          <label class="menu-field">
            <span>Leads on to</span>
            <select :value="selectedNode?.next || ''" @change="setNext($event.target.value)">
              <option value="">— not an exit —</option>
              <option v-for="c in otherChapters" :key="c.id" :value="c.id">{{ c.title }}</option>
            </select>
          </label>
          <div class="menu-note">Shift-click another node to draw a path</div>
        </div>

        <!-- While playing, a node has a menu too, but only one entry: your own
             runs on this level. Clicking the node still starts it. -->
        <div
          v-if="mode === 'play' && selectedNode"
          class="menu"
          :style="menuStyle"
          @pointerdown.stop @click.stop
        >
          <div class="menu-head">{{ selected?.name }}</div>
          <!-- The mode is chosen here too. With a speedrun already running
               above, there is no choice: the level is part of that attempt and
               there is nothing to decide for it. -->
          <template v-if="speedrun">
            <button class="item" @click="startLevel(sel, false)">Continue the run</button>
          </template>
          <template v-else>
            <button class="item" @click="startLevel(sel, false)">Play through</button>
            <button class="item sr" @click="startLevel(sel, true)">Speedrun this level</button>
          </template>
          <button class="item" @click="$emit('runs', { kind: 'level', targetId: sel })">My runs</button>
        </div>

        <p v-if="!nodes.length" class="empty">
          {{ mode === 'edit' ? 'Empty so far — add the first level.' : 'This chapter has no levels yet.' }}
        </p>
      </div>

      <p v-if="mode === 'edit' && routingNeeded" class="alarm">
        This chapter has several endings ({{ dead.join(', ') }}) and none of them leads anywhere.
        While that holds, the chapter never counts as finished: there is no telling which ending is
        the real one and which is a side branch. Link the next chapter to the node you mean.
      </p>
      <p v-else-if="mode === 'edit' && dead.length" class="note-dead">
        Dead ends (playable, but they do not complete the chapter): {{ dead.join(', ') }}
      </p>

      <p class="hint">{{ hint }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import * as lib from '../core/library.js'
import { createLevel, deleteLevel, saveChapterMap } from '../core/authoring.js'
import { session } from '../core/session.js'
import { pickImage, coverStyle } from '../core/fileio.js'
import { shouldAsk } from '../core/modes.js'
import { deadEnds, needsRouting, openNodes } from '../core/chain.js'
import { formatTime } from '../core/replays.js'

const props = defineProps({
  mode: { type: String, default: 'play' },
  chapterId: String,
  // The chapter attempt in progress (ChainRun). Without one, the mode is asked first
  run: { type: Object, default: null },
  speedrun: { type: Boolean, default: false },
  // where the speedrun began: null | 'story' | 'chapter' | 'level'
  srScope: { type: String, default: null },
  // The chapter was opened inside a story playthrough
  inStory: { type: Boolean, default: false },
  // The release, when one is being played: level names and the chapter's
  // contents come from it
  release: { type: Object, default: null },
})
const emit = defineEmits(['back', 'play', 'edit', 'start', 'runs'])

// ref wraps the chapter in a reactive proxy: edits to nodes show up at once and
// are written into the same library object that gets saved later.
//
// This used to be a computed, which returned the same object every time — Vue
// concluded nothing had changed and the map did not redraw until a reload.
const fromRelease = (id) => props.release?.chapters.find((c) => c.id === id) || null
const levelOf = (id) => props.release?.levels.find((l) => l.id === id) || lib.level(id)
const ch = ref(fromRelease(props.chapterId) || lib.chapter(props.chapterId))
const tick = ref(0)
// tick is for the places where the library edits the object directly, past the
// proxy: a new array on every change, or Vue sees no difference
const nodes = computed(() => (tick.value, [...(ch.value?.nodes || [])]))
const map = ref(null)
const sel = ref(null)
const hotOpen = ref(false)
let drag = null

const allAssets = computed(() => lib.assets())
const isHot = (id) => lib.isHot('chapter', props.chapterId, id)
const toggleHot = (id) => { lib.toggleHot('chapter', props.chapterId, id); tick.value++ }

// What counts as finished. In a speedrun, only what was finished in THIS
// attempt: past achievements open no doors, or the chapter could be started
// from the middle. In ordinary play, the overall progress as before.
//
// Within a story attempt only the visits belonging to this chapter count: the
// attempt holds segments from every chapter at once.
const doneSet = computed(() => {
  tick.value
  const r = props.run
  if (!r) return null
  if (!props.inStory) return r.done
  const s = new Set()
  for (const g of r.segments) if (g.finished && g.chapterId === props.chapterId) s.add(g.levelId)
  return s
})
const isDone = (id) => (doneSet.value ? doneSet.value.has(id) : lib.isDone(id))
const igt = computed(() => (props.run ? formatTime(props.run.ticks) : '0.000'))

const name = (id) => levelOf(id)?.name || '?'
const chapterName = (id) => (fromRelease(id) || lib.chapter(id))?.title || '?'
const startLevel = (id, speedrun = false) => { sel.value = null; emit('play', id, speedrun) }
const passed = computed(() => nodes.value.filter((n) => isDone(n.levelId)).length)
const selected = computed(() => (sel.value ? levelOf(sel.value) : null))
const selectedNode = computed(() => nodes.value.find((n) => n.levelId === sel.value) || null)
const menuStyle = computed(() => {
  const n = selectedNode.value
  if (!n) return {}
  const dx = n.x > 68 ? '-100%' : n.x < 32 ? '0%' : '-50%'
  const below = n.y < 62
  return {
    left: n.x + '%',
    top: n.y + '%',
    transform: `translate(${dx}, ${below ? '26px' : 'calc(-100% - 26px)'})`,
  }
})

const pos = (levelId) => nodes.value.find((n) => n.levelId === levelId) || { x: 50, y: 50 }
// A path is visible once the level it leads from is finished. Within a running
// attempt this is judged by that attempt's own progress: a speedrun writes no
// overall progress at all, so going by that made every path invisible and the
// map looked like a scatter of unconnected dots.
const visible = (e) => (doneSet.value ? doneSet.value.has(e.from) : lib.edgeVisible(e))
const shownEdges = computed(() =>
  (ch.value?.edges || []).filter((e) => props.mode === 'edit' || visible(e)))
// Which nodes are open. The same rule either way, but judged by the progress of
// the attempt in progress rather than by the overall save.
const openSet = computed(() =>
  (tick.value, doneSet.value && ch.value ? new Set(openNodes(ch.value, doneSet.value)) : null))
const isLocked = (n) => {
  if (props.mode !== 'play') return false
  if (openSet.value) return !openSet.value.has(n.levelId)
  return !lib.levelOpen(ch.value, n.levelId)
}

const hint = computed(() => {
  if (props.mode === 'play') return 'Open levels glow brighter. Click to play, press and hold for the menu with recorded runs.'
  return 'Click a node for its menu, double-click to open it, drag to move it, shift-click a second node to draw a path.'
})

// Clicks on a node are worked out by hand: the map captures the pointer in
// order to drag, and the click event goes with it — it never reaches the
// button.
function onDown(n, e) {
  drag = { n, moved: 0, shift: e.shiftKey, at: Date.now(), long: false }
  // Press and hold is the same as a right click, but works with a finger.
  if (props.mode === 'play') {
    const d = drag
    setTimeout(() => { if (drag === d) d.long = true }, 450)
  }
  if (props.mode === 'edit') map.value.setPointerCapture?.(e.pointerId)
}

function onEmpty() { drag = { empty: true, moved: 0 } }

function onMove(e) {
  if (!drag) return
  drag.moved++
  if (!drag.n || props.mode !== 'edit') return
  const r = map.value.getBoundingClientRect()
  const x = ((e.clientX - r.left) / r.width) * 100
  const y = ((e.clientY - r.top) / r.height) * 100
  drag.n.x = Math.max(2, Math.min(98, x))
  drag.n.y = Math.max(4, Math.min(96, y))
}

function onUp() {
  const d = drag
  drag = null
  if (!d) return
  const click = d.moved < 3          // barely moved, so treat it as a click

  if (d.empty) { if (click) sel.value = null; return }
  if (props.mode !== 'edit') {
    if (!click) return
    if (isLocked(d.n)) return
    // Inside a running speedrun the mode was chosen above, so start straight
    // away in one tap. Otherwise open the menu: play through or speedrun this
    // level, plus the recordings.
    if (props.speedrun) { emit('play', d.n.levelId, false); return }
    sel.value = sel.value === d.n.levelId ? null : d.n.levelId
    return
  }
  if (!click) { lib.save(); pushMap(); return }
  if (d.shift && sel.value && sel.value !== d.n.levelId) link(sel.value, d.n.levelId)
  else sel.value = d.n.levelId
}

function link(a, b) {
  const edges = ch.value.edges
  const i = edges.findIndex((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a))
  if (i >= 0) edges.splice(i, 1)
  else edges.push({ from: a, to: b })
  lib.save(); pushMap(); tick.value++
}

function addLevel() {
  const l = lib.createLevel(props.chapterId)
  tick.value++

  // Created on the server before the author has drawn anything in it, so an
  // empty level is the most that a lost tab can cost.
  if (session.status === 'signed-in') {
    const node = (ch.value.nodes || []).find((n) => n.levelId === l.id)
    createLevel(storyId.value, props.chapterId, l, node)
  }

  emit('edit', l.id)
}
function copy() {
  const made = lib.copyLevel(props.chapterId, sel.value)
  tick.value++

  if (session.status === 'signed-in' && made) {
    const node = (ch.value.nodes || []).find((n) => n.levelId === made.id)
    createLevel(storyId.value, props.chapterId, made, node)
    // A copy has contents from the moment it exists, so the map entry alone
    // would not be enough to reconstruct it.
    pushMap()
  }
}
function drop() {
  const l = selected.value
  if (l && confirm(`Delete "${l.name}"?`)) { lib.removeLevel(props.chapterId, l.id); sel.value = null; tick.value++ }
}
// The other chapters of this story, as places to lead on to. A chapter leaves
// itself out: an exit into itself is not an exit, it is a loop.
const otherChapters = computed(() =>
  (tick.value, lib.chaptersOf(ch.value?.storyId).filter((c) => c.id !== props.chapterId)))

function setNext(chapterId) {
  const n = selectedNode.value
  if (!n) return
  if (chapterId) n.next = chapterId
  else delete n.next
  lib.save(); pushMap(); tick.value++
}

// Dead ends: nodes with nowhere to go and nothing linked to follow them. While
// there are several endings and none is linked, the chapter never counts as
// finished — only the author knows which one is the real ending.
const names = (ids) => ids.map((id) => levelOf(id)?.name || id)
const dead = computed(() => (tick.value, ch.value ? names(deadEnds(ch.value)) : []))
const routingNeeded = computed(() => (tick.value, ch.value ? needsRouting(ch.value) : false))

async function pic() {
  const url = await pickImage().catch(() => null)
  if (url) { ch.value.image = url; lib.save(); tick.value++ }
}
</script>

<style scoped>
.screen { position: absolute; inset: 0; overflow: auto; display: flex; flex-direction: column; }
.bar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 18px clamp(16px, 4vw, 44px) 12px;
}
.bar h2 { flex: 1; margin: 0; font-family: var(--font-display); font-size: 26px; }
.counter { font-family: var(--font-mono); font-size: 13px; color: var(--moss); }
.hot {
  margin: 0 clamp(16px, 4vw, 44px) 14px; padding: 14px 16px;
  border: 1px solid var(--line); border-radius: 12px; background: var(--panel);
  display: flex; flex-wrap: wrap; gap: 8px;
}
.note { color: var(--muted); font-size: 12px; margin: 0 0 4px; width: 100%; }
.chip {
  font: inherit; font-size: 12px; padding: 5px 11px; border-radius: 999px;
  border: 1px solid var(--line); background: #101a20; color: var(--muted); cursor: pointer;
}
.chip.on { border-color: var(--goo); color: #ffd9a0; background: rgba(226, 112, 74, 0.14); }

.pick {
  margin: 0 clamp(16px, 4vw, 44px) 16px; padding: 16px 18px;
  border: 1px solid var(--line); border-radius: 14px; background: var(--panel);
}
.pick h3 { margin: 0 0 12px; font-family: var(--font-display); font-size: 20px; }
.pick .row { display: flex; gap: 10px; flex-wrap: wrap; }
.pick .btn i {
  display: block; font-style: normal; font-family: var(--font-mono);
  font-size: 10.5px; opacity: 0.75; margin-top: 3px;
}
.warn-pick { margin: 12px 0 0; font-size: 12px; color: #ffd9a0; }
.igt {
  font-family: var(--font-mono); font-size: 15px; color: var(--text);
  border: 1px solid var(--line); border-radius: 999px; padding: 5px 14px;
}
.igt i { display: block; font-style: normal; font-size: 9.5px; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--muted); }
.igt.sr { color: #ffd9a0; border-color: #8c5a2c; }
.map-wrap { position: relative; padding: 0 clamp(16px, 4vw, 44px) 24px; }
.map {
  position: relative; aspect-ratio: 16 / 9; width: 100%; max-height: 56vh; margin: 0 auto;
  border: 1px solid var(--line); border-radius: 16px; overflow: hidden;
  touch-action: none;
}
.paths { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.paths line {
  stroke: #e8c88f; stroke-width: 0.6; stroke-dasharray: 1.6 1.8; stroke-linecap: round;
  vector-effect: non-scaling-stroke; opacity: 0.85;
}
.paths line.dim { stroke: var(--muted); opacity: 0.4; }

.node {
  position: absolute; transform: translate(-50%, -50%);
  background: none; border: none; cursor: pointer; padding: 0;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
}
.dot {
  width: 26px; height: 26px; border-radius: 50%;
  background: var(--goo); border: 3px solid #2a1207;
  box-shadow: 0 0 0 4px rgba(226, 112, 74, 0.25), 0 4px 10px rgba(0, 0, 0, 0.5);
}
.node.done .dot { background: var(--moss); box-shadow: 0 0 0 4px rgba(143, 179, 106, 0.25); }
.node.locked { cursor: not-allowed; }
.node.locked .dot { background: #4a5761; box-shadow: none; opacity: 0.7; }
.node.sel .dot { outline: 2px solid #ffd9a0; outline-offset: 4px; }
.cap {
  font-size: 12px; color: var(--text); background: rgba(11, 16, 20, 0.78);
  padding: 2px 8px; border-radius: 999px; white-space: nowrap;
}
.node.locked .cap { color: var(--muted); }
.empty {
  position: absolute; inset: 0; display: grid; place-items: center;
  margin: 0; color: var(--muted); font-size: 14px;
}
.hint { font-family: var(--font-mono); font-size: 11.5px; color: var(--muted); margin: 10px 2px 0; }

.menu {
  position: absolute; z-index: 4; min-width: 180px;
  border: 1px solid var(--line); border-radius: 12px; overflow: hidden;
  background: rgba(16, 26, 32, 0.96); backdrop-filter: blur(6px);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45);
}
.menu-head {
  padding: 9px 12px; font-size: 13px; font-weight: 700;
  border-bottom: 1px solid var(--line);
}
.menu .item {
  display: block; width: 100%; text-align: left; background: none; border: none;
  color: var(--text); font: inherit; font-size: 13px; padding: 9px 12px; cursor: pointer;
}
.menu .item:hover { background: rgba(226, 112, 74, 0.16); color: #ffd9a0; }
.menu .item.danger:hover { background: rgba(140, 59, 44, 0.3); color: #ffb9a4; }
.item.sr { color: #ffd9a0; }
.menu-field {
  display: block; padding: 9px 12px; border-top: 1px solid var(--line);
  font-size: 12px; color: var(--muted);
}
.menu-field span { display: block; margin-bottom: 5px; }
.menu-field select {
  width: 100%; font: inherit; font-size: 12px; padding: 5px 7px;
  background: #101a20; color: var(--text); border: 1px solid var(--line); border-radius: 7px;
}
.alarm {
  margin: 10px 2px 0; padding: 9px 12px; border-radius: 10px;
  border: 1px solid #8c5a2c; background: rgba(140, 90, 44, 0.14); color: #ffd9a0;
  font-size: 12.5px; line-height: 1.45;
}
.note-dead { margin: 10px 2px 0; font-family: var(--font-mono); font-size: 11px; color: var(--muted); }
.node.exit .dot { border-color: #e8c88f; box-shadow: 0 0 0 4px rgba(232, 200, 143, 0.28); }
.arrow { margin-left: 6px; color: #e8c88f; font-size: 11px; }
.menu-note {
  padding: 8px 12px; border-top: 1px solid var(--line);
  font-family: var(--font-mono); font-size: 10.5px; color: var(--muted);
}
</style>
