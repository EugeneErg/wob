<template>
  <MainMenu v-if="at === 'menu'" @go="go" />

  <StoryPicker
    v-else-if="at === 'stories'"
    :mode="mode" @back="at = 'menu'" @open="openStory"
  />
  <ChapterList
    v-else-if="at === 'chapters'"
    :mode="mode" :story-id="storyId"
    :run="chain?.kind === 'story' ? chain : null" :speedrun="speedrun" :sr-scope="srScope"
    :release-id="releaseId" :release="rel"
    @back="leaveStory" @open="openChapter" @start="startStory" @runs="openRuns"
    @version="pickVersion"
  />
  <ChapterMap
    v-else-if="at === 'map'"
    :mode="mode" :chapter-id="chapterId"
    :run="chain" :speedrun="speedrun" :sr-scope="srScope" :in-story="chain?.kind === 'story'"
    :release="rel"
    @back="leaveChapter" @play="play" @edit="editLevel" @start="startChapter"
    @runs="openRuns"
  />
  <!-- Выбор режима для отдельного уровня. Спрашиваем, только если спидран
       не унаследован сверху: внутри спидрана главы или истории уровень уже
       спидранится, а внутри обычного прохождения его можно взяться спидранить
       отдельно — это самостоятельное состязание. -->
  <div v-else-if="at === 'pick-level'" class="screen">
    <header class="bar">
      <button class="btn ghost small" @click="at = 'map'">← Карта</button>
      <h2>{{ current?.name }}</h2>
    </header>
    <ModePick
      title="Как проходим уровень?"
      sr-note="на время, без откатов"
      plain-note="спокойно, с перемоткой на паузе"
      @pick="startLevel"
    />
  </div>

  <GameView
    v-else-if="at === 'game'"
    :key="levelId + ':' + attempt" :level="current"
    :speedrun="speedrun" :sr-scope="srScope" :chained="!!chain" :release-id="releaseId"
    @back="at = 'map'" @result="onSegment"
  />

  <RunsView
    v-else-if="at === 'runs'"
    :kind="runsKind" :target-id="runsTarget"
    @back="at = runsFrom" @watch="watchRun"
  />

  <!-- Просмотр записи. Попытка главы состоит из нескольких заходов, поэтому
       здесь она проигрывается сегмент за сегментом: каждый — отдельный мир. -->
  <GameView
    v-else-if="at === 'watch'"
    :key="'w' + watching.id + ':' + segIndex"
    :level="watchLevel" :record="watchRecord" mode="replay"
    :chained="watching.kind !== 'level'"
    @back="stopWatching" @ended="nextSegment"
  />
  <EditorView
    v-else-if="at === 'level'"
    :key="levelId" :level-id="levelId" :chapter-id="chapterId" :story-id="storyId"
    @back="at = 'map'"
  />

  <!-- Итог попытки главы. Показывается поверх карты, когда цепочка закончена. -->
  <div v-if="finished" class="verdict">
    <p class="eyebrow">{{ finished.kind === 'story' ? 'История пройдена' : 'Глава пройдена' }}</p>
    <h2>{{ finished.category === '100' ? '100%' : 'any%' }}</h2>
    <p class="time">{{ finished.time }}</p>
    <p class="sub">заходов на уровни: {{ finished.segments }}</p>
    <button class="btn primary" @click="finished = null">Хорошо</button>
  </div>
</template>

<script setup>
import { ref, shallowRef, computed } from 'vue'
import MainMenu from './views/MainMenu.vue'
import StoryPicker from './views/StoryPicker.vue'
import ChapterList from './views/ChapterList.vue'
import ChapterMap from './views/ChapterMap.vue'
import GameView from './views/GameView.vue'
import EditorView from './views/EditorView.vue'
import RunsView from './views/RunsView.vue'
import ModePick from './components/ModePick.vue'
import { shouldAsk } from './core/modes.js'
import {
  level as getLevel, chapter as getChapter,
  story as getStory, chaptersOf,
} from './core/library.js'
import {
  ChainRun, categoryOf, segmentRecord,
  doneByChapter, storyCategoryOf,
} from './core/chain.js'
import { levelHash, release, levelFrom, chapterFrom, latestRelease } from './core/releases.js'
import { saveRun, formatTime, KIND } from './core/replays.js'

const at = ref('menu')
const mode = ref('play')
const storyId = ref(null)
const chapterId = ref(null)
const levelId = ref(null)
const current = shallowRef(null)

// Идущая попытка. Заводится только для спидрана: спидран — состязание, его
// меряют одной непрерывной попыткой. Обычное прохождение цепочки не образует
// вовсе — там можно выйти, вернуться через неделю и продолжить, так что
// «время попытки» для него не имеет смысла.
//
// Обычный ref, а не shallowRef: цепочка растёт по ходу игры, и экраны обязаны
// это видеть — они рисуют прогресс именно этой попытки, а не общий.
const chain = ref(null)

// На каком уровне вложенности начат спидран: null, 'level', 'chapter', 'story'.
// Спидран наследуется вниз, обычное прохождение — нет. Поэтому вопрос о режиме
// задаётся ровно там, где спидран ещё не начат.
const srScope = ref(null)
// Выбрали ли спидран ещё в главном меню
const entrySpeedrun = ref(false)
const speedrun = computed(() => srScope.value !== null)
// Счётчик заходов: пересоздаёт GameView при повторном входе на тот же уровень,
// иначе Vue переиспользовал бы компонент и мир остался бы от прошлого захода.
const attempt = ref(0)
// Какой выпуск играем. Выпуск — замороженный снимок истории: его уровни
// больше не изменятся, поэтому записи по нему сравнимы между собой. Если
// выпусков нет, играется черновик автора, и об этом честно сказано на экране.
const releaseId = ref(null)
const rel = computed(() => (releaseId.value ? release(releaseId.value) : null))

// Уровень и глава берутся из выпуска, а не из живой библиотеки: играя выпуск,
// игрок играет именно то, что было выпущено, даже если автор уже правит
// следующую версию.
const lvlOf = (id) => (rel.value ? levelFrom(rel.value, id) : getLevel(id))
const chapOf = (id) => (rel.value ? chapterFrom(rel.value, id) : getChapter(id))

function pickVersion(id) {
  releaseId.value = id || null
  chain.value = null      // смена версии обрывает попытку: играли бы уже другое
  srScope.value = null
}

const finished = ref(null)

// --- просмотр записей --------------------------------------------------------
const runsKind = ref('level')
const runsTarget = ref(null)
// Откуда пришли на экран попыток: попытки истории открывают из списка глав,
// попытки главы и уровня — с карты. Возвращать надо туда же, откуда позвали.
const runsFrom = ref('map')
const watching = shallowRef(null)   // запись, которую смотрим
const segIndex = ref(0)             // какой заход показываем, если это глава
const watchLevel = shallowRef(null)
const watchRecord = shallowRef(null)

function openRuns({ kind, targetId }) {
  runsKind.value = kind
  runsTarget.value = targetId
  runsFrom.value = at.value
  at.value = 'runs'
}

function watchRun(rec) {
  watching.value = rec
  segIndex.value = 0
  if (rec.kind === 'level') {
    watchLevel.value = getLevel(rec.targetId)
    watchRecord.value = rec
  } else {
    watchLevel.value = getLevel(rec.segments[0].levelId)
    watchRecord.value = segmentRecord(rec, 0)
  }
  at.value = 'watch'
}

function nextSegment() {
  const rec = watching.value
  const i = segIndex.value + 1
  if (!rec?.segments || i >= rec.segments.length) { stopWatching(); return }
  segIndex.value = i
  watchLevel.value = getLevel(rec.segments[i].levelId)
  watchRecord.value = segmentRecord(rec, i)
}

function stopWatching() {
  watching.value = null
  watchRecord.value = null
  at.value = 'runs'
}

function go(where) {
  mode.value = where === 'editor' ? 'edit' : 'play'
  // Спидран, выбранный на входе, начинается на самом верху: открытая дальше
  // история станет попыткой целиком, и переспрашивать её незачем.
  entrySpeedrun.value = where === 'speedrun'
  srScope.value = null
  chain.value = null
  at.value = 'stories'
}
function openStory(id) {
  storyId.value = id
  chain.value = null      // при входе в историю режим спрашиваем заново
  srScope.value = null
  // По умолчанию предлагаем последний выпуск: играть свежее выпущенное —
  // разумное умолчание, а черновик автора можно выбрать явно.
  releaseId.value = mode.value === 'play' ? (latestRelease(id)?.id || null) : null
  // Режим выбран на входе — история сразу становится попыткой.
  if (entrySpeedrun.value) startStory(true)
  at.value = 'chapters'
}

// Игрок выбрал проходить историю целиком. Дальше это одна попытка: время
// общее, главы внутри режим уже не спрашивают — он выбран здесь.
function startStory(sr) {
  if (!sr) { srScope.value = null; chain.value = null; return }   // просто играем
  srScope.value = 'story'
  chain.value = new ChainRun({ kind: KIND.STORY, targetId: storyId.value })
}

async function leaveStory() {
  await abandon()
  srScope.value = null
  at.value = 'stories'
}
function openChapter(id) {
  chapterId.value = id
  // Внутри попытки истории цепочка продолжается — она общая на всю историю.
  // Если попытки нет, глава спросит режим сама и заведёт свою.
  if (chain.value?.kind !== KIND.STORY) {
    chain.value = null
    if (srScope.value !== 'story') srScope.value = null
  }
  at.value = 'map'
}

// Игрок выбрал, как проходить главу. С этого мгновения идёт попытка: её время
// складывается из времени уровней, а карта показывает прогресс этой попытки.
function startChapter(sr) {
  if (!sr) { srScope.value = null; chain.value = null; return }
  srScope.value = 'chapter'
  chain.value = new ChainRun({ kind: KIND.CHAPTER, targetId: chapterId.value })
}

async function leaveChapter() {
  // Возврат к списку глав. Попытку истории он не обрывает: игрок просто вышел
  // из главы, чтобы выбрать следующую, — это часть прохождения истории.
  // А попытку одной главы обрывает: она вся была про эту главу.
  if (chain.value?.kind !== KIND.STORY) {
    await abandon()
    if (srScope.value !== 'story') srScope.value = null
  }
  at.value = 'chapters'
}

// Брошенная попытка тоже записывается.
//
// Раньше она просто исчезала, и это было неверно: неудачный прогон — самое
// интересное для разбора. Спидранер хочет посмотреть, где именно развалилась
// попытка, а не только те, что дошли до конца.
//
// В зачёт она при этом не идёт: finished остаётся ложным, потому что категории
// нет, а отбор лучших смотрит именно на него. В списке попыток такие помечены
// как непройденные и стоят после пройденных.
async function abandon() {
  const run = chain.value
  chain.value = null
  if (!run?.segments.length) return
  await saveRun(run.snapshot(), {
    kind: run.kind,
    targetId: run.targetId,
    releaseId: releaseId.value,
    speedrun: speedrun.value,
    category: null,       // до конца не дошли — зачёта нет
  })
}

function play(id) {
  levelId.value = id
  current.value = lvlOf(id)
  attempt.value++
  // Спрашивать ли — решает общее правило: спидран сверху наследуется,
  // обычное прохождение нет.
  at.value = shouldAsk('level', srScope.value) ? 'pick-level' : 'game'
}

// Игрок выбрал режим для отдельного уровня. Спидран уровня — тоже попытка,
// но короткая: цепочки ей не нужно, запись уровня и есть вся попытка.
function startLevel(sr) {
  srScope.value = sr ? 'level' : null
  attempt.value++
  at.value = 'game'
}
function editLevel(id) { levelId.value = id; at.value = 'level' }

// Заход на уровень закончился — кладём сегмент в цепочку и возвращаемся
// на карту. Неудачный заход тоже сегмент: время он занял.
async function onSegment(snapshot) {
  const run = chain.value
  at.value = 'map'
  // Спидран отдельного уровня цепочки не образует: запись уровня и есть вся
  // попытка, её сохранил сам GameView. Возвращать область в null здесь же,
  // иначе следующий уровень унаследовал бы чужой выбор.
  if (srScope.value === 'level') srScope.value = null
  if (!run) return
  // Сегмент помнит и уровень, и главу: без главы попытку истории не разложить
  // по главам, а без этого не посчитать ни доступность, ни проценты.
  run.push(snapshot, {
    levelId: levelId.value,
    chapterId: chapterId.value,
    hash: levelHash(current.value),
  })

  const done = run.kind === KIND.STORY ? await checkStory(run) : await checkChapter(run)
  if (done) { chain.value = null; srScope.value = null }
}

// Глава дошла до конца — записываем попытку главы.
async function checkChapter(run) {
  const ch = chapOf(chapterId.value)
  const cat = ch ? categoryOf(ch, run.done) : null
  if (!cat) return false
  await finish(run, { kind: KIND.CHAPTER, targetId: chapterId.value, category: cat }, cat)
  return true
}

// История дошла до конца. Считается по главам: пройдена финальная глава —
// any%, пройдены все главы целиком — 100%.
async function checkStory(run) {
  const st = rel.value ? rel.value.story : getStory(storyId.value)
  if (!st) return false
  const chs = rel.value ? rel.value.chapters : chaptersOf(st.id)
  const cat = storyCategoryOf(st, chs, doneByChapter(run))
  if (!cat) return false
  await finish(run, { kind: KIND.STORY, targetId: st.id, category: cat }, cat)
  return true
}

async function finish(run, scope, cat) {
  const snap = run.snapshot()
  await saveRun(snap, { ...scope, releaseId: releaseId.value, speedrun: speedrun.value })
  finished.value = {
    kind: scope.kind,
    category: cat,
    time: formatTime(snap.ticks),
    segments: snap.segments.length,
  }
  at.value = scope.kind === KIND.STORY ? 'chapters' : 'map'
}
</script>

<style scoped>
.verdict {
  position: fixed; inset: auto 0 0 0; margin: auto; bottom: 14%;
  width: max-content; text-align: center; z-index: 10;
  background: rgba(11, 16, 20, 0.94); border: 1px solid var(--line);
  border-radius: 16px; padding: 24px 40px;
}
.verdict h2 { font-family: var(--font-display); font-size: 44px; margin: 6px 0 10px; }
.verdict .time { font-family: var(--font-mono); font-size: 22px; color: #ffd9a0; margin: 0 0 6px; }
.verdict .sub { font-family: var(--font-mono); font-size: 11px; color: var(--muted); margin: 0 0 18px; }
</style>
