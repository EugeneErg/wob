<template>
  <p v-if="loadingStory" class="loading">Loading…</p>

  <div v-else-if="storyError" class="loading">
    <p>Could not load that story: {{ storyError }}</p>
    <button class="btn" @click="storyError = null">Back</button>
  </div>

  <MainMenu v-else-if="at === 'menu'" @go="go" @resume="resume" />

  <SettingsView v-else-if="at === 'settings'" @back="at = 'menu'" />

  <AwardsView v-else-if="at === 'awards'" @back="at = 'menu'" />

  <SlotPicker
    v-else-if="at === 'slots'"
    :story-id="storyId" @back="at = 'stories'" @play="pickSlot"
  />

  <StoryPicker
    v-else-if="at === 'stories'"
    :mode="mode" :intent="intent" @back="at = 'menu'" @open="openStory"
  />
  <!--
    Автор расставляет историю на доске, игрок листает список. Это не два вида
    одного экрана: игроку нечего двигать, а автору нечего проходить, и общий
    компонент пришлось бы половину времени держать выключенным.
  -->
  <StoryCanvas
    v-else-if="at === 'chapters' && mode === 'edit'"
    :story-id="storyId"
    @back="leaveStory" @open="openChapter" @edit="editLevel"
  />
  <ChapterMap
    v-else-if="at === 'map'"
    :mode="mode" :chapter-id="chapterId"
    :run="chain" :speedrun="speedrun" :sr-scope="srScope" :in-story="chain?.kind === 'story'"
    :release="rel"
    :release-id="releaseId" :releases="storyReleases" :story-id="storyId"
    @back="leaveChapter" @play="play" @edit="editLevel"
    @runs="openRuns" @chapter="openChapter" @version="pickVersion"
    @start="startChapterHere"
  />
  <GameView
    v-else-if="at === 'game'"
    :key="levelId + ':' + attempt" :level="current"
    :speedrun="speedrun" :sr-scope="srScope" :chained="!!chain" :release-id="releaseId"
    @back="at = 'map'" @result="onSegment"
  />

  <RunsView
    v-else-if="at === 'runs'"
    :kind="runsKind" :target-id="runsTarget" :release-id="releaseId"
    @back="at = runsFrom" @watch="watchRun"
  />

  <!-- Watching a recording. A chapter attempt is several visits to levels, so
       it is replayed segment by segment: each one is its own world. -->
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
    @back="at = cameFrom"
  />

  <!-- The result of an attempt, shown over the map once the chain is done. -->
  <div v-if="finished" class="verdict">
    <p class="eyebrow">{{ finished.kind === 'story' ? 'Story complete' : 'Chapter complete' }}</p>
    <h2>{{ finished.category === '100' ? '100%' : 'any%' }}</h2>
    <p class="time">{{ finished.time }}</p>
    <p class="sub">{{ finished.segments }} level {{ finished.segments === 1 ? 'attempt' : 'attempts' }}</p>
    <button class="btn primary" @click="finished = null">Nice</button>
  </div>
</template>

<script setup>
import { ref, shallowRef, computed } from 'vue'
import MainMenu from './views/MainMenu.vue'
import SettingsView from './views/SettingsView.vue'
import AwardsView from './views/AwardsView.vue'
import SlotPicker from './views/SlotPicker.vue'
import StoryPicker from './views/StoryPicker.vue'
import StoryCanvas from './views/StoryCanvas.vue'
import ChapterMap from './views/ChapterMap.vue'
import GameView from './views/GameView.vue'
import EditorView from './views/EditorView.vue'
import RunsView from './views/RunsView.vue'
import {
  level as getLevel, chapter as getChapter,
  story as getStory, chaptersOf, isDone,
} from './core/library.js'
import {
  ChainRun, categoryOf, segmentRecord,
  activeChapter, doneByChapter, storyCategoryOf,
} from './core/chain.js'
import { levelHash, release, levelFrom, chapterFrom, latestRelease, releases } from './core/releases.js'
import { saveRun, formatTime, KIND } from './core/replays.js'
import { remember } from './core/recent.js'
import { setProgress } from './core/library.js'
import { loadStory } from './core/catalog.js'
import { session } from './core/session.js'
import { reportProgress } from './core/sync.js'
import { CATEGORY, SCOPE, submitRun } from './core/records.js'
import { RULES_VERSION } from './core/releases.js'

const at = ref('menu')
const mode = ref('play')
// What the player came for: 'play', 'speedrun' or 'create'. Distinct from mode,
// which only says whether we are editing — the story list uses this to decide
// which option to put forward.
const intent = ref('play')

// Fetching a story's content. Shown rather than swallowed: a blank screen while
// the network is slow reads as a broken game.
const loadingStory = ref(false)
const storyError = ref(null)

// Which run is being played. Null for a signed-out visitor, who has no shelf of
// saves to pick from — and, with one level on offer, nothing to keep on it.
const slot = ref(null)

// Whether the player pressed Speedrun on the story card. Held while the save
// menu is in the way, so the choice they made survives the detour.
const speedrunPending = ref(false)
const storyId = ref(null)
const chapterId = ref(null)
const levelId = ref(null)
const current = shallowRef(null)

// The attempt in progress. Only speedruns start one: a speedrun is a contest,
// and a contest is measured as one unbroken attempt. Ordinary play forms no
// chain at all — you can leave, come back a week later and carry on, so "the
// time of the attempt" would mean nothing.
//
// A plain ref rather than shallowRef: the chain grows as you play and the
// screens have to see it, since they draw the progress of THIS attempt rather
// than the overall one.
const chain = ref(null)

// At which depth the speedrun began: null, 'level', 'chapter', 'story'.
// A speedrun is inherited downwards, ordinary play is not — which is why the
// mode is asked about exactly where no speedrun is running yet.
const srScope = ref(null)
const speedrun = computed(() => srScope.value !== null)
// Attempt counter: forces a fresh GameView when re-entering the same level.
// Without it Vue would reuse the component and the world would still be the
// one from the previous try.
const attempt = ref(0)
// Which release is being played. A release is a frozen snapshot of a story:
// its levels will not change again, so runs against it are comparable. With no
// releases the author's draft is played, and the screen says so plainly.
const releaseId = ref(null)
const rel = computed(() => (releaseId.value ? release(releaseId.value) : null))

// Level and chapter come from the release rather than the live library: while
// playing a release you play exactly what was released, even if the author is
// already editing the next version.
const lvlOf = (id) => (rel.value ? levelFrom(rel.value, id) : getLevel(id))
const chapOf = (id) => (rel.value ? chapterFrom(rel.value, id) : getChapter(id))

function pickVersion(id) {
  releaseId.value = id || null
  chain.value = null      // switching version ends the attempt: it would be a different game
  srScope.value = null
}

const finished = ref(null)

// --- watching recordings --------------------------------------------------------
const runsKind = ref('level')
const runsTarget = ref(null)
// Where we came to the runs screen from: story runs are opened from the chapter
// list, chapter and level runs from the map. Back must lead where we came from.
const runsFrom = ref('map')
const watching = shallowRef(null)   // the recording being watched
const segIndex = ref(0)             // which visit is showing, when it is a chapter
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

// The menu asks for one of three things. 'speedrun' is not a separate screen
// but an intent carried into the story list, so that the timed option is the
// one offered first there instead of hiding behind a secondary button.
function go(where) {
  if (where === 'settings' || where === 'awards') {
    at.value = where

    return
  }

  mode.value = where === 'create' ? 'edit' : 'play'
  intent.value = where
  srScope.value = null
  chain.value = null
  at.value = 'stories'
}

// Continue. It lands on the chapter map when we know the chapter, and on the
// chapter list otherwise — never straight into a level, because dropping
// someone into a puzzle they last saw a week ago with no idea where they are
// is disorienting rather than convenient.
async function resume(spot) {
  mode.value = 'play'
  intent.value = 'play'
  srScope.value = null
  chain.value = null

  // Continue is the one entry that skips the story list entirely, so it is the
  // one most likely to arrive with nothing loaded.
  loadingStory.value = true

  try {
    await loadStory(spot.storyId)
  } catch (e) {
    loadingStory.value = false
    storyError.value = e.message

    return
  }

  loadingStory.value = false
  storyId.value = spot.storyId
  releaseId.value = latestRelease(spot.storyId)?.id || null

  if (spot.chapterId) {
    chapterId.value = spot.chapterId
    at.value = 'map'
  } else {
    showStory()
  }
}
// The mode arrives with the choice: the player pressed "Speedrun" on a story
// card, not "play and decide later". A story speedrun covers its chapters and
// levels, so they will not ask again.
async function openStory(id, speedrun = false) {
  // The content may not be here yet — resuming from a bookmark, or arriving at
  // a story the shelf listed but never fetched in full. Asking the catalogue
  // again is cheap (a release is frozen, so the answer cannot have changed) and
  // it is the difference between a chapter list and an empty screen.
  if (mode.value === 'play') {
    loadingStory.value = true

    try {
      await loadStory(id)
    } catch (e) {
      loadingStory.value = false
      storyError.value = e.message

      return
    }

    loadingStory.value = false
  }

  storyId.value = id

  // Закладка «продолжить» — про игру, а не про правку. Редактор, открывая
  // историю, помечал её как начатую, и в меню появлялось предложение
  // продолжить уровень, в который никто не играл.
  if (mode.value === 'play') remember({ storyId: id, chapterId: null })
  chain.value = null      // entering a story asks about the mode again
  srScope.value = null
  slot.value = null

  // Signed in, a story is entered through its save menu: which run is this?
  // Signed out there is nothing to choose between, so the question is not
  // asked.
  if (mode.value === 'play' && session.status === 'signed-in') {
    releaseId.value = latestRelease(id)?.id || null
    speedrunPending.value = speedrun
    at.value = 'slots'

    return
  }
  // Default to the latest release: playing the most recent published version is
  // the sensible default, and the author's draft can still be chosen explicitly.
  releaseId.value = mode.value === 'play' ? (latestRelease(id)?.id || null) : null
  if (speedrun) startStory(true)
  showStory()
}

// The player chose to take the story as a whole. From here it is one attempt:
// the time is shared, and chapters inside no longer ask about the mode — it was
// decided here.
// A run was chosen from the save menu. Its finished levels become the progress
// this session plays against — which is what makes a second run start empty
// while the first keeps its place.
function pickSlot(chosen) {
  slot.value = chosen
  adoptSlotProgress(chosen)

  if (speedrunPending.value) {
    speedrunPending.value = false
    startStory(true)
  }

  showStory()
}

/**
 * Make this run's progress the progress the screens read.
 *
 * The maps and the unlock rules all ask library.js what has been finished, and
 * that answer has to change when the run does — otherwise picking a fresh slot
 * would show a story already beaten. Replacing rather than merging is the
 * point: a second run is supposed to start empty.
 */
function adoptSlotProgress(chosen) {
  setProgress(chosen.completed || [])
}

function startStory(sr) {
  if (!sr) { srScope.value = null; chain.value = null; return }   // just playing
  srScope.value = 'story'
  chain.value = new ChainRun({ kind: KIND.STORY, targetId: storyId.value })
}

async function leaveStory() {
  await abandon()
  srScope.value = null
  at.value = 'stories'
}
/**
 * Куда попадает игрок, открыв историю.
 *
 * Списка глав больше нет: у редактора история лежит на доске, у игрока — сразу
 * карта той главы, где он остановился. Промежуточный экран не решал ни одной
 * задачи, кроме выбора главы, а выбор теперь делается дверями на самой карте,
 * где рядом видно, куда именно дверь ведёт.
 */
/**
 * Показать историю.
 *
 * Редактору — доска, игроку — карта главы, где он остановился. Одно место
 * принятия этого решения: раньше в четырёх местах стояло at = 'chapters', и
 * добавить пятое, забыв про режим, было бы вопросом времени.
 */
// Опубликованные версии текущей истории. Жил в списке глав; список ушёл, а
// выбор версии остался нужен — он переехал в шапку карты.
const storyReleases = computed(() => (storyId.value ? releases(storyId.value) : []))

function showStory() {
  if (mode.value === 'edit') { at.value = 'chapters'; return }
  if (!enterActiveChapter()) at.value = 'stories'
}

function enterActiveChapter() {
  const story = getStory(storyId.value)
  const chapters = chaptersOf(storyId.value)
  if (!story || !chapters.length) return false

  // Внутри попытки считается её собственный прогресс, вне — общий из сохранения.
  const done = chain.value
    ? doneByChapter(chain.value)
    : new Map(chapters.map((c) => [c.id, new Set(c.nodes.filter((n) => isDone(n.levelId)).map((n) => n.id))]))
  const id = activeChapter(story, chapters, done)
  if (!id) return false

  openChapter(id)

  return true
}

// Начать попытку прохождения этой главы. Раньше выбор делался на карточке в
// списке до входа; теперь игрок уже стоит на карте, поэтому вход и выбор
// разошлись — и это к лучшему: карту можно посмотреть, ничего не начиная.
// Игрок уже стоит на карте, поэтому переходить некуда — начинается попытка.
//
// Раньше выбор режима шёл через openChapter(id, speedrun), а тот свой второй
// аргумент не использовал вовсе: startChapter() был написан ровно для этого и
// не вызывался ниоткуда. То есть спидран главы не запускался и из прежнего
// списка глав — кнопка была, а попытки не возникало.
function startChapterHere(speedrun) {
  startChapter(speedrun)
}

function openChapter(id) {
  chapterId.value = id
  if (mode.value === 'play') remember({ storyId: storyId.value, chapterId: id })
  // Inside a story attempt the chain carries on — it belongs to the whole
  // story. With no attempt running, the chapter asks about the mode itself and
  // starts one of its own.
  if (chain.value?.kind !== KIND.STORY) {
    chain.value = null
    if (srScope.value !== 'story') srScope.value = null
  }
  at.value = 'map'
}

// The player chose how to take the chapter. From this moment an attempt is
// running: its time is the sum of the levels, and the map shows the progress of
// that attempt.
function startChapter(sr) {
  if (!sr) { srScope.value = null; chain.value = null; return }
  srScope.value = 'chapter'
  chain.value = new ChainRun({ kind: KIND.CHAPTER, targetId: chapterId.value })
}

async function leaveChapter() {
  // Back to the chapter list. This does not end a story attempt: the player
  // simply stepped out of a chapter to pick the next one, which is part of
  // playing the story. It does end a chapter attempt, which was all about that
  // one chapter.
  if (chain.value?.kind !== KIND.STORY) {
    await abandon()
    if (srScope.value !== 'story') srScope.value = null
  }

  // У игрока за главой стоит не список, а сама история: он вышел из неё целиком.
  if (mode.value === 'edit') at.value = 'chapters'
  else at.value = 'stories'
}

// An abandoned attempt is recorded too.
//
// It used to simply vanish, which was wrong: a failed run is the interesting
// one to study. A speedrunner wants to see exactly where the attempt fell
// apart, not only the ones that made it to the end.
//
// It does not count, though: finished stays false because there is no category,
// and picking the best looks at exactly that. In the runs list these are marked
// unfinished and sorted after the finished ones.
async function abandon() {
  const run = chain.value
  chain.value = null
  if (!run?.segments.length) return
  await saveRun(run.snapshot(), {
    kind: run.kind,
    targetId: run.targetId,
    releaseId: releaseId.value,
    speedrun: speedrun.value,
    category: null,       // never reached the end, so nothing to score
  })
}

// A level's mode arrives with the choice too, from the menu on its map node.
// There is no separate screen asking any more: deciding and entering became one
// action.
function play(id, speedrun = false) {
  levelId.value = id
  current.value = lvlOf(id)
  attempt.value++
  // Inside a running speedrun the level is part of it and starts no scope of
  // its own.
  if (!srScope.value) srScope.value = speedrun ? 'level' : null
  at.value = 'game'
}
// Откуда пришли в редактор наполнения. Из карты главы — туда и вернёмся; с
// доски истории — на доску. Возврат «всегда на карту» уводил бы автора, который
// нажал плюс в панели, на экран, где он не был.
const cameFrom = ref('map')

function editLevel(id) {
  cameFrom.value = at.value === 'chapters' ? 'chapters' : 'map'
  levelId.value = id
  at.value = 'level'
}

// A visit to a level ended: push the segment into the chain and go back to the
// map. A failed visit is a segment too — it took time.
async function onSegment(snapshot) {
  const run = chain.value
  at.value = 'map'
  reportProgress(storyId.value, levelId.value, slot.value?.id)
  // A single-level speedrun forms no chain: the level's recording IS the whole
  // attempt, and GameView saved it. The scope is cleared right here, or the
  // next level would inherit a choice that was not made for it.
  if (srScope.value === 'level') srScope.value = null
  if (!run) return
  // A segment remembers both the level and the chapter: without the chapter a
  // story attempt cannot be broken down by chapter, and without that there is
  // no working out what is unlocked or what the percentage is.
  run.push(snapshot, {
    levelId: levelId.value,
    chapterId: chapterId.value,
    hash: levelHash(current.value),
  })

  const done = run.kind === KIND.STORY ? await checkStory(run) : await checkChapter(run)
  if (done) { chain.value = null; srScope.value = null }
}

// The chapter reached its end, so the chapter attempt is recorded.
async function checkChapter(run) {
  const ch = chapOf(chapterId.value)
  const cat = ch ? categoryOf(ch, run.done) : null
  if (!cat) return false
  await finish(run, { kind: KIND.CHAPTER, targetId: chapterId.value, category: cat }, cat)
  return true
}

/**
 * Offer a finished chapter or story run to its leaderboard.
 *
 * Levels were being submitted and these were not, so the chapter and story
 * boards existed with nothing able to fill them.
 *
 * Only speedruns go up. An ordinary playthrough can be left and resumed a week
 * later, so its elapsed time measures nothing anyone would want to compare —
 * which is exactly the distinction the mode already draws everywhere else.
 */
async function publishChainRun(snap, scope, cat) {
  if (!speedrun.value || !releaseId.value || session.status !== 'signed-in') return

  try {
    await submitRun(releaseId.value, {
      scope: scope.kind === KIND.STORY ? SCOPE.STORY : SCOPE.CHAPTER,
      target: scope.kind === KIND.STORY ? null : scope.targetId,
      category: cat === '100' ? CATEGORY.HUNDRED : CATEGORY.ANY,
      ticks: snap.ticks,
      seed: snap.segments?.[0]?.seed ?? 0,
      rulesVersion: RULES_VERSION,
      // A chain run is several visits to levels, so its input is the segments
      // rather than one flat log. The verifier replays them in order.
      input: [],
      segments: snap.segments,
    })
  } catch {
    // The run is safe locally either way, and the player has a result panel in
    // front of them — a leaderboard that could not be reached is not their
    // problem to solve at that moment.
  }
}

// The story reached its end. Judged by chapters: the final chapter finished is
// any%, every chapter finished in full is 100%.
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
  await publishChainRun(snap, scope, cat)
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
.loading {
  position: absolute; inset: 0; display: flex;
  flex-direction: column; align-items: center; justify-content: center; gap: 14px;
  color: var(--muted); font-size: 14px; background: var(--ink);
}

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
