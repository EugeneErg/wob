<template>
  <div class="screen">
    <header class="bar">
      <button class="btn ghost small" @click="$emit('back')">← Chapters</button>
      <h2>{{ ch?.title }}</h2>
      <template v-if="mode === 'edit'">
        <button class="btn small" @click="hotOpen = !hotOpen">Pinned assets</button>
        <button class="btn small" @click="pic">Image</button>
        <button class="btn small" @click="picking = 'place'">Place a level</button>
        <button class="btn small primary" @click="opening = true">New level</button>
      </template>
      <template v-else>
        <span class="counter">{{ passed }} / {{ nodes.length }}</span>
        <!-- The attempt clock. It only runs inside levels: the map produces no
             ticks, so choosing a branch and thinking cost nothing. -->
        <span v-if="run" class="igt" :class="{ sr: speedrun }">
          {{ igt }}<i>{{ inStory ? 'whole story' : speedrun ? 'speedrun' : 'playthrough' }}</i>
        </span>
        <!--
          Выбор версии и прогоны истории переехали сюда из списка глав вместе с
          ним. Релиз заморожен, и играть можно как последний опубликованный, так
          и черновик автора — но выбор должен быть там, где игрок находится.
        -->
        <label v-if="releases.length" class="ver">
          <select :value="releaseId || ''" @change="$emit('version', $event.target.value || null)">
            <option v-for="r in releases" :key="r.id" :value="r.id">Version {{ r.version }}</option>
            <option value="">Author's draft</option>
          </select>
        </label>
        <!--
          Как проходить эту главу. Выбор жил на карточке в списке глав; список
          ушёл, и вместе с ним чуть не ушёл сам спидран главы — из истории он
          запускается на выборе истории, из уровня на выборе уровня, а из главы
          было неоткуда.

          Спрашивается один раз: пока попытка не начата и пока режим не выбран
          выше. Внутри идущего спидрана выбирать нечего, и повторный вопрос
          заставлял бы игрока отвечать на уже отвеченное.
        -->
        <template v-if="!run && !speedrun">
          <button class="btn small primary" @click="$emit('start', false)">Play through</button>
          <button class="btn small sr" @click="$emit('start', true)">Speedrun</button>
        </template>
        <button class="btn small" @click="$emit('runs', { kind: 'chapter', targetId: chapterId })">
          Chapter runs
        </button>
        <button v-if="storyId" class="btn small" @click="$emit('runs', { kind: 'story', targetId: storyId })">
          Story runs
        </button>
      </template>
    </header>

    <section v-if="hotOpen && mode === 'edit'" class="hot">
      <p class="note">Pinned assets rise to the top of the editor list in every level of this chapter.</p>
      <button
        v-for="a in allAssets" :key="a.id"
        class="chip" :class="{ on: isHot(a.id) }"
        @click="toggleHot(a.id)"
      >{{ a.title }}</button>
    </section>

    <!-- Choosing the mode. What sets a speedrun apart is that only what this
         attempt has opened is open: no starting from the middle on an old save,
         and no rewinding inside a level either. -->
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
          v-for="n in nodes" :key="n.id"
          class="node"
          :class="{ done: isDone(n.levelId), locked: isLocked(n), sel: sel === n.id,
                    ending: isEnding(n), exit: leavesChapter(n), start: isStart(n) }"
          :style="{ left: n.x + '%', top: n.y + '%' }"
          @pointerdown.stop="onDown(n, $event)"
          @dblclick.stop="mode === 'edit' && $emit('edit', n.levelId)"
        >
          <span class="dot" />
          <span class="cap">{{ capOf(n) }}<span v-if="isEnding(n)" class="fin">финал</span></span>
        </button>

        <!--
          Двери в соседние главы.
          
          Раньше выход в другую главу выбирался из списка в меню узла — теперь
          это обычная связь, второй конец которой лежит на чужой карте. Нарисовать
          её здесь нельзя, а уйти по ней игрок должен, поэтому она показывается
          дверью рядом с точкой, из которой ведёт.

          Их может быть несколько: развилка, уводящая в две главы, — ровно то,
          ради чего связи стали списком. Какую взять, решает игрок, а не правило
          выбора активной главы.
        -->
        <button
          v-for="d in doors" :key="d.key"
          class="door" :class="{ locked: !d.open }"
          :style="{ left: d.x + '%', top: d.y + '%' }"
          :title="d.open ? `To ${d.title}` : `${d.title} — finish ${capOf(d.from)} first`"
          @pointerdown.stop
          @click.stop="d.open && $emit('chapter', d.chapterId)"
        >
          <span class="door-arrow">→</span>
          <span class="door-cap">{{ d.title }}</span>
        </button>

        <!-- the menu next to the node itself -->
        <div
          v-if="mode === 'edit' && selectedNode"
          class="menu"
          :style="menuStyle"
          @pointerdown.stop @click.stop
        >
          <div class="menu-head">{{ selected?.name }}</div>
          <button class="item" @click="$emit('edit', selectedNode.levelId)">Edit</button>
          <!--
            Начало истории назначается здесь, у самой точки. На доске это тоже
            можно — выделить главу и нажать узел «Story», — но там начало
            выбирается главой, а начинается история всё-таки с точки, и связать
            одно с другим на глаз было нельзя.
          -->
          <button v-if="!isStart(selectedNode)" class="item" @click="startHere">
            Start the story here
          </button>
          <span v-else class="menu-note">The story starts here</span>

          <button class="item" @click="picking = 'swap'">Show another level</button>
          <button class="item" @click="copy">Duplicate</button>

          <!--
            Две разные вещи, которые раньше были одной.

            Пока уровень стоял ровно в одном месте, «убрать точку» и «удалить
            уровень» совпадали. Теперь нет: сняв одно из появлений уровня,
            удалять сам уровень нельзя — он показан и в других местах. Если это
            было последнее появление, уровень уходит вместе с ним: до него всё
            равно не добраться.
          -->
          <button class="item" @click="unpin">Remove from this map</button>
          <button class="item danger" @click="drop">Delete the level everywhere</button>

          <!-- No "leads on to a chapter" here any more. A point links to
               points, and a link may cross into another chapter, so it is drawn
               on the map like every other link rather than picked from a list.
               A point with no links out is an ending, marked as one. -->
          <div class="menu-note">
            {{ selectedNode && (selectedNode.next || []).length
              ? 'Shift-click another point to draw or erase a link'
              : 'An ending. Shift-click another point to lead on from here' }}
          </div>
        </div>

        <!-- While playing, a node has a menu too, but only one entry: your own
             runs on this level. Clicking the node still starts it. -->
        <div
          v-if="mode === 'play' && selectedNode"
          class="menu"
          :style="menuStyle"
          @pointerdown.stop @click.stop
        >
          <div class="menu-head">{{ selected?.name }}</div>
          <!-- The mode is chosen here too. With a speedrun already running
               above, there is no choice: the level is part of that attempt and
               there is nothing to decide for it. -->
          <template v-if="speedrun">
            <button class="item" @click="startLevel(selectedNode.levelId, false)">Continue the run</button>
          </template>
          <template v-else>
            <button class="item" @click="startLevel(selectedNode.levelId, false)">Play through</button>
            <button class="item sr" @click="startLevel(selectedNode.levelId, true)">Speedrun this level</button>
          </template>
          <button class="item" @click="$emit('runs', { kind: 'level', targetId: selectedNode.levelId })">My runs</button>
        </div>

        <p v-if="!nodes.length" class="empty">
          {{ mode === 'edit' ? 'Empty so far — add the first level.' : 'This chapter has no levels yet.' }}
        </p>
      </div>

      <p v-if="mode === 'edit' && endings.length" class="note-dead">
        Endings ({{ endings.join(', ') }}). A point that links nowhere finishes the story, and
        reaching any of them counts as completing it — so a branch you have not linked up yet
        counts too. Link the ones that were meant to continue.
      </p>

      <p v-if="failed" class="bad">{{ failed }}</p>
      <p class="hint">{{ hint }}</p>
    </div>
  </div>

  <!--
    Список уровней истории. До сих пор его негде было увидеть: уровень
    существовал только через точку, которая его показывает, а поставить один
    уровень во второе место было нельзя вовсе — то самое, ради чего у точек
    появились собственные имена.
  -->
  <div v-if="picking" class="sheet" @click.self="picking = null">
    <div class="form">
      <h2>{{ picking === 'swap' ? 'Show another level' : 'Place a level' }}</h2>

      <ul class="picks">
        <li v-for="l in storyLevels" :key="l.id">
          <button class="pick-row" @click="chooseLevel(l)">
            <span class="pick-name">{{ l.name }}</span>
            <span class="pick-where">{{ placesLabel(l) }}</span>
          </button>
        </li>
      </ul>

      <p v-if="!storyLevels.length" class="menu-note">No levels in this story yet.</p>

      <div class="row">
        <button class="btn small" @click="picking = null">Cancel</button>
      </div>
    </div>
  </div>

  <CreateSheet
    v-if="opening"
    heading="New level"
    name-label="Name"
    placeholder="What is this one about"
    :slots="levelSlots"
    @close="opening = false"
    @create="addLevel"
  />
</template>

<script setup>
import { ref, computed } from 'vue'
import * as lib from '../core/library.js'
import { deleteLevel, renameStory, saveChapterMap } from '../core/authoring.js'
import { makeLevel, makePoint } from '../core/making.js'
import { saveLevel as pushLevel } from '../core/authoring.js'
import { session } from '../core/session.js'
import CreateSheet from '../components/CreateSheet.vue'
import { coverStyle } from '../core/fileio.js'
import { pickMedia } from '../core/media.js'
import { endingNodes, openNodes } from '../core/chain.js'
import { formatTime } from '../core/replays.js'

const props = defineProps({
  mode: { type: String, default: 'play' },
  chapterId: String,
  // The chapter attempt in progress (ChainRun). Without one, the mode is asked first
  run: { type: Object, default: null },
  speedrun: { type: Boolean, default: false },
  // where the speedrun began: null | 'story' | 'chapter' | 'level'
  srScope: { type: String, default: null },
  // The chapter was opened inside a story playthrough
  inStory: { type: Boolean, default: false },
  // Which versions this story has, and which is being played. Empty when the
  // story was never published — there is nothing to choose between.
  releases: { type: Array, default: () => [] },
  releaseId: { type: String, default: null },
  storyId: { type: String, default: null },
  // The release, when one is being played: level names and the chapter's
  // contents come from it
  release: { type: Object, default: null },
})
const emit = defineEmits(['back', 'play', 'edit', 'start', 'runs', 'chapter', 'version'])

// ref wraps the chapter in a reactive proxy: edits to nodes show up at once and
// are written into the same library object that gets saved later.
//
// This used to be a computed, which returned the same object every time — Vue
// concluded nothing had changed and the map did not redraw until a reload.
const fromRelease = (id) => props.release?.chapters.find((c) => c.id === id) || null
const levelOf = (id) => props.release?.levels.find((l) => l.id === id) || lib.level(id)
const ch = ref(fromRelease(props.chapterId) || lib.chapter(props.chapterId))

// Историю глава знает сама. Раньше здесь стояло storyId.value, которого в этом
// файле никогда не было: createLevel() с активным аккаунтом падал на
// ReferenceError, а SSR-проверка этого не ловила, потому что рисует, но не
// нажимает.
const storyId = computed(() => (tick.value, props.storyId || ch.value?.storyId))
const tick = ref(0)
// tick is for the places where the library edits the object directly, past the
// proxy: a new array on every change, or Vue sees no difference
const nodes = computed(() => (tick.value, [...(ch.value?.nodes || [])]))
const map = ref(null)
const sel = ref(null)
const hotOpen = ref(false)
let drag = null

const allAssets = computed(() => lib.assets())
const isHot = (id) => lib.isHot('chapter', props.chapterId, id)
const toggleHot = (id) => { lib.toggleHot('chapter', props.chapterId, id); tick.value++ }

// What counts as finished. In a speedrun, only what was finished in THIS
// attempt: past achievements open no doors, or the chapter could be started
// from the middle. In ordinary play, the overall progress as before.
//
// Within a story attempt only the visits belonging to this chapter count: the
// attempt holds segments from every chapter at once.
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

const name = (id) => levelOf(id)?.name || '?'

// Подпись под точкой — её собственное имя. Уровень остаётся запасным вариантом:
// у старых данных имени на точке нет, а у автора оно рабочее, для панели.
const capOf = (n) => n.name || name(n.levelId)
const startLevel = (id, speedrun = false) => { sel.value = null; emit('play', id, speedrun) }
const passed = computed(() => nodes.value.filter((n) => isDone(n.levelId)).length)

// Финал — точка, из которой не ведёт ни одной связи. Их у истории много, и
// автору важно видеть их сразу: неотмеченная ветка, которую он просто забыл
// дорисовать, выглядит на карте точно так же, как задуманный конец, и в зачёт
// идёт наравне с ним.
const isEnding = (n) => (n.next || []).length === 0
const leavesChapter = (n) => (n.next || []).some((c) => !nodes.value.some((m) => m.id === c))

// Двери наружу. В редакторе не показываются: там историю видно целиком на
// доске, и дверь была бы третьим изображением одной и той же связи.
// --- список уровней истории --------------------------------------------------
const picking = ref(null)   // null | 'place' | 'swap'
const failed = ref(null)

const storyLevels = computed(() => (tick.value, storyId.value ? lib.levelsOf(storyId.value) : []))

// Где ещё показан этот уровень. Важно видеть до того, как ставишь его второй
// раз: иначе легко принять «поставить ещё раз» за «сделать копию».
function placesLabel(l) {
  const places = lib.placesOf(storyId.value, l.id)
  return places.length > 1 ? `in ${places.length} places` : ''
}

async function chooseLevel(l) {
  if (picking.value === 'swap' && sel.value) {
    lib.setNodeLevel(props.chapterId, sel.value, l.id)
  } else {
    const node = await makePoint(storyId.value, props.chapterId, l.id)
    if (node) sel.value = node.id
  }
  picking.value = null
  pushMap()
  tick.value++
}

const isStart = (n) => !!n && lib.story(storyId.value)?.start === n.id

function startHere() {
  const st = lib.story(storyId.value)
  if (!st || !sel.value) return

  st.start = sel.value
  lib.save()
  if (session.status === 'signed-in') renameStory(st)
  sel.value = null
  tick.value++
}

function unpin() {
  if (!sel.value) return
  lib.unpinNode(props.chapterId, sel.value)
  sel.value = null
  pushMap()
  tick.value++
}

const doors = computed(() => {
  if (props.mode === 'edit') return []
  tick.value

  const mine = new Set(nodes.value.map((n) => n.id))
  const siblings = lib.chaptersOf(storyId.value).filter((c) => c.id !== props.chapterId)
  const out = []

  for (const n of nodes.value) {
    for (const child of n.next || []) {
      if (mine.has(child)) continue
      const target = siblings.find((c) => c.nodes.some((m) => m.id === child))
      if (!target) continue

      out.push({
        key: n.id + '>' + child,
        chapterId: target.id,
        title: target.title,
        from: n,
        // Дверь открывается тем же, чем открывалась бы следующая точка: пройденной
        // точкой, из которой она ведёт.
        open: isDone(n.levelId),
        x: Math.min(97, n.x + 6),
        y: Math.max(3, n.y - 7),
      })
    }
  }
  return out
})
const selectedNode = computed(() => nodes.value.find((n) => n.id === sel.value) || null)

// sel — имя точки; уровень берётся у неё. Раньше это было одно и то же, потому
// что точка звалась именем своего уровня; теперь нет, и путать их значит,
// например, открыть в редакторе не тот уровень.
const selected = computed(() => (selectedNode.value ? levelOf(selectedNode.value.levelId) : null))
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

const pos = (nodeId) => nodes.value.find((n) => n.id === nodeId) || { x: 50, y: 50 }
// A path is visible once the level it leads from is finished. Within a running
// attempt this is judged by that attempt's own progress: a speedrun writes no
// overall progress at all, so going by that made every path invisible and the
// map looked like a scatter of unconnected dots.
const visible = (e) => (doneSet.value ? doneSet.value.has(e.from) : lib.linkVisible(ch.value, e.from))
const shownEdges = computed(() =>
  // Рёбер больше нет: линии рисуются по связям точек. Связь, уходящая в другую
  // главу, здесь не рисуется — её второй конец лежит не на этой карте.
  (ch.value?.nodes || []).flatMap((n) => (n.next || [])
    .filter((c) => (ch.value?.nodes || []).some((m) => m.id === c))
    .map((c) => ({ from: n.id, to: c })))
    .filter((e) => props.mode === 'edit' || visible(e)))
// Which nodes are open. The same rule either way, but judged by the progress of
// the attempt in progress rather than by the overall save.
const openSet = computed(() =>
  (tick.value, doneSet.value && ch.value ? new Set(openNodes(ch.value, doneSet.value)) : null))
const isLocked = (n) => {
  if (props.mode !== 'play') return false
  if (openSet.value) return !openSet.value.has(n.id)
  return !lib.nodeOpen(ch.value, n.id)
}

const hint = computed(() => {
  if (props.mode === 'play') return 'Open levels glow brighter. Click to play, press and hold for the menu with recorded runs.'
  return 'Click a node for its menu, double-click to open it, drag to move it, shift-click a second node to draw a path.'
})

// Clicks on a node are worked out by hand: the map captures the pointer in
// order to drag, and the click event goes with it — it never reaches the
// button.
function onDown(n, e) {
  drag = { n, moved: 0, shift: e.shiftKey, at: Date.now(), long: false }
  // Press and hold is the same as a right click, but works with a finger.
  if (props.mode === 'play') {
    const d = drag
    setTimeout(() => { if (drag === d) d.long = true }, 450)
  }
  if (props.mode === 'edit') map.value.setPointerCapture?.(e.pointerId)
}

/**
 * Отправить карту главы на сервер.
 *
 * Вызывалась из пяти мест и не была объявлена ни в одном: перетаскивание точки,
 * рисование связи и дублирование уровня падали с ReferenceError у автора с
 * аккаунтом. saveChapterMap при этом был импортирован и не использован — то
 * есть функцию переименовали и не дописали.
 *
 * SSR-проверка этого не видела: она рисует экран, но ничего не нажимает.
 */
function pushMap() {
  if (session.status !== 'signed-in') return
  if (storyId.value && ch.value) saveChapterMap(storyId.value, ch.value)
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
  const click = d.moved < 3          // barely moved, so treat it as a click

  if (d.empty) { if (click) sel.value = null; return }
  if (props.mode !== 'edit') {
    if (!click) return
    if (isLocked(d.n)) return
    // Inside a running speedrun the mode was chosen above, so start straight
    // away in one tap. Otherwise open the menu: play through or speedrun this
    // level, plus the recordings.
    if (props.speedrun) { emit('play', d.n.levelId, false); return }
    // sel — имя ТОЧКИ, а не уровня: один уровень может стоять в нескольких
    // местах, и выделять его целиком значило бы выделять сразу все.
    sel.value = sel.value === d.n.id ? null : d.n.id
    return
  }
  if (!click) { lib.save(); pushMap(); return }
  if (d.shift && sel.value && sel.value !== d.n.id) link(sel.value, d.n.id)
  else sel.value = d.n.id
}

function link(a, b) {
  // Связь направленная: shift-клик по второй точке ведёт от выбранной к ней.
  const from = ch.value.nodes.find((n) => n.id === a)
  if (!from) return
  from.next = from.next || []
  const i = from.next.indexOf(b)
  if (i >= 0) from.next.splice(i, 1)
  else from.next.push(b)
  lib.save(); pushMap(); tick.value++
}

// Картинка стоит на точке карты, а ролик играет после победы — оба спрашиваются
// здесь, а не ищутся потом в настройках уровня.
const opening = ref(false)
const levelSlots = [
  { key: 'image', label: 'Picture on the map', cta: 'Choose a picture', kind: 'image' },
  { key: 'outro', label: 'Film after the win', cta: 'Choose a video', kind: 'video' },
]

async function addLevel({ title, ...extra }) {
  opening.value = false
  failed.value = null

  let l
  try {
    // Сервер называет уровень и сразу о нём знает, поэтому потерянная вкладка
    // максимум стоит пустого уровня.
    l = await makeLevel(storyId.value, props.chapterId, title)
  } catch (e) {
    failed.value = e.message

    return
  }

  // Картинка и ролик принадлежат точке; карта уедет обычным сохранением.
  const node = (ch.value.nodes || []).find((n) => n.levelId === l.id)
  if (node && (extra.image || extra.outro)) {
    Object.assign(node, extra)
    lib.save()
    pushMap()
  }

  tick.value++
  emit('edit', l.id)
}
/**
 * Дубликат уровня.
 *
 * Имя копии выдаёт сервер, как и всякое другое, поэтому сначала заводится
 * пустой уровень, а потом в него переливается содержимое исходного. Копия
 * содержательна с первой секунды, так что запись содержимого уходит сразу же:
 * одной записи о точке на карте не хватило бы, чтобы её восстановить.
 */
async function copy() {
  const src = selectedNode.value && levelOf(selectedNode.value.levelId)
  if (!src) return

  const at = selectedNode.value
  const made = await makeLevel(storyId.value, props.chapterId, `${src.name} — copy`, {
    x: Math.min(92, (at?.x ?? 20) + 8),
    y: Math.min(90, (at?.y ?? 20) + 8),
  })

  const target = lib.level(made.id)
  if (target) {
    Object.assign(target, {
      width: src.width,
      height: src.height,
      gravity: structuredClone(src.gravity),
      goal: src.goal,
      entities: structuredClone(src.entities || []),
      hot: [...(src.hot || [])],
    })
    lib.save()
    pushLevel(storyId.value, target)
  }

  sel.value = null
  tick.value++
}
function drop() {
  const l = selected.value
  if (!l || !confirm(`Delete "${l.name}" everywhere it appears?`)) return

  lib.removeLevel(props.chapterId, l.id)

  // Удаление до сих пор не доезжало до сервера: deleteLevel был импортирован и
  // не вызван, так что уровень исчезал в браузере и возвращался с ближайшей
  // загрузкой библиотеки из аккаунта.
  if (session.status === 'signed-in' && storyId.value) {
    deleteLevel(storyId.value, props.chapterId, l.id)
  }

  sel.value = null
  tick.value++
}

// Endings: points that link nowhere. The graph cannot tell a finish the author
// meant from a branch they have not drawn yet — both simply have no outgoing
// link — so the editor names them all and lets the author look.
const names = (ids) => ids.map((id) => {
  const n = (ch.value?.nodes || []).find((m) => m.id === id)
  return (n && capOf(n)) || id
})
const endings = computed(() => (tick.value, ch.value ? names(endingNodes(ch.value)) : []))

async function pic() {
  const url = await pickMedia().catch((e) => { alert(e.message); return null })
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
.item.sr { color: #ffd9a0; }
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
.bad { margin: 10px 2px 0; font-size: 12px; color: #d98a6a; }
.note-dead { margin: 10px 2px 0; font-family: var(--font-mono); font-size: 11px; color: var(--muted); }
.node.exit .dot { border-color: #e8c88f; box-shadow: 0 0 0 4px rgba(232, 200, 143, 0.28); }

/*
  Финальная точка. Двойное кольцо, а не другой цвет: цветом уже сказано, пройден
  уровень или заперт, и третий смысл на ту же ось не влезает. Кольцо читается
  поверх любого из состояний.
*/
.sheet {
  position: absolute; inset: 0; background: rgba(0, 0, 0, 0.45); z-index: 10;
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.form {
  width: min(420px, 100%); background: var(--panel); border: 1px solid var(--line);
  border-radius: 14px; padding: 18px; display: flex; flex-direction: column; gap: 12px;
}
.form h2 { margin: 0; font-size: 16px; }
.picks { list-style: none; margin: 0; padding: 0; max-height: 50vh; overflow: auto; }
.pick-row {
  display: flex; width: 100%; align-items: center; gap: 10px; background: none;
  border: 1px solid transparent; border-radius: 8px; padding: 8px 10px;
  color: var(--text); font: inherit; font-size: 13px; cursor: pointer; text-align: left;
}
.pick-row:hover { border-color: var(--line); background: var(--bg); }
.pick-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pick-where { font-family: var(--font-mono); font-size: 11px; color: var(--muted); }
.row { display: flex; gap: 8px; justify-content: flex-end; }

.ver select {
  background: var(--bg); border: 1px solid var(--line); border-radius: 8px;
  padding: 5px 8px; color: var(--text); font: inherit; font-size: 12px;
}

.door {
  position: absolute; transform: translate(-50%, -50%); display: flex; align-items: center; gap: 5px;
  background: var(--panel); border: 1px solid #e8c88f; border-radius: 999px;
  padding: 3px 9px 3px 7px; color: var(--text); cursor: pointer; font: inherit; font-size: 11px;
}
.door.locked { border-color: var(--line); color: var(--muted); cursor: default; opacity: 0.6; }
.door-arrow { color: #e8c88f; }
.door.locked .door-arrow { color: var(--muted); }
.door-cap { max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Начало истории. Тем же цветом, что узел истории на доске, чтобы связь между
   двумя экранами читалась без подписи. */
.node.start .dot { border-color: #e8c88f; box-shadow: 0 0 0 3px rgba(232, 200, 143, 0.3); }

.node.ending .dot { box-shadow: 0 0 0 3px var(--bg), 0 0 0 6px #d98a6a; }
.fin {
  margin-left: 6px; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
  color: #d98a6a;
}
.arrow { margin-left: 6px; color: #e8c88f; font-size: 11px; }
.menu-note {
  padding: 8px 12px; border-top: 1px solid var(--line);
  font-family: var(--font-mono); font-size: 10.5px; color: var(--muted);
}
</style>
