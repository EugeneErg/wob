<template>
  <div class="screen">
    <header class="bar">
      <button class="btn small" @click="$emit('back')">Back</button>
      <h1>{{ story?.title || 'Story' }}</h1>
      <span class="spacer" />
      <span class="scale">{{ Math.round(view.zoom * 100) }}%</span>
      <button class="btn small" @click="fit">Fit</button>
      <button class="btn small accent" @click="opening = true">+ Chapter</button>
    </header>

    <div class="work">
    <!--
      Панель, из которой всё берётся.

      До неё на доску нельзя было положить ни точку: главы создавались кнопкой в
      шапке, а уровни — только внутри карты главы, куда ещё надо было попасть.
      То есть собрать историю целиком на одном экране было невозможно, хотя доска
      ровно для этого и делалась.

      Перетаскивание, а не «выбрать и нажать»: место на доске — часть решения, и
      спрашивать его отдельным шагом значит разбивать одно движение на два.
    -->
    <aside class="panel">
      <div class="panel-head">
        <span>Chapters</span>
        <button class="mini" title="New chapter" @click="opening = true">+</button>
      </div>
      <div
        class="tile"
        draggable="true"
        @dragstart="dragStart($event, { kind: 'chapter' })"
      >
        <span class="tile-mark">▭</span>
        <span class="tile-name">Drag onto the board</span>
      </div>

      <div class="panel-head">
        <span>Levels</span>
        <button class="mini" title="New level" @click="newLevel">+</button>
      </div>

      <p v-if="!levels.length" class="panel-note">None yet. Make one with +.</p>

      <ul class="tiles">
        <li v-for="l in levels" :key="l.id">
          <div
            class="tile"
            :class="{ spare: !placeCount(l) }"
            draggable="true"
            :title="placeCount(l) ? `On the board in ${placeCount(l)} place(s)` : 'Not on the board yet'"
            @dragstart="dragStart($event, { kind: 'level', id: l.id })"
            @dblclick="emit('edit', l.id)"
          >
            <span class="tile-mark">●</span>
            <span class="tile-name">{{ l.name }}</span>
            <!--
              Наполнение уровня открывается отсюда же. Раньше попасть в него
              можно было только через точку на карте главы — то есть уровень,
              ещё никуда не положенный, нельзя было и открыть.
            -->
            <button class="tile-edit" title="Open the level" @click.stop="emit('edit', l.id)">✎</button>
            <span class="tile-count">{{ placeCount(l) || '—' }}</span>
          </div>
        </li>
      </ul>
    </aside>

    <!--
      The board itself. One canvas for the whole story: chapters are areas on
      it, and the points inside a chapter keep their own coordinates as
      percentages of that chapter. Two spaces rather than one, which is what
      lets an area be dragged across the board without touching a single point.
    -->
    <div
      ref="board"
      class="board"
      :class="{ panning: pan !== null }"
      @pointerdown="startPan"
      @pointermove="onMove"
      @pointerup="endDrag"
      @pointercancel="endDrag"
      @wheel.prevent="onWheel"
      @dragover.prevent
      @drop.prevent="onDrop"
    >
      <div class="world" :style="worldStyle">
        <!--
          The story node. Everything begins somewhere concrete, and that
          somewhere is a point inside a chapter — so the node names the chapter
          holding it rather than being a chapter itself.
        -->
        <div
          class="origin"
          :class="{ armed: !!sel }"
          :style="originStyle"
          @pointerdown.stop
          @click.stop="startHere"
        >
          <span class="origin-cap">Story</span>
          <span class="origin-sub">{{ startLabel }}</span>
        </div>

        <svg class="wires" :style="wiresStyle">
          <path v-for="(w, i) in wires" :key="i" :d="w.d" :class="{ start: w.start }" />
        </svg>

        <div
          v-for="c in chapters"
          :key="c.id"
          class="area"
          :class="{ holdsStart: c.id === startChapterId, dragging: drag?.id === c.id, sel: sel === c.id }"
          :style="areaStyle(c)"
          @pointerdown.stop="onAreaDown($event, c)"
          @dblclick.stop="$emit('open', c.id)"
        >
          <div class="area-head">
            <span class="area-title">{{ c.title }}</span>
            <span class="area-count">{{ c.nodes.length }}</span>
          </div>

          <!-- The points, laid out inside their own area rather than the board. -->
          <div class="area-body" :style="mapStyle(c)">
            <span
              v-for="n in c.nodes"
              :key="n.id"
              class="pt"
              :class="{ ending: isEnding(n), start: n.id === story?.start }"
              :style="{ left: n.x + '%', top: n.y + '%' }"
              :title="lib.nodeName(n)"
            />
            <p v-if="!c.nodes.length" class="area-empty">Empty — open it to add levels</p>
          </div>

          <!--
            Resizing changes only the area. The points inside are percentages of
            it, so they spread with it rather than staying put and drifting out
            of the picture — which is the whole reason they were kept in the
            chapter's own space.
          -->
          <span class="grip" title="Drag to resize" @pointerdown.stop="startResize($event, c)">
            <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
              <path d="M9 1 L1 9 M9 5 L5 9" stroke="currentColor" stroke-width="1.4" fill="none" />
            </svg>
          </span>
        </div>
      </div>
    </div>

    </div>

    <p v-if="failed" class="bad">{{ failed }}</p>

    <p class="hint">
      Drag an area to move it, drag the board to pan, scroll to zoom, double-click an area to open
      its map, drag the corner to resize it. Click an area to select it, then
      shift-click another to link them — or click Story to begin there.
    </p>

    <CreateSheet
      v-if="dropping"
      heading="Place this level"
      name-label="Name on the map"
      placeholder="What the player sees here"
      :slots="nodeSlots"
      @close="dropping = null"
      @create="placeDropped"
    />
    <CreateSheet
      v-if="opening"
      heading="New chapter"
      placeholder="What happens here"
      :slots="chapterSlots"
      @close="opening = false"
      @create="create"
    />
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import * as lib from '../core/library.js'
import { coverStyle } from '../core/fileio.js'
import CreateSheet from '../components/CreateSheet.vue'
const CHAPTER_BOX = lib.CHAPTER_BOX
import { session } from '../core/session.js'
import { renameStory, saveChapterMap } from '../core/authoring.js'
import { makeChapter, makePoint, makeSpareLevel } from '../core/making.js'

const props = defineProps({ storyId: { type: String, required: true } })
const emit = defineEmits(['back', 'open', 'edit'])

const tick = ref(0)
const story = computed(() => (tick.value, lib.story(props.storyId)))
const chapters = computed(() => (tick.value, lib.chaptersOf(props.storyId)))

const box = (c) => c.canvas || { x: 0, y: 0, w: 420, h: 300 }
const isEnding = (n) => (n.next || []).length === 0

const startChapterId = computed(() =>
  chapters.value.find((c) => c.nodes.some((n) => n.id === story.value?.start))?.id || null)

const startLabel = computed(() => {
  const c = chapters.value.find((x) => x.id === startChapterId.value)
  if (!c) return 'nowhere yet'
  const n = c.nodes.find((x) => x.id === story.value?.start)
  return `${c.title} · ${n ? lib.nodeName(n) : '—'}`
})

// --- the board ---------------------------------------------------------------
// Panning and zooming are kept in one transform rather than scrolling a
// container: the wires between areas are drawn in board coordinates, and a
// scrolled container would leave them behind by a frame on every move.
const MIN = 80
const view = ref({ x: 60, y: 80, zoom: 0.7 })
const board = ref(null)
const pan = ref(null)
const drag = ref(null)

const worldStyle = computed(() => ({
  transform: `translate(${view.value.x}px, ${view.value.y}px) scale(${view.value.zoom})`,
}))

const areaStyle = (c) => {
  const b = box(c)
  return { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' }
}

const mapStyle = (c) => (c.map ? coverStyle(c.map) : {})

// The origin sits to the left of everything, at the height of the chapter that
// holds the start. It is not draggable: it is not a thing you arrange, it is
// where the arrangement is read from.
const originStyle = computed(() => {
  const holder = chapters.value.find((c) => c.id === startChapterId.value)
  const left = chapters.value.length ? Math.min(...chapters.value.map((c) => box(c).x)) : 0
  const top = holder ? box(holder).y + box(holder).h / 2 - 30 : 0
  return { left: left - 220 + 'px', top: top + 'px' }
})

const bounds = computed(() => {
  const boxes = chapters.value.map(box)
  if (!boxes.length) return { x: 0, y: 0, w: 1, h: 1 }
  const x = Math.min(...boxes.map((b) => b.x)) - 260
  const y = Math.min(...boxes.map((b) => b.y)) - 40
  return {
    x, y,
    w: Math.max(...boxes.map((b) => b.x + b.w)) - x + 40,
    h: Math.max(...boxes.map((b) => b.y + b.h)) - y + 40,
  }
})

const wiresStyle = computed(() => {
  const b = bounds.value
  return { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' }
})

// A wire is drawn between two AREAS, not between two points: at board zoom the
// individual points are specks, and what an author is reading here is which
// chapters lead into which. The detail belongs on the chapter map.
const wires = computed(() => {
  const b = bounds.value
  const out = []
  const holder = new Map()
  for (const c of chapters.value) for (const n of c.nodes) holder.set(n.id, c)

  const edge = (from, to, start = false) => {
    const a = box(from)
    const z = box(to)
    const x1 = a.x + a.w - b.x
    const y1 = a.y + a.h / 2 - b.y
    const x2 = z.x - b.x
    const y2 = z.y + z.h / 2 - b.y
    const mid = (x1 + x2) / 2
    out.push({ d: `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`, start })
  }

  // Провод от узла истории к главе, в которой она начинается: иначе доска
  // молчит о том, откуда читать, а это первое, что на ней ищут.
  const first = chapters.value.find((c) => c.id === startChapterId.value)
  if (first) {
    const z = box(first)
    const o = originStyle.value
    const x1 = parseFloat(o.left) + 180 - b.x
    const y1 = parseFloat(o.top) + 30 - b.y
    const x2 = z.x - b.x
    const y2 = z.y + z.h / 2 - b.y
    const mid = (x1 + x2) / 2
    out.push({ d: `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`, start: true })
  }

  const seen = new Set()
  for (const c of chapters.value) {
    for (const n of c.nodes) {
      for (const child of n.next || []) {
        const target = holder.get(child)
        if (!target || target.id === c.id) continue
        const key = c.id + '>' + target.id
        if (seen.has(key)) continue
        seen.add(key)
        edge(c, target)
      }
    }
  }
  return out
})

function toBoard(e) {
  const r = board.value.getBoundingClientRect()
  return {
    x: (e.clientX - r.left - view.value.x) / view.value.zoom,
    y: (e.clientY - r.top - view.value.y) / view.value.zoom,
  }
}

function startPan(e) {
  pan.value = { x: e.clientX - view.value.x, y: e.clientY - view.value.y }
  board.value.setPointerCapture?.(e.pointerId)
}

function startResize(e, c) {
  const at = toBoard(e)
  const b = box(c)
  drag.value = { id: c.id, resize: true, dx: at.x - (b.x + b.w), dy: at.y - (b.y + b.h), x: b.x, y: b.y }
  board.value.setPointerCapture?.(e.pointerId)
}

const sel = ref(null)

// Вход главы — точка, в которую внутри неё никто не ведёт. Связь между
// областями приходит именно в неё: соединяя главы на доске, автор говорит
// «после этой начинается та», а где та начинается, глава знает сама.
function entryOf(c) {
  const targeted = new Set(c.nodes.flatMap((n) => n.next || []))
  return (c.nodes.find((n) => !targeted.has(n.id)) || c.nodes[0])?.id || null
}

// Выходы главы — точки, из которых уже никуда не ведёт. Именно они продолжаются
// дальше: связывать надо концы, иначе новая дорога пошла бы из середины.
const endingsOf = (c) => c.nodes.filter((n) => !(n.next || []).length)

/**
 * Соединить две области.
 *
 * Повторный shift-клик по той же паре связь снимает — рисовать и стирать одним
 * жестом привычнее, чем искать отдельную кнопку удаления.
 */
function link(from, to) {
  const entry = entryOf(to)
  if (!entry || from.id === to.id) return

  const ends = endingsOf(from)
  const already = from.nodes.some((n) => (n.next || []).includes(entry))

  if (already) {
    for (const n of from.nodes) n.next = (n.next || []).filter((x) => x !== entry)
  } else if (ends.length) {
    for (const n of ends) n.next = [...(n.next || []), entry]
  } else {
    return
  }

  lib.save()
  persist(from.id)
  tick.value++
}

// Клик по узлу истории с выбранной областью: история начинается там.
function startHere() {
  const c = chapters.value.find((x) => x.id === sel.value)
  const entry = c && entryOf(c)
  if (!entry) return

  story.value.start = entry
  lib.save()
  if (session.status === 'signed-in') renameStory(story.value)
  sel.value = null
  tick.value++
}

function onAreaDown(e, c) {
  if (e.shiftKey) {
    if (sel.value && sel.value !== c.id) link(lib.chapter(sel.value), c)
    return
  }
  sel.value = sel.value === c.id ? null : c.id
  startDrag(e, c)
}

function startDrag(e, c) {
  const at = toBoard(e)
  const b = box(c)
  drag.value = { id: c.id, dx: at.x - b.x, dy: at.y - b.y }
  board.value.setPointerCapture?.(e.pointerId)
}

function onMove(e) {
  if (drag.value) {
    const at = toBoard(e)
    const d = drag.value
    if (d.resize) {
      // MIN is the server's floor too: an area smaller than this cannot hold a
      // point you could aim at, and one of zero size is impossible to grab back.
      lib.placeChapter(d.id, {
        w: Math.max(MIN, at.x - d.dx - d.x),
        h: Math.max(MIN, at.y - d.dy - d.y),
      })
    } else {
      lib.placeChapter(d.id, { x: at.x - d.dx, y: at.y - d.dy })
    }
    tick.value++
    return
  }
  if (pan.value) {
    view.value = { ...view.value, x: e.clientX - pan.value.x, y: e.clientY - pan.value.y }
  }
}

// Отправляем в конце жеста, а не на каждый кадр: пока автор тащит область,
// это одно движение, и класть в очередь по записи на кадр значило бы утопить
// её в промежуточных положениях, из которых ни одно не окончательное.
function endDrag() {
  const moved = drag.value
  drag.value = null
  pan.value = null
  if (moved) persist(moved.id)
}

function persist(chapterId) {
  if (session.status !== 'signed-in') return
  const c = lib.chapter(chapterId)
  if (c) saveChapterMap(props.storyId, c)
}

// Zoom towards the cursor: zooming to the centre of the screen means hunting
// for what you were looking at after every step.
function onWheel(e) {
  const at = toBoard(e)
  const zoom = Math.min(2, Math.max(0.2, view.value.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))
  const r = board.value.getBoundingClientRect()
  view.value = {
    zoom,
    x: e.clientX - r.left - at.x * zoom,
    y: e.clientY - r.top - at.y * zoom,
  }
}

function fit() {
  const b = bounds.value
  const r = board.value?.getBoundingClientRect()
  if (!r) return
  const zoom = Math.min(2, Math.max(0.2, Math.min(r.width / b.w, r.height / b.h) * 0.9))
  view.value = { zoom, x: (r.width - b.w * zoom) / 2 - b.x * zoom, y: (r.height - b.h * zoom) / 2 - b.y * zoom }
}

// --- панель и перетаскивание -------------------------------------------------
const levels = computed(() => (tick.value, lib.levelsOf(props.storyId)))
const placeCount = (l) => lib.placesOf(props.storyId, l.id).length

// Что тащим. Через dataTransfer, а не через переменную: браузер сам отменит
// перетаскивание, если увести курсор из окна, и переменная осталась бы висеть.
function dragStart(e, payload) {
  e.dataTransfer.effectAllowed = 'copy'
  e.dataTransfer.setData('text/plain', JSON.stringify(payload))
}

function areaAt(pt) {
  return chapters.value.find((c) => {
    const b = box(c)
    return pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h
  })
}

function onDrop(e) {
  let payload
  try { payload = JSON.parse(e.dataTransfer.getData('text/plain')) } catch { return }
  if (!payload) return

  const at = toBoard(e)

  if (payload.kind === 'chapter') {
    // Глава ложится центром под курсор — туда, куда целились.
    dropSpot.value = { x: at.x - CHAPTER_BOX.w / 2, y: at.y - CHAPTER_BOX.h / 2 }
    opening.value = true
    return
  }

  // Уровень попадает в ту главу, на которую его бросили, и встаёт там, куда
  // именно бросили: проценты считаются от области, а не от доски.
  const target = areaAt(at)
  if (!target) return

  const b = box(target)
  dropping.value = {
    chapterId: target.id,
    levelId: payload.id,
    at: {
      x: Math.max(2, Math.min(98, ((at.x - b.x) / b.w) * 100)),
      y: Math.max(4, Math.min(96, ((at.y - b.y) / b.h) * 100)),
    },
  }
}

// --- making a chapter --------------------------------------------------------
const opening = ref(false)

// A chapter has no film of its own: the story's plays once before anything, and
// each point's plays after its level. A third one here would be a wait in front
// of every map the player opens.
const chapterSlots = [
  { key: 'image', label: 'Cover', cta: 'Choose a picture', kind: 'image' },
  { key: 'map', label: 'Map backdrop', cta: 'Choose a picture', kind: 'image' },
]

const dropSpot = ref(null)
const failed = ref(null)

/**
 * Новый уровень: сразу в редактор наполнения.
 *
 * Ничего не спрашиваем. Название, картинка и ролик — свойства ТОЧКИ, то есть
 * места, где уровень встречается в истории; у самого уровня их нет. Спрашивать
 * их здесь значило бы спрашивать про место раньше, чем оно выбрано, — и
 * получать ответ, который придётся задать заново на каждом следующем появлении
 * того же уровня.
 *
 * Уровень получает рабочее имя вроде «Level 4» — оно нужно только автору, чтобы
 * различать плитки в панели.
 */
async function newLevel() {
  failed.value = null

  try {
    // Сервер называет уровень и сразу о нём знает: редактор начинает сохранять
    // с первой правки, и уровень, известный только браузеру, тут же получил бы
    // 404 по кругу.
    const l = await makeSpareLevel(props.storyId)
    tick.value++
    emit('edit', l.id)
  } catch (e) {
    failed.value = e.message
  }
}

// А вот при броске на карту место уже выбрано, и спросить есть о чём.
const dropping = ref(null)
const nodeSlots = [
  { key: 'image', label: 'Picture on the map', cta: 'Choose a picture', kind: 'image' },
  { key: 'outro', label: 'Film after the win', cta: 'Choose a video', kind: 'video' },
]

async function placeDropped({ title, ...extra }) {
  const d = dropping.value
  dropping.value = null
  if (!d) return
  failed.value = null

  try {
    const node = await makePoint(props.storyId, d.chapterId, d.levelId, d.at)
    if (!node) return

    // Имя, картинка и ролик — свойства точки, и уезжают обычным сохранением
    // карты: отдельного «назови точку» у сервера нет, карта пишется целиком.
    Object.assign(node, { name: title, ...extra })
    lib.save()
    persist(d.chapterId)
    tick.value++
  } catch (e) {
    failed.value = e.message
  }
}

async function create({ title, ...extra }) {
  opening.value = false
  failed.value = null

  let c
  try {
    // Имя выдаёт сервер, поэтому сначала он.
    c = await makeChapter(props.storyId, title, extra)
  } catch (e) {
    failed.value = e.message

    return
  }

  // Брошена на доску — значит место уже выбрано, и раскладывать её справа от
  // остальных не надо.
  if (dropSpot.value) {
    lib.placeChapter(c.id, dropSpot.value)
    dropSpot.value = null
  }

  tick.value++

  // Расположение на доске — часть главы, поэтому вторым письмом уходит карта.
  saveChapterMap(props.storyId, c)
}
</script>

<style scoped>
.screen { position: absolute; inset: 0; display: flex; flex-direction: column; }

.bar {
  display: flex; align-items: center; gap: 10px;
  padding: 12px clamp(12px, 3vw, 28px); border-bottom: 1px solid var(--line);
}
.bar h1 { margin: 0; font-size: 17px; font-weight: 600; }
.spacer { flex: 1; }
.scale { font-family: var(--font-mono); font-size: 11px; color: var(--muted); }

.work { flex: 1; display: flex; min-height: 0; }

.panel {
  width: 220px; flex: none; display: flex; flex-direction: column; gap: 6px;
  padding: 12px; border-right: 1px solid var(--line); overflow: auto;
}
.panel-head {
  display: flex; align-items: center; gap: 8px; margin-top: 6px;
  font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted);
}
.panel-head span { flex: 1; }
.mini {
  width: 22px; height: 22px; border-radius: 6px; border: 1px solid var(--line);
  background: none; color: var(--text); cursor: pointer; font: inherit; line-height: 1;
}
.panel-note { margin: 0; font-size: 12px; color: var(--muted); }
.tiles { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }

.tile {
  display: flex; align-items: center; gap: 8px; padding: 7px 9px;
  border: 1px solid var(--line); border-radius: 8px; background: var(--panel);
  font-size: 13px; cursor: grab;
}
.tile:active { cursor: grabbing; }
/* Уровень, которого ещё нет ни на одной карте: его некуда играть, пока не
   положишь. Пунктир говорит это, не занимая места подписью. */
.tile.spare { border-style: dashed; }
.tile-mark { color: var(--muted); font-size: 11px; }
.tile-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tile-count { font-family: var(--font-mono); font-size: 10px; color: var(--muted); }
.tile-edit {
  background: none; border: 0; color: var(--muted); cursor: pointer;
  font: inherit; font-size: 12px; padding: 0 2px;
}
.tile-edit:hover { color: var(--text); }

.board { flex: 1; position: relative; overflow: hidden; cursor: grab; touch-action: none; }
.board.panning { cursor: grabbing; }
.world { position: absolute; transform-origin: 0 0; }

.wires { position: absolute; overflow: visible; pointer-events: none; }
.wires path { fill: none; stroke: var(--line); stroke-width: 2; }
.wires path.start { stroke: #e8c88f; }

.origin {
  position: absolute; width: 180px; height: 60px; border-radius: 12px;
  border: 1px dashed var(--line); display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 2px; color: var(--muted);
}
.origin-cap { font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; }
.origin-sub { font-family: var(--font-mono); font-size: 10px; }

.area {
  position: absolute; border: 1px solid var(--line); border-radius: 14px;
  background: var(--panel); overflow: hidden; cursor: grab; display: flex; flex-direction: column;
}
.area.dragging { cursor: grabbing; border-color: var(--accent); }

/*
  Захват для размера. Был двумя линиями по 16 пикселей — формально существовал,
  а на деле его не находили и считали, что размер главы фиксирован. Теперь это
  видимый уголок с обычным для ресайза значком.
*/
.grip {
  position: absolute; right: 2px; bottom: 2px; width: 20px; height: 20px;
  display: flex; align-items: center; justify-content: center;
  cursor: nwse-resize; color: var(--muted);
  background: var(--panel); border: 1px solid var(--line); border-radius: 6px;
}
.grip:hover { color: var(--text); border-color: var(--accent); }
.area.holdsStart { border-color: #e8c88f; }
.area.sel { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(122, 162, 247, 0.25); }

/* Узел истории оживает, только когда есть что к нему привязать: кликабельным
   без выбранной области он обещал бы действие, которого нет. */
.origin.armed { border-style: solid; border-color: var(--accent); cursor: pointer; }

.area-head {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-bottom: 1px solid var(--line);
}
.area-title { font-size: 14px; font-weight: 600; }
.area-count { margin-left: auto; font-family: var(--font-mono); font-size: 11px; color: var(--muted); }

.area-body { position: relative; flex: 1; background-size: cover; background-position: center; }
.area-empty {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  margin: 0; font-size: 12px; color: var(--muted);
}

.pt {
  position: absolute; width: 10px; height: 10px; margin: -5px 0 0 -5px;
  border-radius: 50%; background: var(--text); opacity: 0.8;
}
/* An ending is ringed, not recoloured: colour already says whether a point is
   the start, and a second meaning on the same axis would not read. */
.pt.ending { box-shadow: 0 0 0 2px var(--panel), 0 0 0 4px #d98a6a; }
.pt.start { background: #e8c88f; }

.bad {
  margin: 0; padding: 8px clamp(12px, 3vw, 28px); font-size: 12px; color: #d98a6a;
}

.hint {
  margin: 0; padding: 8px clamp(12px, 3vw, 28px); border-top: 1px solid var(--line);
  font-size: 12px; color: var(--muted);
}

</style>
