<template>
  <div class="screen">
    <header class="bar">
      <button class="btn ghost small" @click="$emit('back')">← Menu</button>
      <h2>{{ mode === 'play' ? (intent === 'speedrun' ? 'Speedrun' : 'Stories') : 'Story editor' }}</h2>
      <template v-if="mode === 'edit'">
        <button class="btn small primary" @click="opening = true">New story</button>
      </template>
    </header>

    <!--
      В игровом режиме список разделён, потому что это разные вещи, а не разные
      строки одного списка. Канон — то, что игра предлагает как своё; чужое
      опубликованное — то, что сделали другие; черновики — то, что автор ещё не
      выпускал, и играть их можно только ему.

      Раньше всё лежало одной кучей: собственный черновик стоял рядом с каноном
      и выглядел его частью.
    -->
    <template v-for="group in groups" :key="group.key">
      <h3 v-if="mode === 'play' && group.items.length" class="group">
        {{ group.title }}
        <span class="group-note">{{ group.note }}</span>
      </h3>

      <ul v-if="group.items.length" class="grid">
        <li v-for="s in group.items" :key="s.id" class="card">
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
              <button class="btn small danger" @click="drop(s)">Delete</button>
            </template>
          </div>
        </div>
        </li>
      </ul>
    </template>

    <footer v-if="mode === 'edit'" class="foot">
      <button class="btn ghost small" @click="factory">Restore the built-in content</button>
      <span class="note">Opening a file always adds — nothing is ever overwritten.</span>
    </footer>
  </div>

  <CreateSheet
    v-if="opening"
    heading="New story"
    placeholder="What is it called"
    :slots="storySlots"
    @close="opening = false"
    @create="add"
  />
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import * as lib from '../core/library.js'
import { loadCatalog, loadStory } from '../core/catalog.js'
import { downloadLibrary } from '../core/cloud.js'
import { deleteStory } from '../core/authoring.js'
import { makeStory } from '../core/making.js'
import { session } from '../core/session.js'
import CreateSheet from '../components/CreateSheet.vue'
import { loadState } from '../core/debug.js'
import { pickJSON, coverStyle } from '../core/fileio.js'
import { pickMedia } from '../core/media.js'

const props = defineProps({
  mode: { type: String, default: 'play' },
  // What brought the player here: 'play', 'speedrun' or 'create'. It only
  // decides which option is put forward, never what is possible.
  intent: { type: String, default: 'play' },
})
const emit = defineEmits(['back', 'open'])

const list = ref(lib.stories())
const shelf = ref(null)
const refresh = () => (list.value = lib.stories())

// Разделение опирается на каталог: сервер и так отдаёт канон и опубликованное
// по отдельности, а всё, чего в нём нет, — черновики этого автора.
const groups = computed(() => {
  if (props.mode === 'edit') return [{ key: 'all', title: '', note: '', items: list.value }]

  const canon = new Set((shelf.value?.canon || []).map((x) => x.id))
  const published = new Set((shelf.value?.published || []).map((x) => x.id))

  return [
    {
      key: 'canon',
      title: 'Canon',
      note: 'the way the story goes',
      items: list.value.filter((s) => canon.has(s.id)),
    },
    {
      key: 'published',
      title: 'Published',
      note: 'made by other people',
      items: list.value.filter((s) => !canon.has(s.id) && published.has(s.id)),
    },
    {
      key: 'drafts',
      title: 'Your drafts',
      note: 'not published — only you can play these',
      items: list.value.filter((s) => !canon.has(s.id) && !published.has(s.id)),
    },
  ]
})

// Содержимое приходит с сервера, и до ответа показывать нечего.
const loading = ref(false)
const failed = ref(null)

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

onMounted(async () => {
  if (props.mode === 'edit') {
    // Черновики автора лежат в аккаунте, а не в браузере. Комментарий здесь
    // раньше утверждал обратное — «свои черновики, которые живут здесь», — и
    // из-за этого редактор ничего не запрашивал: после очистки кук человек
    // входил заново и не находил ничего из сделанного, хотя всё лежало на
    // сервере.
    if (session.status !== 'signed-in') return

    loading.value = true
    failed.value = null

    try {
      await downloadLibrary()
      refresh()
    } catch (e) {
      failed.value = e.message
    } finally {
      loading.value = false
    }

    return
  }

  loading.value = true
  failed.value = null

  try {
    const fresh = await loadCatalog({ force: true })
    shelf.value = fresh

    // Каждую историю подтягиваем целиком: без глав и уровней карточка знает
    // только заголовок, а список показывает, сколько внутри.
    for (const story of [...fresh.canon, ...fresh.published]) {
      await loadStory(story.id)
    }

    preview.value = fresh.preview
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

// The story's film is the only one that plays before anything is touched, so it
// is asked for here rather than found in a settings screen later.
const opening = ref(false)
const storySlots = [
  { key: 'cover', label: 'Cover', cta: 'Choose a picture', kind: 'image' },
  { key: 'intro', label: 'Opening film', cta: 'Choose a video', kind: 'video' },
]

async function add({ title, ...extra }) {
  opening.value = false
  failed.value = null

  let story
  try {
    // Сначала сервер: имя выдаёт он, и до ответа класть к себе нечего.
    ;({ story } = await makeStory(title, extra))
  } catch (e) {
    failed.value = e.message

    return
  }

  refresh()

  emit('open', story.id)
}
function drop(s) {
  if (!confirm(`Delete "${s.title}" with all its chapters and levels?`)) return

  lib.removeStory(s.id)

  if (session.status === 'signed-in') deleteStory(s.id)

  refresh()
}
async function cover(s) {
  const url = await pickMedia().catch((e) => { alert(e.message); return null })
  if (url) { s.cover = url; persist(); refresh() }
}
// Loading a debug dump. Deliberately not a button.
//
// Story files no longer come in from disk at all — stories are made in the
// editor and live in the account — so the only thing left worth reading off a
// disk is a dump, and that is a maintenance tool, not a feature. It answers to
// F10 on the library screen, mirroring the F10 that writes a dump in game: a
// key that nobody presses by accident and no menu advertises.
//
// It replaces everything rather than adding, which is the whole point — the
// reported state has to be reproduced exactly — and that is also why it stays
// out of reach of anyone who has not been told about it.
async function loadDump() {
  try {
    const data = await pickJSON()

    // The storage field is what makes a dump a dump. Anything else — including
    // an old exported story file — is refused rather than guessed at.
    if (!data?.storage) {
      alert('That is not a debug dump. Stories are created in the editor, not opened from a file.')
      return
    }

    const where = data.now?.levelId ? ` (level ${data.now.levelId}, tick ${data.now.tick ?? '?'})` : ''
    if (!confirm(`This is a debug dump from ${new Date(data.at).toLocaleString()}${where}.\n\n`
      + 'Your entire library, progress and recordings will be replaced. Continue?')) return

    loadState(data)
    refresh()
    alert('State loaded. Find the run in the recordings list and watch it back.')
  } catch (e) { alert(e.message) }
}

function onKey(e) {
  if (e.key !== 'F10') return
  e.preventDefault()
  loadDump()
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

.group {
  margin: 20px clamp(16px, 4vw, 44px) 0; display: flex; align-items: baseline; gap: 10px;
  font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted);
}
.group-note { font-size: 11px; letter-spacing: 0; text-transform: none; }

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
