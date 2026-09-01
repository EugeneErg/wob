<template>
  <svg
    ref="svg"
    class="stage"
    :viewBox="`${cam.x} ${cam.y} ${cam.w} ${cam.h}`"
    preserveAspectRatio="xMidYMid meet"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
    @pointerleave="onLeave"
  >
    <rect :x="0" :y="0" :width="w" :height="h" fill="url(#sky)" />
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#101c25" />
        <stop offset="0.55" stop-color="#16242b" />
        <stop offset="1" stop-color="#1d2a24" />
      </linearGradient>
    </defs>
    <!-- The ghost: somebody else's run, or your own earlier one, going along
         beside you. A separate world drawn over the current one, semi-transparent.
         It affects the game in no way at all — it is a second simulation that
         simply draws itself the same way. -->
    <g v-if="ghostShapes.length" class="ghost-run">
      <SvgScene :shapes="ghostShapes" />
    </g>

    <SvgScene :shapes="shapes" />

    <!-- The recorded cursor. In a replay there is nothing else to show the
         player's hand: the ball moves on its own, and without a marker there is
         no telling it is being dragged. -->
    <g v-if="ghost" class="ghost" :transform="`translate(${ghost.x} ${ghost.y})`">
      <circle r="13" />
      <circle r="4" class="core" />
    </g>
  </svg>
</template>

<script setup>
import { ref, shallowRef, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { EVENTS } from '../core/globals.js'
import { svgPoint } from '../core/svgPoint.js'
import { Run, replayOf, PLAY, REPLAY } from '../core/run.js'
import { Scrubber } from '../core/scrub.js'
import { gapAt } from '../core/splits.js'
import { settings } from '../core/settings.js'
import { DOWN, UP } from '../core/input.js'
import SvgScene from './SvgScene.js'

const props = defineProps({
  level: { type: Object, required: true },
  interactive: { type: Boolean, default: true },
  paused: { type: Boolean, default: false },
  // Mode: a live attempt, or watching a recording
  mode: { type: String, default: PLAY },
  // The recording to replay (snapshot() from Run)
  record: { type: Object, default: null },
  // The seed of a live attempt. Whoever starts the attempt sets it, which is
  // how it reaches the recording and how the replay follows the same random
  // stream.
  seed: { type: Number, default: 1 },
  // Replay speed: 1 is as it was played, 2 is twice as fast
  speed: { type: Number, default: 1 },
  // Speedrun: no rewinds. The flag travels into Run, where the ban lives.
  speedrun: { type: Boolean, default: false },
  // The recording running alongside as a ghost: usually the best attempt on
  // this level. Racing it is what a speedrun is really about — you see not the
  // final time but exactly where you are losing it.
  ghost: { type: Object, default: null },
})
const emit = defineEmits(['progress', 'missing', 'stats', 'ended'])

const svg = ref(null)
const shapes = shallowRef([])
// In a live game this is a Run; in a replay it is a Scrubber, which holds a Run
// inside itself and can stand on any tick. Everything else works through sim()
// — whichever run's world is on screen right now.
const run = shallowRef(null)
const scrub = shallowRef(null)
// The ghost run. It advances by the same ticks as the main one, so the gap is
// measured in ticks rather than in seconds off a clock.
// Previewing the past during a live game.
//
// While paused the bar can be dragged back to look at what happened. This is
// not yet a rewind: the player's world stands still and what is shown is a
// separate run assembled from the inputs already recorded. The rewind happens
// only if the player decides to carry on from there — and then it is their
// choice rather than a side effect of looking.
const preview = shallowRef(null)

const ghostRun = shallowRef(null)
const ghostShapes = shallowRef([])
const sim = () => (props.mode === REPLAY ? scrub.value?.run : run.value)
const ghost = shallowRef(null)
const w = computed(() => props.level.width || 1600)
const h = computed(() => props.level.height || 900)

// The camera. No zoom: a window of fixed size travels over the level.
//
// The camera belongs to the viewer rather than to the world: it is not in the
// recording and does not affect the simulation. Which is why your own replay
// can be watched from somewhere else entirely.
const cam = ref({ x: 0, y: 0, w: 1600, h: 900 })
const EDGE = 0.14
const SPEED = 900
let scroll = { x: 0, y: 0 }
let held = false

function setupCamera() {
  const cw = Math.min(props.level.camera?.w || 1600, w.value)
  const chh = Math.min(props.level.camera?.h || 900, h.value)
  cam.value = { x: (w.value - cw) / 2, y: (h.value - chh) / 2, w: cw, h: chh }
  clampCam()
}
function clampCam() {
  const c = cam.value
  c.x = w.value <= c.w ? (w.value - c.w) / 2 : Math.max(0, Math.min(w.value - c.w, c.x))
  c.y = h.value <= c.h ? (h.value - c.h) / 2 : Math.max(0, Math.min(h.value - c.h, c.y))
}
function edgePush(e) {
  if (!held || !svg.value) { scroll = { x: 0, y: 0 }; return }
  const r = svg.value.getBoundingClientRect()
  const fx = (e.clientX - r.left) / r.width
  const fy = (e.clientY - r.top) / r.height
  const ramp = (f) => (f < EDGE ? -(1 - f / EDGE) : f > 1 - EDGE ? (1 - (1 - f) / EDGE) : 0)
  scroll = { x: ramp(fx) * SPEED, y: ramp(fy) * SPEED }
}

let raf = 0
let last = 0
let off = null

// Frames per second is about the screen, not the simulation. They are counted
// separately from ticks and both numbers are shown: the gap between them is
// visible immediately when a device cannot keep up.
let frames = 0
let fpsAt = 0
const fps = ref(0)

function build() {
  off?.()
  ghost.value = null
  scrub.value = null
  run.value = null
  if (props.mode === REPLAY && props.record) {
    scrub.value = new Scrubber(props.level, props.record)
  } else {
    run.value = new Run(props.level, { mode: PLAY, seed: props.seed, speedrun: props.speedrun })
  }
  bindWorld()
  buildGhost()
  frames = 0; fpsAt = 0; fps.value = 0
}

// When the ghost and when the player got a ball to the goal. Comparing who is
// where has to happen at shared marks rather than by tick number: a gap in
// ticks means nothing on its own, since the two can be in different parts of
// the level. Whereas "third ball in the pipe: you at 4.2s, the ghost at 3.6s"
// is exactly what a speedrunner wants to know.
let ghostSplits = []
let mySplits = []
let offGhost = null

function buildGhost() {
  offGhost?.()
  ghostRun.value = null
  ghostShapes.value = []
  ghostSplits = []
  mySplits = []
  if (!props.ghost?.input?.length) return
  // The ghost plays on ITS OWN content: if the recording was taken on another
  // version of the level, racing it is not a fair race — but hiding it is not
  // the answer either. Let it run, with the version mismatch visible on
  // screen.
  ghostRun.value = replayOf(props.level, props.ghost)
  let n = 0
  offGhost = ghostRun.value.world.on(EVENTS.progress, (e) => {
    n += e?.delta ?? 1
    ghostSplits[n] = ghostRun.value.tick
  })
  ghostShapes.value = ghostRun.value.world.scene()
}

// Working out the gap lives in splits.js: inside a component it could not be
// covered by a test, and a mistake there would quietly show the player the
// wrong difference.

// Seeking backwards builds the world afresh, so the event subscription has to
// be moved with it — otherwise the goal counter would go on listening to a
// world that has been thrown away.
let boundWorld = null
function bindWorld() {
  const r = sim()
  if (!r || r.world === boundWorld) return
  off?.()
  boundWorld = r.world
  let mine = 0
  off = r.world.on(EVENTS.progress, (e) => {
    const d = e?.delta ?? 1
    mine += d
    mySplits[mine] = r.tick
    emit('progress', d)
  })
  if (r.world.missing.length) emit('missing', [...r.world.missing])
  shapes.value = r.world.scene()
}

function loop(t) {
  raf = requestAnimationFrame(loop)

  // The frame rate cap. A frame is simply skipped, which changes nothing about
  // the simulation: it runs on fixed ticks, and a skipped frame only means more
  // of them are worked through next time.
  const cap = settings().fpsCap
  if (cap) {
    const need = 1000 / cap - 0.5   // half a millisecond of slack, or every second frame is lost
    if (t - last < need) return
  }

  const elapsed = Math.min((t - last) / 1000 || 0, 0.25)
  last = t

  // the frame counter always runs, even while paused: it is about drawing
  frames++
  if (t - fpsAt >= 500) { fps.value = Math.round((frames * 1000) / (t - fpsAt)); frames = 0; fpsAt = t }

  // Examining the past while paused: show the preview rather than the live world.
  const pv = preview.value
  if (pv) {
    if (pv.busy) pv.pump()
    pv.unpack()
    shapes.value = pv.world.scene()
    emit('stats', {
      fps: fps.value, tick: pv.tick, time: pv.tick / 60, paused: true,
      seeking: pv.busy, progress: pv.progress, total: pv.total, unpacked: pv.unpacked,
      previewing: true,
    })
    return
  }

  const sc = scrub.value
  // Unrolling the recording in the background: while the viewer watches, the
  // recording is played forward and a copy of the world is taken at regular
  // intervals. Seeking later starts from the nearest copy rather than from the
  // beginning. The copies live only here — the recording still holds nothing
  // but inputs.
  if (sc && !sc.busy) sc.unpack()

  // Seeking. The world is not wound back but recomputed, so the work is done a
  // frame at a time: on a light level the viewer never notices, and on a heavy
  // one they get a progress bar instead of a frozen window.
  if (sc?.busy) {
    sc.pump()
    bindWorld()
    shapes.value = sc.world.scene()
    trackGhost(); followCamera()
    emit('stats', {
      fps: fps.value, tick: sc.tick, time: sc.tick / 60,
      paused: true, seeking: true, progress: sc.progress, total: sc.total,
      unpacked: sc.unpacked,
    })
    return
  }

  const r = sim()
  if (!r) return
  r.paused = props.paused

  if (!props.paused) {
    if (scroll.x || scroll.y) {
      cam.value.x += scroll.x * elapsed
      cam.value.y += scroll.y * elapsed
      clampCam()
      cam.value = { ...cam.value }
    }
    const ticks = r.frame(elapsed * (props.mode === REPLAY ? props.speed : 1), cam.value)
    if (ticks) {
      shapes.value = r.world.scene()
      if (props.mode === REPLAY) {
        trackGhost(); followCamera()
        // The ladder of snapshots is built up during ordinary watching: the
        // viewer just watches, and seeking backwards gets cheaper for it.

      }
      // The ghost steps exactly the same number of ticks: both simulations run
      // off one counter, so "N ticks behind" is an exact figure rather than an
      // impression.
      const g = ghostRun.value
      if (g) {
        for (let i = 0; i < ticks && g.tick < (props.ghost.ticks || 0); i++) g.frame(1 / 60)
        ghostShapes.value = g.world.scene()
      }
    }
  }

  emit('stats', {
    fps: fps.value, tick: r.tick, time: r.time, paused: props.paused,
    seeking: false, total: sc?.total ?? r.tick,
    unpacked: sc ? sc.unpacked : -1,
    previewing: false,
    // The gap to the ghost in ticks: negative means ahead of the recording
    ghostTick: ghostRun.value ? ghostRun.value.tick : null,
    ghostGap: ghostRun.value ? gapAt(mySplits, ghostSplits) : null,
  })
  if (r.stopped && props.mode === REPLAY) emit('ended')
}

// In a replay the camera follows the recorded track: otherwise the viewer would
// have to guess where to look and keep up with someone else's hand. Once the
// viewer starts moving it themselves (free), the track is not forced back on
// them — watching another run from your own vantage point is a thing people
// want to do.
const free = ref(false)
function followCamera() {
  if (free.value) return
  const c = sim()?.camAt()
  if (!c) return
  cam.value = { ...c }
  clampCam()
}

// Where the recording's finger is now: the last event played through
function trackGhost() {
  const r = sim()
  if (!r) return
  const ev = r.log.events
  const upto = r._cursor ?? r.log._cursor
  if (upto < 4) return
  const kind = ev[upto - 3]
  ghost.value = kind === UP ? null : { x: ev[upto - 2], y: ev[upto - 1] }
}

onMounted(() => {
  build(); setupCamera()
  last = performance.now(); fpsAt = last
  raf = requestAnimationFrame(loop)
})
onBeforeUnmount(() => { cancelAnimationFrame(raf); off?.(); offGhost?.() })

watch(() => props.record, () => { build(); setupCamera() })

// Live input does not go straight into the world — it queues up and arrives on
// the boundary of the next tick. That is the only way the moment of an action
// can be recorded as a tick number that is the same for everyone who replays
// it later.
const pt = (e) => svgPoint(svg.value, e)
const live = () => props.interactive && props.mode === PLAY && !props.paused

function onDown(e) {
  if (!live()) return
  svg.value.setPointerCapture?.(e.pointerId)
  held = true
  run.value.down(pt(e))
}
function onMove(e) {
  if (!live()) return
  edgePush(e)
  run.value.move(pt(e))
}
function onLeave(e) { if (!live()) return; stop(e); run.value.hover(null) }
function onUp(e) { if (live()) stop(e) }
function stop(e) {
  held = false
  scroll = { x: 0, y: 0 }
  run.value.up(pt(e))
}

defineExpose({
  restart: () => { build(); setupCamera() },

  // --- examining the past during a live game ---
  // The run is assembled from what the player has already done: the seed and
  // the recorded input. The attempt's own world is not touched at all.
  previewAt: (tick) => {
    const r = run.value
    if (!r || props.mode !== PLAY) return
    if (!preview.value) preview.value = new Scrubber(props.level, r.snapshot())
    preview.value.seek(tick)
  },
  // Back to the attempt. commit means carrying on from the place being shown
  // (which is a rewind), otherwise the preview is discarded and the player
  // returns to where they were.
  endPreview: (commitTick = null) => {
    const r = run.value
    preview.value = null
    if (commitTick != null && r) r.rollback(commitTick)
    bindWorld()
    shapes.value = sim()?.world.scene() || []
  },
  previewing: () => !!preview.value,
  // Debugging: the scene element itself and what is known about it right now
  svgEl: () => svg.value,
  // The debug information is a recording of the attempt, not a snapshot of the
  // world. The state is fully reconstructible from the seed and the input, so
  // particles, velocities and constraints have no business being in the dump.
  debugInfo: () => {
    const r = sim()
    if (!r) return null
    return {
      levelId: props.level?.id,
      mode: props.mode,
      tick: r.tick,
      camera: { ...cam.value },   // where we were looking: no effect on the simulation, but it makes the shot legible
      diverged: r.diverged ?? null,
      // The attempt itself: seed, input by tick, camera track, checkpoints. In
      // a replay there is nothing to capture — somebody else's recording is
      // playing, so name that instead.
      run: props.mode === PLAY ? r.snapshot() : null,
      replayOf: props.record ? { targetId: props.record.targetId, hash: props.record.hash, ticks: props.record.ticks } : null,
    }
  },
  // --- playback controls ---
  // Stand on a tick. Going back means recomputing from the start, so the price
  // is worth showing in advance: costOf() says how many ticks that will be.
  seek: (t) => scrub.value?.seek(t),
  stepFrames: (n) => scrub.value?.seek((scrub.value.tick || 0) + n),
  costOf: (t) => scrub.value?.costOf(t) ?? 0,
  total: () => scrub.value?.total ?? 0,
  // Rewinding is available only in ordinary play. In a speedrun Run refuses it
  // itself, and the interface does not offer the button either.
  rollback: (tick) => run.value?.rollback(tick) ?? false,
  canRollback: () => props.mode === PLAY && !props.speedrun,
  // unhook the camera from the recording and watch the replay with your own eyes
  freeCamera: (on) => { free.value = on },
  run: () => run.value,
  snapshot: () => run.value?.snapshot(),
  finish: () => run.value?.finish(),
})
</script>

<style scoped>
.stage {
  display: block; width: 100%; height: 100%; touch-action: none;
  background: linear-gradient(#101c25, #16242b 55%, #1d2a24);
}
.ghost-run { opacity: 0.32; pointer-events: none; filter: saturate(0.3); }
.ghost circle { fill: none; stroke: #ffd9a0; stroke-width: 2; opacity: 0.75; }
.ghost .core { fill: #ffd9a0; stroke: none; opacity: 0.9; }
</style>
