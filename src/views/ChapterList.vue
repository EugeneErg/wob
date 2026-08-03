<template>
  <div class="screen">
    <header class="bar">
      <button class="btn ghost small" @click="$emit('back')">← Истории</button>
      <h2>{{ story?.title }}</h2>
      <template v-if="mode === 'edit'">
        <button class="btn small" @click="hotOpen = !hotOpen">Горячие ассеты</button>
        <button class="btn small primary" @click="add">Новая глава</button>
      </template>
    </header>

    <section v-if="hotOpen && mode === 'edit'" class="hot">
      <p class="note">Отмеченные попадут в начало списка редактора во всех уровнях этой истории.</p>
      <button
        v-for="a in allAssets" :key="a.id"
        class="chip" :class="{ on: isHot(a.id) }"
        @click="toggle(a.id)"
      >{{ a.title }}</button>
    </section>

    <ul class="grid">
      <li v-for="(c, i) in list" :key="c.id" class="card" :class="{ locked: locked(c) }">
        <div class="cover" :style="coverStyle(c.image)" @click="open(c)">
          <span class="badge">Глава {{ i + 1 }} · {{ c.nodes.length }} уровней</span>
          <span v-if="locked(c)" class="lock">Закрыто</span>
          <span v-else-if="mode === 'play'" class="progress">{{ passed(c) }} / {{ c.nodes.length }}</span>
        </div>
        <div class="meta">
          <input v-if="mode === 'edit'" v-model="c.title" class="title-input" @change="persist" />
          <h3 v-else>{{ c.title }}</h3>
          <div class="row">
            <button class="btn small primary" :disabled="locked(c)" @click="open(c)">
              {{ mode === 'play' ? 'На карту' : 'Открыть' }}
            </button>
            <template v-if="mode === 'edit'">
              <button class="btn small" @click="pic(c)">Картинка</button>
              <button class="btn small" @click="save(c)">В файл</button>
              <button class="btn small danger" @click="drop(c)">Удалить</button>
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
import { downloadJSON, pickImage, fileName, coverStyle } from '../core/fileio.js'

const props = defineProps({ mode: { type: String, default: 'play' }, storyId: String })
const emit = defineEmits(['back', 'open'])

const story = computed(() => lib.story(props.storyId))
const list = ref(lib.chaptersOf(props.storyId))
const refresh = () => (list.value = lib.chaptersOf(props.storyId))
const persist = () => lib.save()

const allAssets = computed(() => lib.assets())
const hotOpen = ref(false)
const isHot = (id) => lib.isHot('story', props.storyId, id)
const toggle = (id) => { lib.toggleHot('story', props.storyId, id); refresh() }

const locked = (c) => props.mode === 'play' && !lib.chapterOpen(props.storyId, c.id)
const passed = (c) => c.nodes.filter((n) => lib.isDone(n.levelId)).length

function open(c) { if (!locked(c)) emit('open', c.id) }
function add() { const c = lib.createChapter(props.storyId); refresh(); emit('open', c.id) }
function drop(c) {
  if (confirm(`Удалить главу «${c.title}» вместе с её уровнями?`)) { lib.removeChapter(c.id); refresh() }
}
async function pic(c) {
  const url = await pickImage().catch(() => null)
  if (url) { c.image = url; persist(); refresh() }
}
const save = (c) => downloadJSON(lib.exportChapter(c.id), fileName('chapter', c.title))
</script>

<style scoped>
.screen { position: absolute; inset: 0; overflow: auto; padding-bottom: 60px; }
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
