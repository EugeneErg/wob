<template>
  <div class="screen">
    <header class="bar">
      <button class="btn ghost small" @click="$emit('back')">← Истории</button>
      <h2>{{ story?.title }}</h2>
      <template v-if="mode === 'edit'">
        <button class="btn small" @click="hotOpen = !hotOpen">Горячие ассеты</button>
        <button class="btn small" @click="relOpen = !relOpen">
          Выпуски<i v-if="unreleased" class="dot" />
        </button>
        <button class="btn small primary" @click="add">Новая глава</button>
      </template>
      <template v-else>
        <span v-if="run" class="igt" :class="{ sr: speedrun }">
          {{ igt }}<i>{{ speedrun ? 'спидран истории' : 'прохождение' }}</i>
        </span>
        <!-- Какую версию играем. Выпуск заморожен: его уровни больше не
             изменятся, поэтому и рекорды по нему сравнимы. Черновик автора
             меняется в любой момент — играть его можно, но соревноваться
             в нём не с чем, и это сказано прямо. -->
        <label v-if="rels.length" class="ver">
          <select :value="releaseId || ''" @change="$emit('version', $event.target.value || null)">
            <option v-for="r in rels" :key="r.id" :value="r.id">Версия {{ r.version }}</option>
            <option value="">Черновик автора</option>
          </select>
        </label>
        <button class="btn small" @click="$emit('runs', { kind: 'story', targetId: storyId })">
          Попытки истории
        </button>
      </template>
    </header>

    <!-- Спрашиваем один раз при входе в историю. Спидран отсюда накроет всё,
         что внутри: главы и уровни в нём режим уже не спрашивают. Обычное
         прохождение вниз не наследуется — внутри него можно взяться
         спидранить отдельную главу или уровень. -->
    <ModePick
      v-if="mode === 'play' && ask"
      title="Пройти историю целиком?"
      sr-note="все главы подряд, время общее"
      plain-note="сохраняется, главы по одной"
      note="Можно и просто открыть главу — тогда она пройдётся отдельно, со своим временем."
      @pick="choose"
    />

    <!-- Выпуски. Черновик правится сколько угодно и рекордов не имеет: пока
         автор двигает камни, соревноваться не в чем. Выпуск — замороженный
         снимок всей истории вместе с главами и уровнями; он больше не
         меняется никогда, и правка после него создаёт следующий, а не
         переписывает прошлый. Рекорды и записи привязаны к выпуску, поэтому
         сырое в бой не попадает. -->
    <section v-if="mode === 'edit' && relOpen" class="rel">
      <div class="rel-head">
        <h3>Выпуски истории</h3>
        <button class="btn small primary" :disabled="!unreleased" @click="doPublish">
          {{ unreleased ? 'Выпустить версию ' + (rels.length + 1) : 'Нечего выпускать' }}
        </button>
      </div>
      <p v-if="unreleased" class="rel-note">
        Черновик отличается от последнего выпуска — игроки его пока не видят.
      </p>
      <p v-else-if="rels.length" class="rel-note">
        Черновик совпадает с версией {{ rels[0].version }}.
      </p>
      <p v-else class="rel-note">
        Выпусков ещё нет. Пока история не выпущена, играется черновик, и рекорды
        по ней сравнивать не с чем: уровни могут измениться в любой момент.
      </p>

      <ul v-if="rels.length" class="rel-list">
        <li v-for="r in rels" :key="r.id">
          <b>Версия {{ r.version }}</b>
          <span class="when">{{ when(r.at) }}</span>
          <span class="what">{{ r.chapters.length }} глав, {{ r.levels.length }} уровней</span>
          <span class="hash">{{ r.hash }}</span>
        </li>
      </ul>
    </section>

    <p v-if="mode === 'play' && !releaseId && rels.length" class="draft-warn">
      Играется черновик автора: он может измениться в любой день, и записи по
      нему устареют. Для рекордов выберите выпущенную версию.
    </p>

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
import ModePick from '../components/ModePick.vue'
import { shouldAsk } from '../core/modes.js'
import { doneByChapter, openChapters } from '../core/chain.js'
import { formatTime } from '../core/replays.js'
import { publish, releases, drifted } from '../core/releases.js'
import { downloadJSON, pickImage, fileName, coverStyle } from '../core/fileio.js'

const props = defineProps({
  mode: { type: String, default: 'play' },
  storyId: String,
  // Идущая попытка истории (ChainRun), если она есть
  run: { type: Object, default: null },
  speedrun: { type: Boolean, default: false },
  // где начат спидран: null | 'story' | 'chapter' | 'level'
  srScope: { type: String, default: null },
  // какой выпуск играем; null — черновик автора
  releaseId: { type: String, default: null },
  // Замороженный снимок выпуска. Когда он есть, главы и уровни берутся из
  // него: играя выпуск, игрок обязан видеть то, что было выпущено, а не то,
  // что автор правит прямо сейчас.
  release: { type: Object, default: null },
})
const emit = defineEmits(['back', 'open', 'start', 'runs', 'version'])

const story = computed(() => props.release?.story || lib.story(props.storyId))
const chaptersNow = () => props.release?.chapters || lib.chaptersOf(props.storyId)
const list = ref(chaptersNow())
const refresh = () => (list.value = chaptersNow())
const persist = () => lib.save()

const allAssets = computed(() => lib.assets())
const hotOpen = ref(false)
const isHot = (id) => lib.isHot('story', props.storyId, id)
const toggle = (id) => { lib.toggleHot('story', props.storyId, id); refresh() }

// Что открыто. В попытке истории — только то, куда ведёт пройденный выход
// внутри этой же попытки: прошлые заслуги главу не открывают, иначе историю
// можно было бы начать с середины.
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

// Сколько уровней главы пройдено: в попытке — её собственный счёт, иначе общий
const passed = (c) => {
  const d = doneMap.value?.get(c.id)
  return d ? c.nodes.filter((n) => d.has(n.levelId)).length
    : c.nodes.filter((n) => lib.isDone(n.levelId)).length
}

const igt = computed(() => (props.run ? formatTime(props.run.ticks) : '0.000'))

// Спросили один раз — больше не пристаём: отказ от спидрана не должен
// возвращать тот же вопрос при каждом взгляде на экран. Само же правило,
// спрашивать ли вообще, живёт в modes.js и проверено тестом.
// Выпуски
const relOpen = ref(false)
// Выпуски перечитываются по счётчику: публикация меняет localStorage, а Vue
// об этом узнать не может — приходится дёргать счётчик руками.
const relTick = ref(0)
const rels = computed(() => (relTick.value, releases(props.storyId)))
const unreleased = computed(() => (relTick.value, props.storyId ? drifted(props.storyId) : false))
function doPublish() {
  const r = publish(props.storyId)
  relTick.value++
  if (r) relOpen.value = true
}
const when = (t) => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const asked = ref(false)
const ask = computed(() => !asked.value && shouldAsk('story', props.srScope))
const choose = (sr) => { asked.value = true; emit('start', sr) }

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
.ver select {
  font: inherit; font-size: 12px; padding: 5px 9px;
  background: #101a20; color: var(--text); border: 1px solid var(--line); border-radius: 7px;
}
.draft-warn {
  margin: 0 clamp(16px, 4vw, 44px) 14px; padding: 9px 13px;
  border: 1px solid #8c5a2c; background: rgba(140, 90, 44, 0.14); color: #ffd9a0;
  border-radius: 10px; font-size: 12.5px; line-height: 1.45;
}
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
