<template>
  <div class="screen">
    <header class="bar">
      <button class="btn ghost small" @click="$emit('back')">← Menu</button>
      <h2>{{ mode === 'play' ? (intent === 'speedrun' ? 'Speedrun' : 'Stories') : 'Story editor' }}</h2>
      <template v-if="mode === 'edit'">
        <button class="btn small" @click="doImport">Open a file</button>
        <button class="btn small" @click="dump">Export everything</button>
        <button class="btn small primary" @click="add">New story</button>
      </template>
    </header>

    <ul class="grid">
      <li v-for="s in list" :key="s.id" class="card">
        <div class="cover" :style="coverStyle(s.cover)" @click="$emit('open', s.id, false)">
          <span class="badge">{{ chapters(s.id).length }} chapters · {{ levelCount(s.id) }} levels</span>
          <span v-if="mode === 'play'" class="progress">{{ done(s.id) }} / {{ levelCount(s.id) }}</span>
        </div>
        <div class="meta">
          <input v-if="mode === 'edit'" v-model="s.title" class="title-input" @change="persist" />
          <h3 v-else>{{ s.title }}</h3>
          <div class="row">
            <!-- The mode is chosen right here, on the way in: not "play, then
                 decide somewhere inside", but what we are going in with. A
                 story speedrun covers its chapters and levels, so they will not
                 ask again.

                 Which of the two leads depends on what the player came for. The
                 buttons are the same either way; someone who arrived through
                 Speedrun should not have to hunt for it a second time. -->
            <template v-if="mode === 'play'">
              <button
                class="btn small" :class="intent === 'speedrun' ? 'sr primary' : 'primary'"
                @click="$emit('open', s.id, intent === 'speedrun')"
              >{{ intent === 'speedrun' ? 'Speedrun' : 'Play' }}</button>
              <button
                class="btn small" :class="intent === 'speedrun' ? '' : 'sr'"
                @click="$emit('open', s.id, intent !== 'speedrun')"
              >{{ intent === 'speedrun' ? 'Play' : 'Speedrun' }}</button>
            </template>
            <button v-else class="btn small primary" @click="$emit('open', s.id)">Open</button>
            <template v-if="mode === 'edit'">
              <button class="btn small" @click="cover(s)">Cover</button>
              <button class="btn small" @click="save(s)">Save to file</button>
              <button class="btn small danger" @click="drop(s)">Delete</button>
            </template>
          </div>
        </div>
      </li>
    </ul>

    <footer v-if="mode === 'edit'" class="foot">
      <button class="btn ghost small" @click="factory">Restore the built-in content</button>
      <span class="note">Opening a file always adds — nothing is ever overwritten.</span>
    </footer>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import * as lib from '../core/library.js'
import { loadCatalog, loadStory } from '../core/catalog.js'
import { createStory, deleteStory } from '../core/authoring.js'
import { session } from '../core/session.js'
import { loadState } from '../core/debug.js'
import { downloadJSON, pickJSON, pickImage, fileName, coverStyle } from '../core/fileio.js'

const props = defineProps({
  mode: { type: String, default: 'play' },
  // What brought the player here: 'play', 'speedrun' or 'create'. It only
  // decides which option is put forward, never what is possible.
  intent: { type: String, default: 'play' },
})
const emit = defineEmits(['back', 'open'])

const list = ref(lib.stories())
const refresh = () => (list.value = lib.stories())

// Содержимое приходит с сервера, и до ответа показывать нечего.
const loading = ref(false)
const failed = ref(null)

onMounted(async () => {
  // В редакторе каталог не нужен: там свои черновики, которые живут здесь.
  if (props.mode === 'edit') return

  loading.value = true
  failed.value = null

  try {
    const shelf = await loadCatalog({ force: true })

    // Каждую историю подтягиваем целиком: без глав и уровней карточка знает
    // только заголовок, а список показывает, сколько внутри.
    for (const story of [...shelf.canon, ...shelf.published]) {
      await loadStory(story.id)
    }

    preview.value = shelf.preview
    refresh()
  } catch (e) {
    failed.value = e.message
  } finally {
    loading.value = false
  }
})

const preview = ref(false)
const persist = () => lib.save()

const chapters = (id) => lib.chaptersOf(id)
const levelCount = (id) => chapters(id).reduce((n, c) => n + c.nodes.length, 0)
const done = (id) => chapters(id).reduce((n, c) => n + c.nodes.filter((x) => lib.isDone(x.levelId)).length, 0)

function add() {
  const { story } = lib.createStory()
  refresh()

  // Straight to the server, as its own write. Nothing an author makes should
  // exist only in this browser — a closed tab used to take the lot.
  if (session.status === 'signed-in') createStory(story, lib.chaptersOf(story.id)[0])

  emit('open', story.id)
}
function drop(s) {
  if (!confirm(`Delete "${s.title}" with all its chapters and levels?`)) return

  lib.removeStory(s.id)

  if (session.status === 'signed-in') deleteStory(s.id)

  refresh()
}
async function cover(s) {
  const url = await pickImage().catch(() => null)
  if (url) { s.cover = url; persist(); refresh() }
}
const save = (s) => downloadJSON(lib.exportStory(s.id), fileName('story', s.title))
const dump = () => downloadJSON(lib.exportAll(), 'goo-library')
async function doImport() {
  try {
    const data = await pickJSON()

    // A debug dump (F10 in game) is not a bundle of stories but a snapshot of
    // everything: library, progress, recordings, releases. The storage field is
    // what tells them apart. It has to be loaded whole and with a warning,
    // because it REPLACES rather than adds — otherwise someone else's case
    // cannot be reproduced.
    if (data?.storage) {
      const where = data.now?.levelId ? ` (level ${data.now.levelId}, tick ${data.now.tick ?? '?'})` : ''
      if (!confirm(`This is a debug dump from ${new Date(data.at).toLocaleString()}${where}.\n\n`
        + 'Your entire library, progress and recordings will be replaced. Continue?')) return
      loadState(data)
      refresh()
      alert('State loaded. Find the run in the recordings list and watch it back.')
      return
    }

    const added = lib.importBundle(data)
    refresh()
    alert(added.length ? `Added: ${added.map((s) => s.title).join(', ')}` : 'File read')
  } catch (e) { alert(e.message) }
}
function factory() {
  if (confirm('Your local drafts and progress will be cleared. Continue?')) { lib.resetLibrary(); refresh() }
}
</script>

<style scoped>
.screen { position: absolute; inset: 0; overflow: auto; padding-bottom: 60px; }
.sr { background: #8c5a2c; border-color: #a86c34; color: #fff2df; }
.bar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 20px clamp(16px, 4vw, 44px); position: sticky; top: 0; z-index: 2;
  background: linear-gradient(var(--ink) 70%, transparent);
}
.bar h2 { flex: 1; margin: 0; font-family: var(--font-display); font-size: 26px; }
.state { margin: 0 0 16px; font-size: 13px; color: var(--muted); }
.state.err { color: #e0736b; }

.grid {
  list-style: none; margin: 0; padding: 0 clamp(16px, 4vw, 44px);
  display: grid; gap: 20px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
}
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
.cover {
  aspect-ratio: 16 / 10; cursor: pointer; position: relative;
  display: flex; align-items: flex-end; padding: 12px;
}
.badge, .progress {
  font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em;
  background: rgba(11, 16, 20, 0.72); border-radius: 999px; padding: 4px 10px; color: var(--text);
}
.progress { margin-left: auto; color: var(--moss); }
.meta { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 12px; }
.meta h3 { margin: 0; font-size: 17px; }
.title-input {
  background: none; border: 1px solid transparent; color: var(--text);
  font: inherit; font-size: 17px; font-weight: 700; padding: 4px 6px; border-radius: 8px; width: 100%;
}
.title-input:hover, .title-input:focus { border-color: var(--line); outline: none; background: #101a20; }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
.foot { padding: 26px clamp(16px, 4vw, 44px); display: flex; gap: 14px; align-items: center; }
.note { color: var(--muted); font-size: 12px; }
</style>
