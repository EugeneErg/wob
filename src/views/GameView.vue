<template>
  <div class="game">
    <p v-if="lost" class="stale-bar">
      Версия, на которой снята запись, недоступна — показать повтор не на чем
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
      <button class="btn ghost small" @click="leave">← Уровни</button>

      <!-- Цель выполнена, но решает игрок: пока не нажал, можно играть дальше
           и загонять шары сверх нормы. -->
      <button v-if="reached && !won && mode === 'play'" class="btn small primary end" @click="finishNow">
        Закончить<i>{{ clock }}</i>
      </button>

      <div class="counter" :class="{ done: collected >= playLevel.goal }">
        <span class="num">{{ collected }}</span>
        <span class="of">/ {{ playLevel.goal }}</span>
        <span class="cap">в трубе</span>
      </div>

      <!-- Время попытки идёт тиками, а не секундомером: у игрока на 30 кадрах
           и на 144 одно и то же прохождение даст одно и то же число. -->
      <div class="timer" :class="{ run: mode === 'replay' }">{{ clock }}</div>

      <!-- Отставание от призрака. Считается на общих отметках (столько-то
           шаров в трубе), а не по номеру тика: тик сам по себе ничего не
           говорит, если игроки в разных местах уровня. -->
      <div v-if="gap !== null" class="gap" :class="{ ahead: gap < 0 }">
        {{ gap < 0 ? '−' : '+' }}{{ fmt(Math.abs(gap)) }}
        <i>{{ gap < 0 ? 'впереди' : 'позади' }}</i>
      </div>

      <!-- Пауза на телефоне: там нет Esc, и жать её надо большим пальцем -->
      <button class="btn small icon" :aria-label="paused ? 'Продолжить' : 'Пауза'" @click="togglePause">
        {{ paused ? '▶' : '❚❚' }}
      </button>
      <button v-if="mode === 'play'" class="btn small" @click="restart">Заново</button>
      <!-- Отладка: снимок экрана и выгрузка состояния. Нужны, чтобы об ошибке
           можно было говорить фактами — что было видно, на каком тике, с каким
           сидом — а не пересказом. -->
      <button class="btn small icon" title="Снимок экрана (F9)" @click="shot">◉</button>
      <button class="btn small icon" title="Выгрузить состояние (F10)" @click="dump">⤓</button>
    </div>

    <!-- Управление просмотром. Вперёд перемотка бесплатна — это обычное
         продолжение прогона. Назад мир считается заново с начала, поэтому
         рядом показано, сколько тиков придётся пересчитать: на уровне с водой
         это заметное ожидание, и лучше сказать заранее, чем подвесить экран. -->
    <div v-if="mode === 'replay' && !lost && !loading" class="deck">
      <div class="line">
        <button class="btn small icon" @click="togglePause">{{ paused ? '▶' : '❚❚' }}</button>
        <!-- Полоса времени. Тёмная часть — то, что ещё не развёрнуто:
             перемотать туда можно, но придётся подождать пересчёта. -->
        <span class="track">
          <span class="buffered" :style="{ width: Math.round((unpacked ?? 1) * 100) + '%' }" />
          <input
            class="scrub" type="range" min="0" :max="total || 1" :value="tick"
            @input="onScrub(+$event.target.value)"
          />
        </span>
        <span class="pos">{{ clock }} / {{ fmt(total) }}</span>
      </div>

      <div class="line">
        <button class="btn small" @click="jump(-5)">◀◀ 5 с</button>
        <button class="btn small" :disabled="!paused" @click="frameStep(-1)">◀ кадр</button>
        <button class="btn small" :disabled="!paused" @click="frameStep(1)">кадр ▶</button>
        <button class="btn small" @click="jump(5)">5 с ▶▶</button>
        <span class="speeds">
          <button
            v-for="s in [0.25, 0.5, 1, 2, 4]" :key="s"
            class="sp" :class="{ on: rate === s }" @click="rate = s"
          >{{ s }}×</button>
        </span>
      </div>

      <p v-if="unpacked !== null && unpacked < 1" class="unpack">
        разворачиваем запись: {{ Math.round(unpacked * 100) }}% — смотреть можно уже сейчас,
        перематывать в пределах развёрнутого
      </p>

      <div v-if="seeking" class="seek">
        <div class="fill" :style="{ width: Math.round(progress * 100) + '%' }" />
        <span>пересчёт: {{ Math.round(progress * 100) }}%</span>
      </div>
    </div>

    <div class="fps" :class="{ low: fps > 0 && fps < 50 }">
      {{ fps }} FPS<span class="sub">· тик {{ tick }}</span>
    </div>

    <p v-if="outdated" class="stale-bar">{{ outdated }}</p>

    <p v-if="missing.length" class="warn">
      Уровень использует сущности, которых нет в сборке: {{ missing.join(', ') }}
    </p>

    <!-- Пауза. В спидране она останавливает и часы: время считается тиками,
         а на паузе тиков нет, поэтому «постоять подумать» бесплатно не выйдет —
         запись просто не растёт, и продолжается с того же места. -->
    <transition name="pop">
      <div v-if="paused" class="panel">
        <p class="eyebrow">Пауза</p>
        <h2>{{ level.name }}</h2>
        <!-- Перемотка живёт только в обычном прохождении. В спидране её нет:
             откатиться и переиграть неудачный кусок — это не то же состязание,
             что пройти подряд, и мерить их одной таблицей нельзя. -->
        <div v-if="canRewind" class="rewind">
          <button class="btn small" @click="rewind(1)">◀ 1 с</button>
          <button class="btn small" @click="rewind(5)">◀ 5 с</button>
          <span class="hint-rw">переиграть с этого места</span>
        </div>

        <div class="row">
          <button class="btn primary" @click="togglePause">Продолжить</button>
          <button v-if="mode === 'play'" class="btn" @click="restart">Заново</button>
          <button class="btn" @click="leave">Выйти</button>
        </div>
        <!-- Частота кадров: спидранеры обычно хотят её задать явно, а не
             отдавать на волю браузера. На результат она не влияет — тик всегда
             один и тот же, — но влияет на плавность. -->
        <label class="fps-pick">
          <span>Кадров в секунду</span>
          <select :value="fpsCap" @change="setFps(+$event.target.value)">
            <option v-for="f in FPS_OPTIONS" :key="f" :value="f">{{ fpsLabel(f) }}</option>
          </select>
        </label>

        <p class="note">Esc — пауза и обратно · симуляция всегда 60 тиков в секунду</p>
      </div>
    </transition>

    <transition name="pop">
      <div v-if="won && !paused" class="panel">
        <p class="eyebrow">{{ mode === 'replay' ? 'Повтор досмотрен' : 'Уровень пройден' }}</p>
        <h2>{{ playLevel.name }}</h2>
        <p v-if="outdated" class="stale">{{ outdated }}</p>
        <p class="result">{{ clock }}<span v-if="best" class="best">лучшее: {{ best }}</span></p>
        <div class="row">
          <button class="btn primary" @click="leave">На карту</button>
          <button class="btn" @click="restart">Ещё раз</button>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, shallowRef, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import WorldCanvas from '../components/WorldCanvas.vue'
import { markDone } from '../core/library.js'
import { saveRun, bestRun, formatTime, KIND } from '../core/replays.js'
import { seedFor, checkRecord } from '../core/releases.js'
import { contentFor } from '../core/content.js'
import { saveScreenshot, saveState } from '../core/debug.js'
import { settings, setSetting, FPS_OPTIONS, fpsLabel } from '../core/settings.js'

const props = defineProps({
  level: { type: Object, required: true },
  // 'play' — живая попытка, 'replay' — просмотр записи
  mode: { type: String, default: 'play' },
  record: { type: Object, default: null },
  speedrun: { type: Boolean, default: false },
  speed: { type: Number, default: 1 },
  // какой выпуск играем; null — черновик автора
  releaseId: { type: String, default: null },
  // Уровень играется сам по себе или как звено прохождения главы. В цепочке
  // уровень не сохраняет свою попытку отдельно и не отмечает общий прогресс —
  // это делает та сторона, что ведёт цепочку, когда заход закончится.
  chained: { type: Boolean, default: false },
  // где начат спидран — попадает в отладочную выгрузку
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
const reached = ref(false)   // цель выполнена, но игрок ещё не закончил
const total = ref(0)
const seeking = ref(false)
const progress = ref(1)
const unpacked = ref(null)
// Скорость просмотра. Начальное значение приходит снаружи, дальше зритель
// крутит сам: разбирать чужой прогон удобнее медленно, пересматривать — быстро.
const rate = ref(props.speed)

const fpsCap = ref(settings().fpsCap)
const setFps = (v) => { fpsCap.value = v; setSetting('fpsCap', v) }

// Призрак: лучшая попытка на этом уровне, идущая рядом. Берётся только для
// живой игры — в повторе гнаться не с кем.
const ghost = shallowRef(null)
const gap = ref(null)

watch(() => props.level?.id, async (id) => {
  ghost.value = null
  gap.value = null
  if (!id || props.mode !== 'play') return
  const b = await bestRun(id, { kind: KIND.LEVEL })
  // С записью, снятой на другой версии, гонка бессмысленна: там был другой
  // уровень или другая физика, и сравнивать время не с чем.
  if (b && checkRecord(b).ok) ghost.value = b
}, { immediate: true })
const best = ref(null)
const saved = ref(false)

// Повтор идёт на той версии, при которой его сняли, а не на нынешней. Сам
// уровень в записи не лежит — там ссылка на версию, а снимок по ней отдаёт
// хранилище содержимого (местное сейчас, серверное потом).
const resolved = shallowRef(null)
const playLevel = computed(() => resolved.value || props.level)
// пока версия не приехала, играть нельзя: покажем чужой уровень
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

// Сид считается из самого уровня, а не из попытки: один и тот же уровень
// обязан давать один и тот же случайный поток, играют его первым или четвёртым,
// отдельно или внутри главы. Случайность здесь — часть уровня, а не сеанса.
const seed = computed(() => seedFor(playLevel.value))
const record = computed(() => props.record)

// Актуальна ли версия. Запись это не прячет и играть не мешает — просто
// честно говорит, что снята на другом.
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
  gap.value = s.ghostGap ?? null
}

const fmt = (t) => formatTime(t || 0)

// Перемотка полосой. На паузе остаёмся на паузе: зритель тянет ползунок,
// чтобы рассмотреть момент, а не чтобы игра поехала дальше.
function onScrub(t) { canvas.value?.seek(t) }
function jump(seconds) {
  const t = Math.max(0, tick.value + Math.round(seconds * 60))
  canvas.value?.seek(t)
}
// Шаг по кадрам — только на паузе: покадровый разбор и есть главное, ради чего
// перемотку заводят.
function frameStep(n) {
  if (!paused.value) return
  canvas.value?.stepFrames(n)
}

// Цель достигнута — но уровень не заканчивается сам.
//
// Раньше он завершался в тот же миг, и это отбирало у игрока решение: вдруг он
// хочет загнать в трубу ещё шаров, чем требуется. Теперь появляется кнопка
// «Закончить», а до неё игра продолжается как ни в чём не бывало — часы идут,
// шары двигаются. Нажатие и есть конец попытки.
watch(collected, (n) => {
  if (n >= playLevel.value.goal) reached.value = true
})

async function finishNow() {
  if (won.value || props.mode !== 'play') return
  won.value = true
  canvas.value?.finish()
  // Общий прогресс пишет только обычное прохождение. В спидране прошлые
  // заслуги не в счёт: там открыто ровно то, что открыто в этой попытке,
  // иначе можно было бы начать главу с середины по старому сохранению.
  if (!props.speedrun) markDone(props.level.id)
  await store()
}

// Каждая попытка сохраняется целиком — и удачная, и брошенная: посмотреть
// «как я слил» бывает нужнее, чем посмотреть удачный прогон.
async function store() {
  if (saved.value) return
  const snap = canvas.value?.snapshot()
  if (!snap) return
  saved.value = true
  // Звено цепочки отдаёт свой заход наверх и на этом заканчивает: сегмент
  // ляжет в попытку главы, а отдельной записи уровня не будет — иначе одна
  // игра порождала бы две записи об одном и том же.
  if (props.chained) { emit('result', snap); return }
  await saveRun(snap, {
    kind: KIND.LEVEL, targetId: props.level.id, speedrun: props.speedrun,
    releaseId: props.releaseId || null,   // ссылка на версию, а не её снимок
  })
  const b = await bestRun(props.level.id, { kind: KIND.LEVEL })
  best.value = b ? formatTime(b.ticks, b.rate) : null
}

// Повтор доигран. У попытки главы за этим сегментом идёт следующий, поэтому
// о конце надо сообщить наверх, а не просто показать табличку.
function onReplayEnd() {
  if (props.chained) { emit('ended'); return }
  won.value = true
}

function togglePause() { paused.value = !paused.value }

// Снимок ровно того, что на экране, вместе с камерой. Ставим паузу: иначе
// снимок окажется на кадр позже того, что человек хотел заснять.
function shot() {
  paused.value = true
  saveScreenshot(canvas.value?.svgEl(), `${playLevel.value.id}-t${tick.value}`)
}

// Выгрузка: содержимое (библиотека, прогресс, записи) плюс сама попытка —
// сид и ввод, из которых момент воспроизводится точно. Физики в ней нет: она
// пересчитывается, а не хранится.
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

// Откат на несколько секунд назад. Мир не отматывается — он пересчитывается
// заново по обрезанной записи, поэтому на тяжёлом уровне это не мгновенно.
function rewind(seconds) {
  if (!canRewind.value) return
  canvas.value?.rollback(Math.max(0, tick.value - Math.round(seconds * 60)))
  collected.value = 0   // счёт цели считается миром заново
}

function restart() {
  collected.value = 0
  won.value = false
  reached.value = false
  saved.value = false
  paused.value = false
  canvas.value.restart()
}

// Выход посреди уровня — тоже попытка. Записываем её, прежде чем уйти.
async function leave() {
  if (props.mode === 'play' && !saved.value && tick.value > 0) await store()
  emit('back')
}

function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); togglePause(); return }
  if (e.key === 'F9') { e.preventDefault(); shot(); return }
  if (e.key === 'F10') { e.preventDefault(); dump(); return }
  if (props.mode !== 'replay') return
  // Раскладка как у видеоразбора: пробел — пауза, стрелки — время,
  // запятая и точка — по кадру.
  if (e.key === ' ') { e.preventDefault(); togglePause() }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); jump(-5) }
  else if (e.key === 'ArrowRight') { e.preventDefault(); jump(5) }
  else if (e.key === ',') { e.preventDefault(); frameStep(-1) }
  else if (e.key === '.') { e.preventDefault(); frameStep(1) }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// Вкладку свернули — ставим паузу сами: иначе игрок вернётся к миру,
// который простоял без него, и не поймёт, почему всё лежит.
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
