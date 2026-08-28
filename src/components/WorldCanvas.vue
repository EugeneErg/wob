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
    <!-- Призрак: чужой (или свой прошлый) прогон, идущий рядом. Отдельный мир
         поверх нынешнего, полупрозрачный. На игру он не влияет никак — это
         вторая симуляция, которая просто рисуется тем же способом. -->
    <g v-if="ghostShapes.length" class="ghost-run">
      <SvgScene :shapes="ghostShapes" />
    </g>

    <SvgScene :shapes="shapes" />

    <!-- Курсор записи. В повторе рука игрока не видна ничем другим:
         шар едет сам, и без метки непонятно, что его тащат. -->
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
  // Режим: живая попытка или повтор записи
  mode: { type: String, default: PLAY },
  // Запись для повтора (snapshot() из Run)
  record: { type: Object, default: null },
  // Сид живой попытки. Задаёт его тот, кто начинает попытку, — так он
  // попадает в запись и повтор идёт по тому же случайному потоку.
  seed: { type: Number, default: 1 },
  // Скорость повтора: 1 — как играли, 2 — вдвое быстрее
  speed: { type: Number, default: 1 },
  // Спидран: откатов нет. Флаг уезжает в Run, где и стоит запрет.
  speedrun: { type: Boolean, default: false },
  // Запись, которая идёт рядом призраком: обычно лучшая попытка на этом
  // уровне. Гонка с ней и есть главный смысл спидрана — видно не итоговое
  // время, а где именно ты отстаёшь.
  ghost: { type: Object, default: null },
})
const emit = defineEmits(['progress', 'missing', 'stats', 'ended'])

const svg = ref(null)
const shapes = shallowRef([])
// В живой игре это Run, в повторе — Scrubber, который Run внутри себя держит
// и умеет вставать на любой тик. Всё остальное работает с sim() — с тем самым
// прогоном, чей мир сейчас на экране.
const run = shallowRef(null)
const scrub = shallowRef(null)
// Прогон-призрак. Идёт теми же тиками, что и основной, поэтому отставание
// считается прямо в тиках, а не в секундах по часам.
const ghostRun = shallowRef(null)
const ghostShapes = shallowRef([])
const sim = () => (props.mode === REPLAY ? scrub.value?.run : run.value)
const ghost = shallowRef(null)
const w = computed(() => props.level.width || 1600)
const h = computed(() => props.level.height || 900)

// Камера. Зума нет: окно постоянного размера ездит по уровню.
// Камера — дело зрителя, а не мира: в записи её нет, и на симуляцию она
// не влияет. Поэтому свой повтор можно смотреть с другого места экрана.
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

// Кадры в секунду — это про экран, а не про симуляцию. Считаем их отдельно
// от тиков и показываем оба числа: расхождение между ними сразу видно,
// если устройство не тянет.
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

// Когда призрак и когда игрок доводили шар до цели. Сравнивать «кто где» надо
// на общих отметках, а не по номеру тика: отставание в тиках само по себе
// ничего не значит, потому что оба могут быть в разных местах уровня. А вот
// «третий шар в трубе: у тебя на 4.2 с, у призрака на 3.6 с» — это и есть
// то, что спидранер хочет знать.
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
  // Призрак играется на СВОЁМ содержимом: если запись снята на другой версии
  // уровня, гнаться с ней нечестно, но и прятать её не нужно — пусть идёт,
  // а несовпадение версии видно на экране.
  ghostRun.value = replayOf(props.level, props.ghost)
  let n = 0
  offGhost = ghostRun.value.world.on(EVENTS.progress, (e) => {
    n += e?.delta ?? 1
    ghostSplits[n] = ghostRun.value.tick
  })
  ghostShapes.value = ghostRun.value.world.scene()
}

// Расчёт отставания живёт в splits.js: в компоненте его нельзя проверить
// тестом, а ошибка в нём тихо покажет игроку неверную разницу.

// Мир при перемотке назад создаётся заново — значит и подписку на события
// надо перевешивать, иначе счётчик цели остался бы слушать выброшенный мир.
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

  // Предел частоты отрисовки. Кадр просто пропускается — симуляция от этого
  // не меняется: она идёт фиксированными тиками, и пропущенный кадр означает
  // лишь, что в следующий раз их отработается больше за раз.
  const cap = settings().fpsCap
  if (cap) {
    const need = 1000 / cap - 0.5   // полмиллисекунды допуска, иначе теряем каждый второй кадр
    if (t - last < need) return
  }

  const elapsed = Math.min((t - last) / 1000 || 0, 0.25)
  last = t

  // счётчик кадров идёт всегда, даже на паузе: он про отрисовку
  frames++
  if (t - fpsAt >= 500) { fps.value = Math.round((frames * 1000) / (t - fpsAt)); frames = 0; fpsAt = t }

  const sc = scrub.value
  // Фоновое разворачивание записи: пока зритель смотрит, запись проигрывается
  // вперёд и через равные промежутки снимается копия мира. Перемотка потом
  // считается от ближайшей копии, а не от начала. Копии живут только здесь,
  // в записи по-прежнему одни действия.
  if (sc && !sc.busy) sc.unpack()

  // Перемотка. Мир не отматывается, а считается заново, поэтому работа идёт
  // порциями по кадру: на лёгком уровне зритель этого не заметит, на тяжёлом
  // увидит полосу вместо застывшего окна.
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
        // Лестница снимков достраивается по ходу обычного просмотра: зритель
        // просто смотрит, а отмотка назад от этого дешевеет.

      }
      // Призрак шагает ровно столько же тиков: обе симуляции идут по общему
      // счётчику, поэтому «отстаю на N тиков» — точная величина, а не на глаз.
      const g = ghostRun.value
      if (g) {
        for (let i = 0; i < ticks && g.tick < (props.ghost.ticks || 0); i++) g.frame(1 / 60)
        ghostShapes.value = g.world.scene()
      }
    }
  }

  emit('stats', {
    fps: fps.value, tick: r.tick, time: r.time, paused: props.paused,
    seeking: false, total: sc?.total ?? 0,
    unpacked: sc ? sc.unpacked : null,
    // Отставание от призрака в тиках: минус — идём впереди записи
    ghostTick: ghostRun.value ? ghostRun.value.tick : null,
    ghostGap: ghostRun.value ? gapAt(mySplits, ghostSplits) : null,
  })
  if (r.stopped && props.mode === REPLAY) emit('ended')
}

// В повторе камера едет по записанной дорожке: иначе зритель должен был бы
// сам угадывать, куда смотреть, и успевать за чужой рукой. Если зритель
// взялся крутить сам (free), дорожку не навязываем — смотреть чужой прогон
// со своей точки тоже надо уметь.
const free = ref(false)
function followCamera() {
  if (free.value) return
  const c = sim()?.camAt()
  if (!c) return
  cam.value = { ...c }
  clampCam()
}

// Где сейчас «палец» записи: последнее событие, докуда доиграли
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

// Живой ввод не идёт в мир напрямую — он встаёт в очередь и попадёт туда
// на границе ближайшего тика. Только так момент действия можно записать
// числом тика, одинаковым у всех, кто потом эту запись проиграет.
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
  // Отладка: сам элемент сцены и то, что о ней сейчас известно
  svgEl: () => svg.value,
  // Отладочные сведения — это запись попытки, а не слепок мира. Из сида и
  // ввода состояние восстанавливается целиком, поэтому частицам, скоростям и
  // связям в выгрузке делать нечего.
  debugInfo: () => {
    const r = sim()
    if (!r) return null
    return {
      levelId: props.level?.id,
      mode: props.mode,
      tick: r.tick,
      camera: { ...cam.value },   // куда смотрели: на симуляцию не влияет, но помогает понять снимок
      diverged: r.diverged ?? null,
      // Сама попытка: сид, ввод по тикам, дорожка камеры, контрольные отметки.
      // В повторе снимать нечего — там играется чужая запись, её и укажем.
      run: props.mode === PLAY ? r.snapshot() : null,
      replayOf: props.record ? { targetId: props.record.targetId, hash: props.record.hash, ticks: props.record.ticks } : null,
    }
  },
  // --- управление просмотром ---
  // Встать на тик. Назад — пересчёт с начала, поэтому цену стоит показать
  // заранее: costOf() отвечает, сколько тиков придётся посчитать.
  seek: (t) => scrub.value?.seek(t),
  stepFrames: (n) => scrub.value?.seek((scrub.value.tick || 0) + n),
  costOf: (t) => scrub.value?.costOf(t) ?? 0,
  total: () => scrub.value?.total ?? 0,
  // Откат доступен только обычному прохождению; в спидране Run откажет сам,
  // но и кнопки для него интерфейс не покажет.
  rollback: (tick) => run.value?.rollback(tick) ?? false,
  canRollback: () => props.mode === PLAY && !props.speedrun,
  // отцепить камеру от записи и смотреть повтор своими глазами
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
