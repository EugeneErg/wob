<template>
  <div class="game">
    <p v-if="lost" class="stale-bar">
      The version this run was recorded on is unavailable — there is nothing to replay it against
    </p>

    <WorldCanvas
      v-if="!loading && !lost"
      ref="canvas"
      :level="playLevel"
      :paused="paused"
      :mode="mode"
      :record="record"
      :seed="seed"
      :speed="rate"
      :speedrun="speedrun"
      :ghost="ghost"
      @progress="onProgress"
      @missing="onMissing"
      @stats="onStats"
      @ended="onReplayEnd"
    />

    <div class="hud">
      <button class="btn ghost small" @click="leave">← Levels</button>

      <!-- The goal is met, but the player decides: until this is pressed you can
           carry on and send more balls than required. -->
      <button v-if="reached && !won && mode === 'play'" class="btn small primary end" @click="finishNow">
        Finish<i>{{ clock }}</i>
      </button>

      <div class="counter" :class="{ done: collected >= playLevel.goal }">
        <span class="num">{{ collected }}</span>
        <span class="of">/ {{ playLevel.goal }}</span>
        <span class="cap">in the pipe</span>
      </div>

      <!-- The attempt is timed in ticks rather than by a stopwatch: the same
           playthrough gives the same number at 30 frames and at 144. -->
      <div class="timer" :class="{ run: mode === 'replay' }">{{ clock }}</div>

      <!-- The gap to the ghost. Measured at shared marks (this many balls in
           the pipe) rather than by tick number: a tick on its own says nothing
           when the two players are in different parts of the level. -->
      <div v-if="gap !== null" class="gap" :class="{ ahead: gap < 0 }">
        {{ gap < 0 ? '−' : '+' }}{{ fmt(Math.abs(gap)) }}
        <i>{{ gap < 0 ? 'ahead' : 'behind' }}</i>
      </div>

      <!-- Pause on a phone: there is no Esc there, and a thumb has to reach it -->
      <button class="btn small icon" :aria-label="paused ? 'Resume' : 'Pause'" @click="togglePause">
        {{ paused ? '▶' : '❚❚' }}
      </button>
      <button v-if="mode === 'play'" class="btn small" @click="restart">Restart</button>
      <!-- Debugging: a screenshot and a state dump. They exist so a bug can be
           discussed in facts — what was on screen, at which tick, with which
           seed — rather than in retellings. -->
      <button class="btn small icon" title="Screenshot (F9)" @click="shot">◉</button>
      <button class="btn small icon" title="Dump state (F10)" @click="dump">⤓</button>
    </div>

    <!-- Playback controls. Seeking forward is free — it is just the run
         carrying on. Seeking back recomputes the world from the beginning, so
         the number of ticks to redo is shown: on a level with water that is a
         noticeable wait, and saying so beats freezing the screen. -->
    <div v-if="mode === 'replay' && !lost && !loading" class="deck">
      <div class="line">
        <button class="btn small icon" @click="togglePause">{{ paused ? '▶' : '❚❚' }}</button>
        <!-- The timeline: drags both ways, and the frame changes while you
             move. The lighter part is unrolled — jumping there is instant,
             beyond it there is a recompute to wait for. -->
        <Timeline
          class="tl-wide" :value="tick" :max="total || 1"
          :buffered="Math.round((unpacked ?? 1) * (total || 1))"
          @seek="onScrub"
        />
        <span class="pos">{{ clock }} / {{ fmt(total) }}</span>
      </div>

      <div class="line">
        <button class="btn small" @click="jump(-5)">◀◀ 5s</button>
        <button class="btn small" :disabled="!paused" @click="frameStep(-1)">◀ frame</button>
        <button class="btn small" :disabled="!paused" @click="frameStep(1)">frame ▶</button>
        <button class="btn small" @click="jump(5)">5s ▶▶</button>
        <span class="speeds">
          <button
            v-for="s in [0.25, 0.5, 1, 2, 4]" :key="s"
            class="sp" :class="{ on: rate === s }" @click="rate = s"
          >{{ s }}×</button>
        </span>
      </div>

      <p v-if="unpacked !== null && unpacked < 1" class="unpack">
        unrolling the recording: {{ Math.round(unpacked * 100) }}% — you can watch already,
        and seek within the part that is done
      </p>

      <div v-if="seeking" class="seek">
        <div class="fill" :style="{ width: Math.round(progress * 100) + '%' }" />
        <span>recomputing: {{ Math.round(progress * 100) }}%</span>
      </div>
    </div>

    <div class="fps" :class="{ low: fps > 0 && fps < 50 }">
      {{ fps }} FPS<span class="sub">· tick {{ tick }}</span>
    </div>

    <p v-if="outdated" class="stale-bar">{{ outdated }}</p>

    <p v-if="missing.length" class="warn">
      This level uses entities that are not in this build: {{ missing.join(', ') }}
    </p>

    <!-- Pause. In a speedrun it stops the clock too: time is counted in ticks
         and a paused game produces none, so standing and thinking is free —
         the recording simply does not grow and resumes from the same place. -->
    <transition name="pop">
      <div v-if="paused" class="panel">
        <p class="eyebrow">Paused</p>
        <h2>{{ level.name }}</h2>
        <!-- Rewinding exists only in ordinary play. A speedrun has none:
             rolling back and replaying a bad stretch is not the same contest as
             going through in one attempt, and one table cannot measure both. -->
        <div v-if="canRewind" class="rewind">
          <button class="btn small" @click="rewind(1)">◀ 1s</button>
          <button class="btn small" @click="rewind(5)">◀ 5s</button>
          <span class="hint-rw">replay from here</span>
        </div>

        <!-- The same while paused in game: you can wind back and look at what
             happened. Looking is not yet a rewind — the attempt stands still.
             The rewind happens only if you resume from the place being shown,
             and the screen says so. In a speedrun the bar only shows: there are
             no rewinds there, and studying the past after the fact would
             advantage whoever is playing straight through. -->
        <div v-if="mode === 'play'" class="rew">
          <Timeline
            :value="previewTick ?? tick" :max="maxTick || 1"
            :buffered="previewTick === null ? -1 : Math.round((unpacked ?? 1) * (maxTick || 1))"
            :disabled="speedrun"
            @seek="onPreview" @commit="onPreviewEnd"
          />
          <p v-if="speedrun" class="rew-note">
            No rewinding in a speedrun — the attempt runs straight through.
          </p>
          <p v-else-if="previewTick !== null" class="rew-note">
            Looking at {{ fmt(previewTick) }} of {{ clock }}.
            <button class="link" @click="resumeHere">Resume from here</button>
            <button class="link" @click="backToNow">Go back</button>
          </p>
          <p v-else class="rew-note">Drag the bar to look at what happened</p>
        </div>

        <div class="row">
          <button class="btn primary" @click="togglePause">Resume</button>
          <button v-if="mode === 'play'" class="btn" @click="restart">Restart</button>
          <button class="btn" @click="leave">Leave</button>
        </div>
        <!-- Frame rate: speedrunners usually want to set it explicitly rather
             than leave it to the browser. It does not affect the result — the
             tick is always the same — but it does affect smoothness. -->
        <label class="fps-pick">
          <span>Frames per second</span>
          <select :value="fpsCap" @change="setFps(+$event.target.value)">
            <option v-for="f in FPS_OPTIONS" :key="f" :value="f">{{ fpsLabel(f) }}</option>
          </select>
        </label>

        <p class="note">Esc pauses and resumes · the simulation is always 60 ticks per second</p>
      </div>
    </transition>

    <transition name="pop">
      <div v-if="won && !paused" class="panel">
        <p class="eyebrow">{{ mode === 'replay' ? 'Replay finished' : 'Level complete' }}</p>
        <h2>{{ playLevel.name }}</h2>
        <p v-if="outdated" class="stale">{{ outdated }}</p>
        <p class="result">{{ clock }}<span v-if="best" class="best">best: {{ best }}</span></p>
        <div class="row">
          <button class="btn primary" @click="leave">To the map</button>
          <button class="btn" @click="restart">Again</button>
        </div>

        <!--
          Asked here and nowhere else. This is the one moment the player has
          just experienced the level and has an opinion worth having; a rating
          prompt anywhere else is asking someone to remember how they felt.
        -->
        <RateLevel v-if="mode !== 'replay'" :release-id="releaseId" :level-id="playLevel.id" />
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, shallowRef, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import RateLevel from '../components/RateLevel.vue'
import { CATEGORY, SCOPE, submitRun } from '../core/records.js'
import { session } from '../core/session.js'
import { RULES_VERSION } from '../core/releases.js'
import WorldCanvas from '../components/WorldCanvas.vue'
import Timeline from '../components/Timeline.vue'
import { markDone } from '../core/library.js'
import { saveRun, bestRun, formatTime, KIND } from '../core/replays.js'
import { seedFor, checkRecord } from '../core/releases.js'
import { contentFor } from '../core/content.js'
import { saveScreenshot, saveState } from '../core/debug.js'
import { settings, setSetting, FPS_OPTIONS, fpsLabel } from '../core/settings.js'

const props = defineProps({
  level: { type: Object, required: true },
  // 'play' is a live attempt, 'replay' is watching a recording
  mode: { type: String, default: 'play' },
  record: { type: Object, default: null },
  speedrun: { type: Boolean, default: false },
  speed: { type: Number, default: 1 },
  // which release is being played; null means the author's draft
  releaseId: { type: String, default: null },
  // The level is played on its own or as a link in a chapter playthrough.
  // Within a chain it neither saves its own attempt nor marks overall progress
  // — whoever is running the chain does that when the visit ends.
  chained: { type: Boolean, default: false },
  // where the speedrun began — ends up in the debug dump
  srScope: { type: String, default: null },
})
const emit = defineEmits(['back', 'result', 'ended'])

const canvas = ref(null)
const collected = ref(0)
const missing = ref([])
const paused = ref(false)
const fps = ref(0)
const tick = ref(0)
const time = ref(0)
const won = ref(false)
const reached = ref(false)   // the goal is met, but the player has not finished yet
const total = ref(0)
const seeking = ref(false)
const progress = ref(1)
const unpacked = ref(null)
// Where the scrubber sits while the player studies the past. null means they are not.
const previewTick = ref(null)
// How far it is possible to seek in a live game: as far as the attempt has got.
// While the past is being examined, tick shows the preview, so the limit is
// remembered separately — otherwise the bar would collapse after the scrubber.
const maxTick = ref(0)
// Playback speed. The initial value comes from outside and the viewer takes it
// from there: picking apart someone's run is easier slowly, rewatching is
// easier fast.
const rate = ref(props.speed)

const fpsCap = ref(settings().fpsCap)
const setFps = (v) => { fpsCap.value = v; setSetting('fpsCap', v) }

// The ghost: the best attempt on this level, running alongside. Only fetched
// for a live game — in a replay there is nobody to race.
const ghost = shallowRef(null)
const gap = ref(null)

watch(() => props.level?.id, async (id) => {
  ghost.value = null
  gap.value = null
  if (!id || props.mode !== 'play') return
  const b = await bestRun(id, { kind: KIND.LEVEL })
  // Racing a recording from another version is meaningless: the level or the
  // physics was different, so there is nothing to compare the time against.
  if (b && checkRecord(b).ok) ghost.value = b
}, { immediate: true })
const best = ref(null)
const saved = ref(false)

// A replay runs on the version it was recorded against, not the current one.
// The level is not stored in the recording — there is a reference to the
// version, and the content store resolves it (local for now, the server
// later).
const resolved = shallowRef(null)
const playLevel = computed(() => resolved.value || props.level)
// until the version arrives there is nothing to play: we would be showing a
// different level
const loading = ref(props.mode === 'replay')
const lost = ref(false)

watch(() => props.record, async (rec) => {
  if (props.mode !== 'replay') return
  loading.value = true; lost.value = false; resolved.value = null
  const c = await contentFor(rec)
  if (!c) { lost.value = true; loading.value = false; return }
  resolved.value = c
  loading.value = false
}, { immediate: true })

// The seed is derived from the level itself rather than from the attempt: the
// same level must give the same random stream whether it is played first or
// fourth, alone or inside a chapter. Randomness here belongs to the level, not
// to the session.
const seed = computed(() => seedFor(playLevel.value))
const record = computed(() => props.record)

// Whether the version is current. This neither hides the recording nor stops it
// playing — it just says plainly that it was taken on something else.
const outdated = computed(() => {
  if (props.mode !== 'replay' || !props.record) return null
  const v = checkRecord(props.record)
  return v.ok ? null : v.text
})

const clock = computed(() => formatTime(tick.value))

const onProgress = (n) => (collected.value += n)
const onMissing = (types) => (missing.value = types)
function onStats(s) {
  fps.value = s.fps; tick.value = s.tick; time.value = s.time
  if (s.total) total.value = s.total
  seeking.value = !!s.seeking
  progress.value = s.progress ?? 1
  unpacked.value = s.unpacked ?? null
  if (s.previewing) previewTick.value = s.tick
  else maxTick.value = s.tick
  gap.value = s.ghostGap ?? null
}

const fmt = (t) => formatTime(t || 0)

// Seeking with the bar. Paused stays paused: the viewer drags the slider to
// examine a moment, not to set the game running again.
function onScrub(t) { canvas.value?.seek(t) }

// Dragging the bar while paused in game: show a past frame, leave the attempt
// alone.
function onPreview(t) {
  if (props.speedrun || props.mode !== 'play') return
  previewTick.value = t
  canvas.value?.previewAt(t)
}
const onPreviewEnd = (t) => onPreview(t)

// Resuming from the place being shown — now that is a rewind, and it is marked
// in the attempt. Everything after it the player plays again.
function resumeHere() {
  canvas.value?.endPreview(previewTick.value)
  previewTick.value = null
  collected.value = 0
  reached.value = false
  paused.value = false
}
// Back to where we were: looking around leaves no trace
function backToNow() {
  canvas.value?.endPreview(null)
  previewTick.value = null
}
function jump(seconds) {
  const t = Math.max(0, tick.value + Math.round(seconds * 60))
  canvas.value?.seek(t)
}
// Stepping by frames only while paused: frame-by-frame study is the main
// reason seeking exists at all.
function frameStep(n) {
  if (!paused.value) return
  canvas.value?.stepFrames(n)
}

// The goal is met — but the level does not end by itself.
//
// It used to finish at that instant, which took the decision away from the
// player: they may well want to send more balls into the pipe than required.
// Now a Finish button appears, and until it is pressed the game carries on as
// if nothing had happened — the clock runs, the balls move. Pressing it is what
// ends the attempt.
watch(collected, (n) => {
  if (n >= playLevel.value.goal) reached.value = true
})

async function finishNow() {
  if (won.value || props.mode !== 'play') return
  won.value = true
  canvas.value?.finish()
  // Only ordinary play writes overall progress. In a speedrun past
  // achievements do not count: what is open is exactly what this attempt has
  // opened, or a chapter could be started from the middle on an old save.
  if (!props.speedrun) markDone(props.level.id)
  await store()
}

// Every attempt is saved in full, successful or abandoned: watching how it
// fell apart is often more useful than watching one that worked.
async function store() {
  if (saved.value) return
  const snap = canvas.value?.snapshot()
  if (!snap) return
  saved.value = true
  // A link in a chain hands its visit upwards and stops there: the segment goes
  // into the chapter attempt and no separate level recording is made — one
  // playthrough would otherwise produce two recordings of the same thing.
  if (props.chained) { emit('result', snap); return }
  await saveRun(snap, {
    kind: KIND.LEVEL, targetId: props.level.id, speedrun: props.speedrun,
    releaseId: props.releaseId || null,   // a reference to the version, not a snapshot of it
  })
  const b = await bestRun(props.level.id, { kind: KIND.LEVEL })
  best.value = b ? formatTime(b.ticks, b.rate) : null

  await publishRun(snap)
}

/**
 * Offer the run to the leaderboard.
 *
 * Only finished runs of a published version, and only from someone signed in —
 * an abandoned attempt is worth keeping locally to study, but it is not a time,
 * and a draft has no frozen version for a time to mean anything against.
 *
 * The input log goes with it rather than just the number of ticks. That is what
 * makes the time checkable: the same input through the same physics gives the
 * same outcome, so the server can recompute the result instead of believing it.
 *
 * Never blocks and never complains. The level is beaten and the panel is up;
 * a leaderboard that could not be reached is not the player's problem to solve
 * in that moment.
 */
async function publishRun(snap) {
  if (!snap.finished || !props.releaseId || session.status !== 'signed-in') return

  try {
    await submitRun(props.releaseId, {
      scope: SCOPE.LEVEL,
      target: props.level.id,
      category: CATEGORY.ANY,
      ticks: snap.ticks,
      seed: snap.seed,
      rulesVersion: RULES_VERSION,
      input: snap.input || [],
    })
  } catch {
    // Nothing useful to say here — the run is safe locally either way.
  }
}

// The replay finished. In a chapter attempt the next segment follows this one,
// so the end has to be reported upwards rather than just shown on a card.
function onReplayEnd() {
  if (props.chained) { emit('ended'); return }
  won.value = true
}

function togglePause() {
  // Unpausing without deciding anything about what was shown returns to the
  // attempt. Quietly carrying on from the past moment is not allowed: that
  // would be a rewind the player never asked for.
  if (paused.value && previewTick.value !== null) backToNow()
  paused.value = !paused.value
}

// A picture of exactly what is on screen, camera and all. It pauses first, or
// the shot lands a frame later than the thing the person meant to capture.
function shot() {
  paused.value = true
  saveScreenshot(canvas.value?.svgEl(), `${playLevel.value.id}-t${tick.value}`)
}

// The dump: the content (library, progress, recordings) plus the attempt
// itself — the seed and the input, from which the moment can be reproduced
// exactly. No physics in it: that is recomputed, not stored.
function dump() {
  saveState({
    ...(canvas.value?.debugInfo() || {}),
    speedrun: props.speedrun,
    srScope: props.srScope,
    collected: collected.value,
    goal: playLevel.value.goal,
    fps: fps.value,
  }, `${playLevel.value.id}-t${tick.value}`)
}

const canRewind = computed(() => props.mode === 'play' && !props.speedrun)

// Rewinding a few seconds. The world is not wound back — it is recomputed from
// the trimmed recording, so on a heavy level this is not instant.
function rewind(seconds) {
  if (!canRewind.value) return
  canvas.value?.rollback(Math.max(0, tick.value - Math.round(seconds * 60)))
  collected.value = 0   // the world counts the goal again from scratch
}

function restart() {
  collected.value = 0
  won.value = false
  reached.value = false
  saved.value = false
  paused.value = false
  canvas.value.restart()
}

// Leaving in the middle of a level is an attempt too. Record it before going.
async function leave() {
  // The goal is met and the player leaves without pressing Finish — the level
  // still counts. That button is about whether to keep playing, not about
  // whether it counts: the condition is already satisfied, and losing progress
  // over it would be both annoying and baffling. Without this the attempt left
  // unfinished, the next level did not unlock and the path to it was not
  // drawn.
  if (props.mode === 'play' && reached.value && !won.value) { await finishNow(); emit('back'); return }
  if (props.mode === 'play' && !saved.value && tick.value > 0) await store()
  emit('back')
}

function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); togglePause(); return }
  if (e.key === 'F9') { e.preventDefault(); shot(); return }
  if (e.key === 'F10') { e.preventDefault(); dump(); return }
  if (props.mode !== 'replay') return
  // The layout of a video review tool: space pauses, arrows move through time,
  // comma and full stop step a frame.
  if (e.key === ' ') { e.preventDefault(); togglePause() }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); jump(-5) }
  else if (e.key === 'ArrowRight') { e.preventDefault(); jump(5) }
  else if (e.key === ',') { e.preventDefault(); frameStep(-1) }
  else if (e.key === '.') { e.preventDefault(); frameStep(1) }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// The tab was hidden, so pause it ourselves: otherwise the player comes back to
// a world that stood still without them and cannot tell why everything has
// collapsed.
function onHidden() { if (document.hidden) paused.value = true }
onMounted(() => document.addEventListener('visibilitychange', onHidden))
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onHidden))
</script>

<style scoped>
.game { position: absolute; inset: 0; background: var(--ink); }
.hud {
  position: absolute; top: 0; left: 0; right: 0;
  display: flex; align-items: center; gap: 12px; padding: 14px 18px;
  pointer-events: none;
}
.hud > * { pointer-events: auto; }
.counter {
  margin-left: auto;
  display: flex; align-items: baseline; gap: 8px;
  background: rgba(11, 16, 20, 0.72); border: 1px solid var(--line);
  border-radius: 999px; padding: 8px 20px; backdrop-filter: blur(6px);
}
.counter .num { font-family: var(--font-display); font-size: 30px; line-height: 1; color: var(--goo); }
.counter .of { font-family: var(--font-mono); color: var(--muted); font-size: 14px; }
.counter .cap { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); }
.counter.done .num { color: var(--moss); }
.end { display: flex; flex-direction: column; align-items: center; line-height: 1.15; }
.end i { font-style: normal; font-family: var(--font-mono); font-size: 10px; opacity: 0.8; }

.timer {
  margin-right: auto;
  font-family: var(--font-mono); font-size: 18px; color: var(--text);
  background: rgba(11, 16, 20, 0.72); border: 1px solid var(--line);
  border-radius: 999px; padding: 8px 16px; min-width: 92px; text-align: center;
}
.timer.run { color: #ffd9a0; }
.gap {
  font-family: var(--font-mono); font-size: 15px; color: #ffb9a4;
  background: rgba(11, 16, 20, 0.72); border: 1px solid #8c3b2c;
  border-radius: 999px; padding: 5px 14px; text-align: center;
}
.gap.ahead { color: var(--moss); border-color: var(--moss); }
.gap i { display: block; font-style: normal; font-size: 9px; letter-spacing: 0.14em;
  text-transform: uppercase; opacity: 0.75; }
.icon { font-size: 13px; min-width: 44px; }

.fps {
  position: absolute; right: 14px; bottom: 12px;
  font-family: var(--font-mono); font-size: 11px; color: var(--muted);
  background: rgba(11, 16, 20, 0.6); border-radius: 6px; padding: 4px 8px;
}
.fps.low { color: #ffb9a4; }
.fps .sub { margin-left: 8px; opacity: 0.7; }

.warn {
  position: absolute; left: 50%; transform: translateX(-50%); top: 62px; margin: 0;
  background: rgba(11, 16, 20, 0.9); border: 1px solid #8c5a2c; color: #ffd9a0;
  border-radius: 10px; padding: 8px 14px; font-size: 13px;
}
.panel {
  position: absolute; inset: auto 0 0 0; margin: auto; bottom: 12%;
  width: max-content; text-align: center;
  background: rgba(11, 16, 20, 0.9); border: 1px solid var(--line);
  border-radius: 16px; padding: 26px 40px;
}
.panel h2 { font-family: var(--font-display); font-size: 40px; margin: 6px 0 12px; }
.panel .row { display: flex; gap: 10px; justify-content: center; }
.result { font-family: var(--font-mono); font-size: 22px; margin: 0 0 16px; color: #ffd9a0; }
.result .best { display: block; font-size: 12px; color: var(--muted); margin-top: 6px; }
.stale-bar {
  position: absolute; left: 50%; transform: translateX(-50%); top: 62px; margin: 0;
  background: rgba(11, 16, 20, 0.9); border: 1px solid var(--line); color: var(--muted);
  border-radius: 10px; padding: 6px 14px; font-family: var(--font-mono); font-size: 11px;
}
.stale { font-family: var(--font-mono); font-size: 11px; color: var(--muted); margin: 0 0 10px; }
.deck {
  position: absolute; left: 50%; transform: translateX(-50%); bottom: 16px;
  width: min(720px, calc(100% - 32px));
  background: rgba(11, 16, 20, 0.88); border: 1px solid var(--line);
  border-radius: 14px; padding: 10px 14px; backdrop-filter: blur(6px);
}
.deck .line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.deck .line + .line { margin-top: 8px; }
.pos { font-family: var(--font-mono); font-size: 12px; color: var(--muted); white-space: nowrap; }
.speeds { display: flex; gap: 4px; margin-left: auto; }
.sp {
  font: inherit; font-family: var(--font-mono); font-size: 11px; padding: 3px 8px;
  border: 1px solid var(--line); border-radius: 999px; background: #101a20;
  color: var(--muted); cursor: pointer;
}
.sp.on { color: #ffd9a0; border-color: #8c5a2c; }
.tl-wide { flex: 1; min-width: 120px; }
.rew { margin: 0 0 14px; }
.rew-note { margin: 4px 0 0; font-family: var(--font-mono); font-size: 10.5px; color: var(--muted); }
.link {
  font: inherit; font-family: var(--font-mono); font-size: 10.5px;
  background: none; border: none; color: #ffd9a0; cursor: pointer;
  padding: 0 0 0 10px; text-decoration: underline;
}
.track { position: relative; flex: 1; min-width: 120px; display: flex; align-items: center; }
.buffered {
  position: absolute; left: 0; top: 50%; height: 4px; margin-top: -2px;
  background: rgba(226, 112, 74, 0.35); border-radius: 2px; pointer-events: none;
}
.scrub { position: relative; width: 100%; accent-color: var(--goo); background: transparent; }
.unpack {
  margin: 8px 0 0; font-family: var(--font-mono); font-size: 10.5px; color: var(--muted);
}
.fps-pick { display: block; margin: 14px 0 0; font-size: 12px; color: var(--muted); }
.fps-pick span { display: block; margin-bottom: 5px; }
.fps-pick select {
  font: inherit; font-size: 12px; padding: 5px 9px; min-width: 150px;
  background: #101a20; color: var(--text); border: 1px solid var(--line); border-radius: 7px;
}
.seek {
  position: relative; margin-top: 8px; height: 16px; border-radius: 999px;
  background: #101a20; overflow: hidden;
}
.seek .fill { position: absolute; inset: 0 auto 0 0; background: rgba(226, 112, 74, 0.5); }
.seek span {
  position: relative; display: block; text-align: center;
  font-family: var(--font-mono); font-size: 10px; line-height: 16px; color: var(--text);
}
.rewind { display: flex; align-items: center; gap: 8px; justify-content: center; margin-bottom: 14px; }
.hint-rw { font-family: var(--font-mono); font-size: 10.5px; color: var(--muted); }
.note { font-family: var(--font-mono); font-size: 11px; color: var(--muted); margin: 14px 0 0; }
.pop-enter-active { transition: all 0.35s cubic-bezier(0.2, 1.3, 0.4, 1); }
.pop-enter-from { opacity: 0; transform: translateY(20px) scale(0.96); }
</style>
