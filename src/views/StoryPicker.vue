<template>
  <div class="screen">
    <header class="bar">
      <button class="btn ghost small" @click="$emit('back')">← Меню</button>
      <h2>{{ mode === 'play' ? 'Истории' : 'Редактор историй' }}</h2>
      <template v-if="mode === 'edit'">
        <button class="btn small" @click="doImport">Загрузить из файла</button>
        <button class="btn small" @click="dump">Выгрузить всё</button>
        <button class="btn small primary" @click="add">Новая история</button>
      </template>
    </header>

    <ul class="grid">
      <li v-for="s in list" :key="s.id" class="card">
        <div class="cover" :style="coverStyle(s.cover)" @click="$emit('open', s.id)">
          <span class="badge">{{ chapters(s.id).length }} глав · {{ levelCount(s.id) }} уровней</span>
          <span v-if="mode === 'play'" class="progress">{{ done(s.id) }} / {{ levelCount(s.id) }}</span>
        </div>
        <div class="meta">
          <input v-if="mode === 'edit'" v-model="s.title" class="title-input" @change="persist" />
          <h3 v-else>{{ s.title }}</h3>
          <div class="row">
            <button class="btn small primary" @click="$emit('open', s.id)">{{ mode === 'play' ? 'Играть' : 'Открыть' }}</button>
            <template v-if="mode === 'edit'">
              <button class="btn small" @click="cover(s)">Обложка</button>
              <button class="btn small" @click="save(s)">В файл</button>
              <button class="btn small danger" @click="drop(s)">Удалить</button>
            </template>
          </div>
        </div>
      </li>
    </ul>

    <footer v-if="mode === 'edit'" class="foot">
      <button class="btn ghost small" @click="factory">Вернуть встроенное содержимое</button>
      <span class="note">Импорт всегда добавляет, ничего не затирая.</span>
    </footer>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import * as lib from '../core/library.js'
import { downloadJSON, pickJSON, pickImage, fileName, coverStyle } from '../core/fileio.js'

defineProps({ mode: { type: String, default: 'play' } })
const emit = defineEmits(['back', 'open'])

const list = ref(lib.stories())
const refresh = () => (list.value = lib.stories())
const persist = () => lib.save()

const chapters = (id) => lib.chaptersOf(id)
const levelCount = (id) => chapters(id).reduce((n, c) => n + c.nodes.length, 0)
const done = (id) => chapters(id).reduce((n, c) => n + c.nodes.filter((x) => lib.isDone(x.levelId)).length, 0)

function add() {
  const { story } = lib.createStory()
  refresh()
  emit('open', story.id)
}
function drop(s) {
  if (confirm(`Удалить историю «${s.title}» со всеми главами и уровнями?`)) { lib.removeStory(s.id); refresh() }
}
async function cover(s) {
  const url = await pickImage().catch(() => null)
  if (url) { s.cover = url; persist(); refresh() }
}
const save = (s) => downloadJSON(lib.exportStory(s.id), fileName('story', s.title))
const dump = () => downloadJSON(lib.exportAll(), 'goo-library')
async function doImport() {
  try {
    const added = lib.importBundle(await pickJSON())
    refresh()
    alert(added.length ? `Загружено: ${added.map((s) => s.title).join(', ')}` : 'Файл прочитан')
  } catch (e) { alert(e.message) }
}
function factory() {
  if (confirm('Вся библиотека и прогресс будут заменены встроенными. Продолжить?')) { lib.resetLibrary(); refresh() }
}
</script>

<style scoped>
.screen { position: absolute; inset: 0; overflow: auto; padding-bottom: 60px; }
.bar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 20px clamp(16px, 4vw, 44px); position: sticky; top: 0; z-index: 2;
  background: linear-gradient(var(--ink) 70%, transparent);
}
.bar h2 { flex: 1; margin: 0; font-family: var(--font-display); font-size: 26px; }
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
