<template>
  <div class="screen">
    <header class="bar">
      <button class="btn ghost small" @click="$emit('back')">← Главы</button>
      <h2>{{ ch?.title }}</h2>
      <template v-if="mode === 'edit'">
        <button class="btn small" @click="hotOpen = !hotOpen">Горячие ассеты</button>
        <button class="btn small" @click="pic">Картинка</button>
        <button class="btn small primary" @click="addLevel">Новый уровень</button>
      </template>
      <template v-else>
        <span class="counter">{{ passed }} / {{ nodes.length }}</span>
        <!-- Часы попытки. Идут только внутри уровней: карта тиков не даёт,
             поэтому выбор ветки и раздумья времени не стоят. -->
        <span v-if="run" class="igt" :class="{ sr: speedrun }">
          {{ igt }}<i>{{ inStory ? 'история целиком' : speedrun ? 'спидран' : 'прохождение' }}</i>
        </span>
        <button class="btn small" @click="$emit('runs', { kind: 'chapter', targetId: chapterId })">
          Попытки главы
        </button>
      </template>
    </header>

    <section v-if="hotOpen && mode === 'edit'" class="hot">
      <p class="note">Отмеченные поднимутся наверх списка редактора во всех уровнях этой главы.</p>
      <button
        v-for="a in allAssets" :key="a.id"
        class="chip" :class="{ on: isHot(a.id) }"
        @click="toggleHot(a.id)"
      >{{ a.title }}</button>
    </section>

    <!-- Выбор режима. Спидран отличается тем, что открыто ровно то, что
         открыто в этой попытке: начать с середины по старому сохранению нельзя,
         и откатов внутри уровня тоже нет. -->
    <!-- Спидран сверху наследуется — тогда не спрашиваем. Обычное прохождение
         истории не наследуется: внутри него отдельную главу можно спидранить,
         и это самостоятельное состязание со своим временем. -->
    <ModePick
      v-if="mode === 'play' && ask"
      title="Как проходим главу?"
      sr-note="с начала подряд, без сохранений и откатов"
      plain-note="сохраняется, можно вернуться позже"
      :note="routingNeeded
        ? 'В главе несколько концов, и ни один не привязан к следующей главе — засчитать прохождение будет нельзя, пока автор этого не сделает.'
        : 'Можно и просто играть уровни по одному — каждый со своим временем.'"
      @pick="choose"
    />

    <div class="map-wrap">
      <div
        ref="map" class="map" :style="coverStyle(ch?.image)"
        @pointerdown="onEmpty" @pointermove="onMove" @pointerup="onUp" @pointerleave="onUp"
      >
        <svg class="paths" viewBox="0 0 100 100" preserveAspectRatio="none">
          <line
            v-for="(e, i) in shownEdges" :key="i"
            :x1="pos(e.from).x" :y1="pos(e.from).y" :x2="pos(e.to).x" :y2="pos(e.to).y"
            :class="{ dim: mode === 'edit' && !visible(e) }"
          />
        </svg>

        <button
          v-for="n in nodes" :key="n.levelId"
          class="node"
          :class="{ done: isDone(n.levelId), locked: isLocked(n), sel: sel === n.levelId, exit: !!n.next }"
          :style="{ left: n.x + '%', top: n.y + '%' }"
          @pointerdown.stop="onDown(n, $event)"
          @dblclick.stop="mode === 'edit' && $emit('edit', n.levelId)"
        >
          <span class="dot" />
          <span class="cap">{{ name(n.levelId) }}<span v-if="n.next" class="arrow">→ {{ chapterName(n.next) }}</span></span>
        </button>

        <!-- меню у самой точки -->
        <div
          v-if="mode === 'edit' && selectedNode"
          class="menu"
          :style="menuStyle"
          @pointerdown.stop @click.stop
        >
          <div class="menu-head">{{ selected?.name }}</div>
          <button class="item" @click="$emit('edit', sel)">Редактировать</button>
          <button class="item" @click="copy">Сделать копию</button>
          <button class="item danger" @click="drop">Удалить уровень</button>

          <!-- Куда ведёт глава, если игрок вышел через этот уровень.
               Привязка и делает узел выходом: без неё узел без троп — тупик,
               и прохождение через него главу не засчитывает. -->
          <label class="menu-field">
            <span>Дальше — глава</span>
            <select :value="selectedNode?.next || ''" @change="setNext($event.target.value)">
              <option value="">— нет, это не выход —</option>
              <option v-for="c in otherChapters" :key="c.id" :value="c.id">{{ c.title }}</option>
            </select>
          </label>
          <div class="menu-note">Shift+клик по другой точке — тропинка</div>
        </div>

        <!-- В игре у точки тоже есть меню, но одно: посмотреть свои попытки
             на этом уровне. Клик по самой точке по-прежнему запускает уровень. -->
        <div
          v-if="mode === 'play' && selectedNode"
          class="menu"
          :style="menuStyle"
          @pointerdown.stop @click.stop
        >
          <div class="menu-head">{{ selected?.name }}</div>
          <button class="item" @click="startLevel(sel)">Играть</button>
          <button class="item" @click="$emit('runs', { kind: 'level', targetId: sel })">Мои попытки</button>
        </div>

        <p v-if="!nodes.length" class="empty">
          {{ mode === 'edit' ? 'Пока пусто — добавьте первый уровень.' : 'В этой главе ещё нет уровней.' }}
        </p>
      </div>

      <p v-if="mode === 'edit' && routingNeeded" class="alarm">
        В главе несколько концов ({{ dead.join(', ') }}), но ни один никуда не ведёт.
        Пока так, глава не засчитывается пройденной: непонятно, какой конец настоящий,
        а какой — боковой тупик. Привяжите к нужному узлу следующую главу.
      </p>
      <p v-else-if="mode === 'edit' && dead.length" class="note-dead">
        Тупики (проходятся, но главу не завершают): {{ dead.join(', ') }}
      </p>

      <p class="hint">{{ hint }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import * as lib from '../core/library.js'
import { pickImage, coverStyle } from '../core/fileio.js'
import ModePick from '../components/ModePick.vue'
import { shouldAsk } from '../core/modes.js'
import { deadEnds, needsRouting, openNodes } from '../core/chain.js'
import { formatTime } from '../core/replays.js'

const props = defineProps({
  mode: { type: String, default: 'play' },
  chapterId: String,
  // Идущая попытка главы (ChainRun) — если её нет, сначала спрашиваем режим
  run: { type: Object, default: null },
  speedrun: { type: Boolean, default: false },
  // где начат спидран: null | 'story' | 'chapter' | 'level'
  srScope: { type: String, default: null },
  // Глава открыта внутри прохождения истории
  inStory: { type: Boolean, default: false },
  // Выпуск, если играется он: имена уровней и состав главы берутся оттуда
  release: { type: Object, default: null },
})
const emit = defineEmits(['back', 'play', 'edit', 'start', 'runs'])

// ref разворачивает объект главы в реактивный прокси: правки узлов сразу видны,
// а пишутся они в тот же объект библиотеки, который потом сохраняется.
// Раньше здесь был computed, он возвращал один и тот же объект — Vue считал,
// что ничего не изменилось, и карта не перерисовывалась до перезагрузки.
const fromRelease = (id) => props.release?.chapters.find((c) => c.id === id) || null
const levelOf = (id) => props.release?.levels.find((l) => l.id === id) || lib.level(id)
const ch = ref(fromRelease(props.chapterId) || lib.chapter(props.chapterId))
const tick = ref(0)
// tick нужен там, где библиотека правит объект напрямую, мимо прокси:
// новый массив на каждое изменение — иначе Vue не увидит разницы
const nodes = computed(() => (tick.value, [...(ch.value?.nodes || [])]))
const map = ref(null)
const sel = ref(null)
const hotOpen = ref(false)
let drag = null

const allAssets = computed(() => lib.assets())
const isHot = (id) => lib.isHot('chapter', props.chapterId, id)
const toggleHot = (id) => { lib.toggleHot('chapter', props.chapterId, id); tick.value++ }

// Что считать пройденным. В спидране — только то, что пройдено в этой
// попытке: прошлые заслуги не открывают дорогу, иначе главу можно было бы
// начать с середины. В обычном прохождении — общий прогресс, как раньше.
// В попытке истории засчитываем только те заходы, что относятся к этой главе:
// у попытки внутри лежат сегменты всех глав сразу.
const doneSet = computed(() => {
  tick.value
  const r = props.run
  if (!r) return null
  if (!props.inStory) return r.done
  const s = new Set()
  for (const g of r.segments) if (g.finished && g.chapterId === props.chapterId) s.add(g.levelId)
  return s
})
const isDone = (id) => (doneSet.value ? doneSet.value.has(id) : lib.isDone(id))
const igt = computed(() => (props.run ? formatTime(props.run.ticks) : '0.000'))

// Спрашиваем один раз за вход в главу; спрашивать ли вообще — решает modes.js
const asked = ref(false)
const ask = computed(() => !asked.value && shouldAsk('chapter', props.srScope))
const choose = (sr) => { asked.value = true; emit('start', sr) }
const name = (id) => levelOf(id)?.name || '?'
const chapterName = (id) => (fromRelease(id) || lib.chapter(id))?.title || '?'
const startLevel = (id) => { sel.value = null; emit('play', id) }
const passed = computed(() => nodes.value.filter((n) => isDone(n.levelId)).length)
const selected = computed(() => (sel.value ? levelOf(sel.value) : null))
const selectedNode = computed(() => nodes.value.find((n) => n.levelId === sel.value) || null)
const menuStyle = computed(() => {
  const n = selectedNode.value
  if (!n) return {}
  const dx = n.x > 68 ? '-100%' : n.x < 32 ? '0%' : '-50%'
  const below = n.y < 62
  return {
    left: n.x + '%',
    top: n.y + '%',
    transform: `translate(${dx}, ${below ? '26px' : 'calc(-100% - 26px)'})`,
  }
})

const pos = (levelId) => nodes.value.find((n) => n.levelId === levelId) || { x: 50, y: 50 }
const visible = (e) => lib.edgeVisible(e)
const shownEdges = computed(() =>
  (ch.value?.edges || []).filter((e) => props.mode === 'edit' || visible(e)))
// Какие узлы открыты. Правило одно и то же, но считается по прогрессу той
// попытки, которая идёт, а не по общему сохранению.
const openSet = computed(() =>
  (tick.value, doneSet.value && ch.value ? new Set(openNodes(ch.value, doneSet.value)) : null))
const isLocked = (n) => {
  if (props.mode !== 'play') return false
  if (openSet.value) return !openSet.value.has(n.levelId)
  return !lib.levelOpen(ch.value, n.levelId)
}

const hint = computed(() => {
  if (props.mode === 'play') return 'Открытые уровни горят ярче. Клик — играть, долгое нажатие — меню с записями попыток.'
  return 'Клик по точке — меню уровня, двойной клик — открыть его сразу, перетаскивание — подвинуть, Shift+клик по второй точке — тропинка.'
})

// Клик по точке разбираем сами: карта захватывает указатель ради перетаскивания,
// а вместе с ним и событие click — до кнопки оно уже не доходит.
function onDown(n, e) {
  drag = { n, moved: 0, shift: e.shiftKey, at: Date.now(), long: false }
  // Долгое нажатие — то же, что правый клик, но работает пальцем.
  if (props.mode === 'play') {
    const d = drag
    setTimeout(() => { if (drag === d) d.long = true }, 450)
  }
  if (props.mode === 'edit') map.value.setPointerCapture?.(e.pointerId)
}

function onEmpty() { drag = { empty: true, moved: 0 } }

function onMove(e) {
  if (!drag) return
  drag.moved++
  if (!drag.n || props.mode !== 'edit') return
  const r = map.value.getBoundingClientRect()
  const x = ((e.clientX - r.left) / r.width) * 100
  const y = ((e.clientY - r.top) / r.height) * 100
  drag.n.x = Math.max(2, Math.min(98, x))
  drag.n.y = Math.max(4, Math.min(96, y))
}

function onUp() {
  const d = drag
  drag = null
  if (!d) return
  const click = d.moved < 3          // почти не двигали — считаем кликом

  if (d.empty) { if (click) sel.value = null; return }
  if (props.mode !== 'edit') {
    if (!click) return
    if (isLocked(d.n)) return
    // Второй клик по уже выбранной точке — меню: оттуда видно попытки.
    // Первый — запуск, чтобы играть по-прежнему одним касанием.
    if (sel.value === d.n.levelId) { sel.value = null; return }
    if (d.long) { sel.value = d.n.levelId; return }
    emit('play', d.n.levelId)
    return
  }
  if (!click) { lib.save(); return }
  if (d.shift && sel.value && sel.value !== d.n.levelId) link(sel.value, d.n.levelId)
  else sel.value = d.n.levelId
}

function link(a, b) {
  const edges = ch.value.edges
  const i = edges.findIndex((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a))
  if (i >= 0) edges.splice(i, 1)
  else edges.push({ from: a, to: b })
  lib.save(); tick.value++
}

function addLevel() {
  const l = lib.createLevel(props.chapterId)
  tick.value++
  emit('edit', l.id)
}
function copy() {
  lib.copyLevel(props.chapterId, sel.value)
  tick.value++
}
function drop() {
  const l = selected.value
  if (l && confirm(`Удалить уровень «${l.name}»?`)) { lib.removeLevel(props.chapterId, l.id); sel.value = null; tick.value++ }
}
// Другие главы этой истории — куда можно вывести. Сама себя глава в список
// не берёт: выход в самого себя это не выход, а петля.
const otherChapters = computed(() =>
  (tick.value, lib.chaptersOf(ch.value?.storyId).filter((c) => c.id !== props.chapterId)))

function setNext(chapterId) {
  const n = selectedNode.value
  if (!n) return
  if (chapterId) n.next = chapterId
  else delete n.next
  lib.save(); tick.value++
}

// Тупики — узлы, из которых некуда идти и к которым не привязано продолжение.
// Пока концов несколько и ни один не привязан, глава вообще не засчитывается:
// какой из них настоящий, знает только автор.
const names = (ids) => ids.map((id) => levelOf(id)?.name || id)
const dead = computed(() => (tick.value, ch.value ? names(deadEnds(ch.value)) : []))
const routingNeeded = computed(() => (tick.value, ch.value ? needsRouting(ch.value) : false))

async function pic() {
  const url = await pickImage().catch(() => null)
  if (url) { ch.value.image = url; lib.save(); tick.value++ }
}
</script>

<style scoped>
.screen { position: absolute; inset: 0; overflow: auto; display: flex; flex-direction: column; }
.bar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 18px clamp(16px, 4vw, 44px) 12px;
}
.bar h2 { flex: 1; margin: 0; font-family: var(--font-display); font-size: 26px; }
.counter { font-family: var(--font-mono); font-size: 13px; color: var(--moss); }
.hot {
  margin: 0 clamp(16px, 4vw, 44px) 14px; padding: 14px 16px;
  border: 1px solid var(--line); border-radius: 12px; background: var(--panel);
  display: flex; flex-wrap: wrap; gap: 8px;
}
.note { color: var(--muted); font-size: 12px; margin: 0 0 4px; width: 100%; }
.chip {
  font: inherit; font-size: 12px; padding: 5px 11px; border-radius: 999px;
  border: 1px solid var(--line); background: #101a20; color: var(--muted); cursor: pointer;
}
.chip.on { border-color: var(--goo); color: #ffd9a0; background: rgba(226, 112, 74, 0.14); }

.pick {
  margin: 0 clamp(16px, 4vw, 44px) 16px; padding: 16px 18px;
  border: 1px solid var(--line); border-radius: 14px; background: var(--panel);
}
.pick h3 { margin: 0 0 12px; font-family: var(--font-display); font-size: 20px; }
.pick .row { display: flex; gap: 10px; flex-wrap: wrap; }
.pick .btn i {
  display: block; font-style: normal; font-family: var(--font-mono);
  font-size: 10.5px; opacity: 0.75; margin-top: 3px;
}
.warn-pick { margin: 12px 0 0; font-size: 12px; color: #ffd9a0; }
.igt {
  font-family: var(--font-mono); font-size: 15px; color: var(--text);
  border: 1px solid var(--line); border-radius: 999px; padding: 5px 14px;
}
.igt i { display: block; font-style: normal; font-size: 9.5px; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--muted); }
.igt.sr { color: #ffd9a0; border-color: #8c5a2c; }
.map-wrap { position: relative; padding: 0 clamp(16px, 4vw, 44px) 24px; }
.map {
  position: relative; aspect-ratio: 16 / 9; width: 100%; max-height: 56vh; margin: 0 auto;
  border: 1px solid var(--line); border-radius: 16px; overflow: hidden;
  touch-action: none;
}
.paths { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.paths line {
  stroke: #e8c88f; stroke-width: 0.6; stroke-dasharray: 1.6 1.8; stroke-linecap: round;
  vector-effect: non-scaling-stroke; opacity: 0.85;
}
.paths line.dim { stroke: var(--muted); opacity: 0.4; }

.node {
  position: absolute; transform: translate(-50%, -50%);
  background: none; border: none; cursor: pointer; padding: 0;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
}
.dot {
  width: 26px; height: 26px; border-radius: 50%;
  background: var(--goo); border: 3px solid #2a1207;
  box-shadow: 0 0 0 4px rgba(226, 112, 74, 0.25), 0 4px 10px rgba(0, 0, 0, 0.5);
}
.node.done .dot { background: var(--moss); box-shadow: 0 0 0 4px rgba(143, 179, 106, 0.25); }
.node.locked { cursor: not-allowed; }
.node.locked .dot { background: #4a5761; box-shadow: none; opacity: 0.7; }
.node.sel .dot { outline: 2px solid #ffd9a0; outline-offset: 4px; }
.cap {
  font-size: 12px; color: var(--text); background: rgba(11, 16, 20, 0.78);
  padding: 2px 8px; border-radius: 999px; white-space: nowrap;
}
.node.locked .cap { color: var(--muted); }
.empty {
  position: absolute; inset: 0; display: grid; place-items: center;
  margin: 0; color: var(--muted); font-size: 14px;
}
.hint { font-family: var(--font-mono); font-size: 11.5px; color: var(--muted); margin: 10px 2px 0; }

.menu {
  position: absolute; z-index: 4; min-width: 180px;
  border: 1px solid var(--line); border-radius: 12px; overflow: hidden;
  background: rgba(16, 26, 32, 0.96); backdrop-filter: blur(6px);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45);
}
.menu-head {
  padding: 9px 12px; font-size: 13px; font-weight: 700;
  border-bottom: 1px solid var(--line);
}
.menu .item {
  display: block; width: 100%; text-align: left; background: none; border: none;
  color: var(--text); font: inherit; font-size: 13px; padding: 9px 12px; cursor: pointer;
}
.menu .item:hover { background: rgba(226, 112, 74, 0.16); color: #ffd9a0; }
.menu .item.danger:hover { background: rgba(140, 59, 44, 0.3); color: #ffb9a4; }
.menu-field {
  display: block; padding: 9px 12px; border-top: 1px solid var(--line);
  font-size: 12px; color: var(--muted);
}
.menu-field span { display: block; margin-bottom: 5px; }
.menu-field select {
  width: 100%; font: inherit; font-size: 12px; padding: 5px 7px;
  background: #101a20; color: var(--text); border: 1px solid var(--line); border-radius: 7px;
}
.alarm {
  margin: 10px 2px 0; padding: 9px 12px; border-radius: 10px;
  border: 1px solid #8c5a2c; background: rgba(140, 90, 44, 0.14); color: #ffd9a0;
  font-size: 12.5px; line-height: 1.45;
}
.note-dead { margin: 10px 2px 0; font-family: var(--font-mono); font-size: 11px; color: var(--muted); }
.node.exit .dot { border-color: #e8c88f; box-shadow: 0 0 0 4px rgba(232, 200, 143, 0.28); }
.arrow { margin-left: 6px; color: #e8c88f; font-size: 11px; }
.menu-note {
  padding: 8px 12px; border-top: 1px solid var(--line);
  font-family: var(--font-mono); font-size: 10.5px; color: var(--muted);
}
</style>
