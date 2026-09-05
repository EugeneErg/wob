<template>
  <div class="screen">
    <header class="bar">
      <button class="btn small" @click="$emit('back')">Back</button>
      <h1>{{ story?.title || 'Story' }}</h1>
      <span class="spacer" />
      <span class="scale">{{ Math.round(view.zoom * 100) }}%</span>
      <button class="btn small" @click="fit">Fit</button>
      <button class="btn small accent" @click="opening = true">+ Chapter</button>
      <!--
        Выпуск стоит здесь, потому что здесь автор и оказывается, когда история
        собрана: доска — единственный экран, с которого видно её целиком.

        Кнопки не было вовсе. Она жила на экране списка глав, который выпал из
        сборки и остался в репозитории мёртвым файлом, так что выпустить историю
        было нельзя ничем.
      -->
      <!--
        Состояние выпуска. Функция drifted() существовала и звалась только из
        тестов: автор нигде не видел, есть ли у него невыпущенные правки, а это
        первое, что нужно знать перед кнопкой «Release».
      -->
      <span v-if="lastRelease" class="relstate" :class="{ ahead: unreleased }">
        v{{ lastRelease.number }}{{ unreleased ? ' · есть правки' : ' · всё выпущено' }}
      </span>
      <button class="btn small" :disabled="releasing" @click="doRelease">
        {{ releasing ? 'Releasing…' : 'Release' }}
      </button>
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
        @pointerdown="grab($event, { kind: 'chapter' })"
      >
        <span class="tile-mark">▭</span>
        <span class="tile-name">Drag onto the board</span>
      </div>

      <div class="panel-head">
        <span>Levels</span>
        <button class="mini" title="New level" @click="naming = true">+</button>
      </div>

      <p v-if="!levels.length" class="panel-note">None yet. Make one with +.</p>

      <ul class="tiles">
        <li v-for="l in levels" :key="l.id">
          <div
            class="tile"
            :class="{ spare: !placeCount(l) }"
            :title="placeCount(l) ? `On the board in ${placeCount(l)} place(s)` : 'Not on the board yet'"
            @pointerdown="grab($event, { kind: 'level', id: l.id })"
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
    >
      <div class="world" :style="worldStyle">
        <!--
          The story node. Everything begins somewhere concrete, and that
          somewhere is a point inside a chapter — so the node names the chapter
          holding it rather than being a chapter itself.
        -->
        <div
          class="origin"
          :class="{ armed: !!selPoint }"
          :style="originStyle"
          :title="selPoint ? 'Click to start the story at the selected point' : 'Select a point, then click here'"
          @pointerdown.stop
          @click.stop="startHere"
        >
          <span class="origin-cap">Story</span>
          <span class="origin-sub">{{ selPoint ? 'connect the selected point' : startLabel }}</span>
        </div>

        <svg class="wires" :style="wiresStyle">
          <defs>
            <marker
              id="wire-arrow" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse"
            >
              <path d="M0 0 L10 5 L0 10 z" fill="#e8c88f" />
            </marker>
          </defs>
          <!--
            Две линии на связь: видимая тонкая и широкая невидимая под ней.
            По тонкой в четыре пикселя попасть курсором нельзя, а удалять связь
            надо чем-то — значит нужна полоса, за которую её можно взять.
          -->
          <path
            v-for="(w, i) in wires" :key="i" :d="w.d"
            :class="{ start: w.start }"
            :marker-end="w.arrow || w.start ? 'url(#wire-arrow)' : undefined"
          />
          <path
            v-for="(w, i) in wires" :key="'hit' + i" :d="w.d"
            class="hit"
            :class="{ cut: w.from }"
            @click="w.from && joinPoints(w.from, w.to)"
          >
            <title v-if="w.from">Нажмите, чтобы убрать связь</title>
          </path>
          <line
            v-if="wire"
            marker-end="url(#wire-arrow)"
            class="ghostwire"
            :x1="wire.from.x - bounds.x" :y1="wire.from.y - bounds.y"
            :x2="wire.to.x - bounds.x" :y2="wire.to.y - bounds.y"
          />
        </svg>

        <div
          v-for="c in chapters"
          :key="c.id"
          class="area"
          :class="{
            holdsStart: c.id === startChapterId,
            dragging: drag?.id === c.id,
            sel: sel === c.id,
            droppable: carrying === 'level',
          }"
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
            <!--
              Точка, а не глава. Начало истории — это место, где игрок окажется,
              и выбирать его главой значило выбирать наугад: какая точка внутри
              станет входом, решала функция entryOf(), а автор об этом только
              догадывался.

              Связывается тем же жестом, что и точки между собой: выделить одну,
              нажать на второй конец. Второй конец здесь — узел «Story».
            -->
            <!--
              Точка и стрелка связи рядом, в одной обёртке.

              Стрелка показывается при наведении на точку, а не только у
              выбранной: чтобы связать две точки, не нужно сперва догадаться, что
              точку надо выбрать. Она же говорит направление — связь
              направленная, и без стрелки «A ведёт к B» и «B ведёт к A»
              выглядят одинаково.
            -->
            <span
              v-for="n in c.nodes"
              :key="n.id"
              class="pt-wrap"
              :class="{ held: selPoint === n.id }"
              :style="{ left: n.x + '%', top: n.y + '%' }"
            >
              <button
                class="pt"
                :class="{ ending: isEnding(n), start: n.id === story?.start, sel: selPoint === n.id }"
                :data-point="n.id"
                :title="pointTitle(n)"
                @pointerdown.stop="grabPoint($event, c, n)"
              />
              <button
                class="arrow"
                title="Потяните к другой точке — куда тянете, туда и ведёт связь"
                @pointerdown.stop="startWire($event, c, n)"
              >➜</button>
            </span>
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

    <!-- Что именно в руке. Без этого перенос указателем невидим: курсор
         движется, а на экране ничего не меняется. -->
    <div v-if="ghost" class="ghost" :style="ghostStyle">
      {{ ghost.kind === 'chapter' ? 'New chapter' : 'Level' }}
    </div>

    <!--
      Что можно сделать с выбранной точкой. Убрать точку с доски было нельзя
      вовсе: меню жило только на карте главы, а на доске точка выбиралась и
      дальше с ней ничего не происходило.
    -->
    <!--
      Что можно сделать с выбранной главой. Переименовать и сменить фон можно
      было только войдя внутрь неё, а удалить — вообще нигде: глава, созданная
      по ошибке, оставалась на доске навсегда.
    -->
    <div v-if="sel && !selPoint" class="ptmenu">
      <span class="ptmenu-name">{{ chapterOf(sel)?.title }}</span>
      <button class="btn small" @click="editing = chapterOf(sel)">Название и фон</button>
      <button class="btn small danger" @click="removeChapter">Удалить главу</button>
      <button class="btn small" @click="sel = null">Отмена</button>
    </div>

    <div v-if="selPoint" class="ptmenu">
      <span class="ptmenu-name">{{ pointName(selPoint) }}</span>
      <button class="btn small" @click="removePoint">Убрать с карты</button>
      <button class="btn small" @click="selPoint = null">Отмена</button>
    </div>

    <p v-if="failed" class="bad">{{ failed }}</p>
    <p v-if="released" class="good">{{ released }}</p>

    <p class="hint">
      Drag an area to move it, drag the board to pan, scroll to zoom, double-click an area to open
      its map, drag the corner to resize it. Click an area to select it, then
      shift-click another to link them. Наведите на точку — появится стрелка;
      потяните её к другой точке, чтобы связать. Выберите точку и нажмите Story,
      чтобы история начиналась там.
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
      v-if="editing"
      heading="Эта глава"
      name-label="Название главы"
      placeholder="Что здесь происходит"
      :slots="chapterSlots"
      :initial="{ title: editing.title || '', image: editing.image || '', map: editing.map || '' }"
      cta="Сохранить"
      @close="editing = null"
      @create="applyChapter"
    />
    <CreateSheet
      v-if="naming"
      heading="New level"
      name-label="Name"
      placeholder="What happens in it"
      :slots="levelSlots"
      @close="naming = false"
      @create="newLevel"
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
import { computed, nextTick, onMounted, ref } from 'vue'
import * as lib from '../core/library.js'
import { coverStyle } from '../core/fileio.js'
import CreateSheet from '../components/CreateSheet.vue'
const CHAPTER_BOX = lib.CHAPTER_BOX
import { session } from '../core/session.js'
import {
  deleteChapter, describeChapter, linkNodes, moveNode, renameStory, saveChapterMap, unlinkNodes,
} from '../core/authoring.js'
import { makeChapter, makePoint, makeSpareLevel, releaseStory, storyReleases } from '../core/making.js'
import { drifted } from '../core/releases.js'

const props = defineProps({ storyId: { type: String, required: true } })
const emit = defineEmits(['back', 'open', 'edit'])

const tick = ref(0)
const story = computed(() => (tick.value, lib.story(props.storyId)))
const chapters = computed(() => (tick.value, lib.chaptersOf(props.storyId)))

const box = (c) => c.canvas || { x: 0, y: 0, w: 420, h: 300 }
const isEnding = (n) => (n.next || []).length === 0

const startChapterId = computed(() =>
  chapters.value.find((c) => c.nodes.some((n) => n.id === story.value?.start))?.id || null)

// Выбранная точка. Отдельно от sel, который держит главу: глава по-прежнему
// выделяется и связывается с другой главой, а начало истории теперь про точку.
const selPoint = ref(null)

/*
 * Начать историю можно с любой точки, включая ту, в которую что-то ведёт.
 *
 * Сначала здесь стояло «только с бесхозной», и это была лишняя строгость:
 * вернуться туда, где уже был, — обычный приём повествования, а не поломка.
 * Ломает историю не второй вход в точку, а кольцо, и кольцо ловится там, где
 * оно возникает, — на проведении связи.
 */
const pointTitle = (n) => lib.nodeName(n)

/*
 * Связать или разъединить две точки прямо на доске.
 *
 * Правила те же, что на карте главы, и проверяются тем же кодом: кольцо и
 * возврат в покинутую главу запрещены, повторный жест снимает связь. Разводить
 * их по двум экранам значило бы завести два ответа на один вопрос.
 */
async function joinPoints(a, b) {
  const from = chapters.value.flatMap((c) => c.nodes).find((n) => n.id === a)
  if (!from) return

  from.next = from.next || []
  const i = from.next.indexOf(b)

  if (i >= 0) {
    from.next.splice(i, 1)
    lib.save()
    selPoint.value = null
    failed.value = null
    tick.value++
    await settle(() => unlinkNodes(props.storyId, a, b), () => from.next.push(b))

    return
  }

  if (lib.wouldCycle(a, b)) {
    failed.value = 'Так история замкнётся в кольцо: отсюда уже есть дорога обратно.'

    return
  }

  if (lib.wouldRevisitChapter(a, b)) {
    failed.value = 'Так путь вернётся в главу, из которой уже вышел.'

    return
  }

  from.next.push(b)
  lib.save()
  selPoint.value = null
  failed.value = null
  tick.value++

  await settle(() => linkNodes(props.storyId, a, b), () => {
    const at = from.next.indexOf(b)
    if (at >= 0) from.next.splice(at, 1)
  })
}

/** Отправить связь и, если сервер её не принял, вернуть экран к правде. */
async function settle(send, undo) {
  if (session.status !== 'signed-in') return

  try {
    await send()
  } catch (e) {
    undo()
    lib.save()
    failed.value = e.message
    tick.value++
  }
}

/*
 * Тянем связь от выбранной точки к другой.
 *
 * Тот же смысл, что у shift-клика, но жест видно, пока его делаешь. Куда
 * отпустили — та точка и вторая; ищем по экрану, а не по координатам, потому
 * что попасть курсором в кружок надёжнее, чем в его математический центр.
 */
const wire = ref(null)


function startWire(e, c, n) {
  const b = bodyBox(c)
  const from = { x: b.x + (b.w * n.x) / 100, y: b.y + (b.h * n.y) / 100 }
  wire.value = { from, to: from }

  const move = (m) => (wire.value = { from, to: toBoard(m) })

  const up = (u) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    wire.value = null

    const id = document.elementFromPoint(u.clientX, u.clientY)?.closest?.('.pt')?.dataset?.point

    if (id && id !== n.id) joinPoints(n.id, id)
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

const editing = ref(null)

const chapterOf = (id) => chapters.value.find((c) => c.id === id) || null

function applyChapter({ title, ...extra }) {
  const c = editing.value
  editing.value = null
  if (!c) return

  c.title = title
  c.image = extra.image || ''
  // Фон карты — та самая картинка, на которой стоят точки, — отдельная от
  // обложки: обложку видно на доске, фон видно, когда игрок выбирает уровень.
  c.map = extra.map || ''
  lib.save()
  if (session.status === 'signed-in') describeChapter(props.storyId, c)
  tick.value++
}

/*
 * Удалить главу.
 *
 * Вместе с ней уходят её точки, а уровни остаются: уровень может стоять и в
 * других главах, и удалять его заодно значило бы стирать чужую работу за
 * компанию. Спрашиваем подтверждение — восстановить нечем.
 */
async function removeChapter() {
  const c = chapterOf(sel.value)
  if (!c) return
  if (!confirm(`Удалить главу «${c.title}»? Её точки исчезнут, уровни останутся.`)) return

  sel.value = null
  failed.value = null

  try {
    if (session.status === 'signed-in') await deleteChapter(props.storyId, c.id)
    lib.removeChapter(c.id)
    lib.save()
    tick.value++
  } catch (e) {
    failed.value = e.message
  }
}

const pointName = (id) => {
  const n = chapters.value.flatMap((c) => c.nodes).find((m) => m.id === id)

  return n ? lib.nodeName(n) : ''
}

/*
 * Убрать точку с карты.
 *
 * Уровень при этом остаётся: он может стоять и в других местах, а точка — лишь
 * одно из них. Совсем удалить уровень можно на карте главы, где видно, сколько
 * у него мест.
 */
function removePoint() {
  const id = selPoint.value
  const c = chapters.value.find((x) => x.nodes.some((n) => n.id === id))
  if (!c) return

  lib.unpinNode(c.id, id)
  selPoint.value = null
  lib.save()
  if (session.status === 'signed-in') saveChapterMap(props.storyId, c)
  tick.value++
}

function pickPoint(n) {
  sel.value = null
  selPoint.value = selPoint.value === n.id ? null : n.id
}

/*
 * Точка на доске двигается сама, а не вместе с главой.
 *
 * Сначала у точки стоял перехват нажатия, и глава не тащилась за то место, где
 * точка стоит. Я убрал перехват — и получилось обратное: нажатие на точку стало
 * тащить главу, а сама точка не двигалась вовсе. Верно ни то ни другое: точка —
 * самостоятельная вещь, у неё своё место внутри главы, и брать её надо за неё.
 *
 * Проценты считаются от области, а не от доски: точка живёт в своей главе, и
 * при переезде или изменении размера главы должна оставаться там же, где стояла.
 */
function grabPoint(e, c, n) {
  // Связать две точки — тем же жестом, что и на карте главы: выбрать одну,
  // нажать на вторую с shift. Способа сделать это на доске не было вовсе:
  // точка выбиралась, но соединить её можно было только с узлом «Story».
  if (e.shiftKey && selPoint.value && selPoint.value !== n.id) {
    joinPoints(selPoint.value, n.id)

    return
  }

  const b = bodyBox(c)
  let moved = 0
  const from = { x: e.clientX, y: e.clientY }

  const move = (m) => {
    moved = Math.max(moved, Math.abs(m.clientX - from.x) + Math.abs(m.clientY - from.y))
    if (moved < 4) return

    const at = toBoard(m)
    n.x = Math.max(2, Math.min(98, ((at.x - b.x) / b.w) * 100))
    n.y = Math.max(4, Math.min(96, ((at.y - b.y) / b.h) * 100))
    tick.value++
  }

  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)

    // Почти не сдвинулись — значит это был выбор точки, а не переезд.
    if (moved < 4) {
      pickPoint(n)

      return
    }

    lib.save()
    if (session.status === 'signed-in') moveNode(props.storyId, c.id, n)
    tick.value++
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

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

/*
 * Где на доске лежит тело главы — то есть место, по которому расставлены точки.
 *
 * Точки позиционируются в процентах от .area-body, а она начинается под шапкой
 * с названием. Провод к точке и перетаскивание точки считали проценты от всей
 * области, вместе с шапкой, и потому промахивались ровно на её высоту. Внизу
 * главы ошибка обращалась в ноль, наверху была наибольшей — оттого и выглядело,
 * будто связь «уезжает куда-то вверх» только у верхних точек.
 *
 * Высота шапки задана числом и здесь, и в стилях: держать её на усмотрение
 * шрифта значит вернуть ту же ошибку, только плавающую.
 */
const AREA_HEAD = 34

function bodyBox(c) {
  const b = box(c)

  return { x: b.x, y: b.y + AREA_HEAD, w: b.w, h: Math.max(1, b.h - AREA_HEAD) }
}

const pointAt = (c, n) => {
  const b = bodyBox(c)

  return { x: b.x + (b.w * n.x) / 100, y: b.y + (b.h * n.y) / 100 }
}

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

/*
 * Связи чертятся от точки к точке, со стрелкой на конце.
 *
 * Раньше здесь была связь между главами, а внутри одной главы не рисовалось
 * вообще ничего. Из-за этого соединение двух точек выглядело как несработавшее:
 * автор тянул, отпускал, связь ложилась в данные — и на экране не менялось
 * ровно ничего. Хуже поломки, потому что похоже на поломку.
 *
 * Стрелка нужна не для красоты: связь направленная, и без неё «A ведёт к B» и
 * «B ведёт к A» выглядят одинаково.
 */
const wires = computed(() => {
  const b = bounds.value
  const out = []
  const holder = new Map()
  for (const c of chapters.value) for (const n of c.nodes) holder.set(n.id, c)

  /*
   * Провод от узла истории — к самой точке, а не к её главе.
   *
   * Раньше он приходил в левый край главы, и это читалось как «история
   * начинается с главы»: какая именно точка внутри — доска не говорила. Выбор
   * точки я к тому времени уже сделал, а провод остался прежним, и глазами всё
   * выглядело по-старому.
   */
  const from = chapters.value.find((c) => c.id === startChapterId.value)
  const startNode = from?.nodes.find((n) => n.id === story.value?.start)
  if (from && startNode) {
    const p = pointAt(from, startNode)
    const o = originStyle.value
    const x1 = parseFloat(o.left) + 180 - b.x
    const y1 = parseFloat(o.top) + 30 - b.y
    const x2 = p.x - b.x
    const y2 = p.y - b.y
    const mid = (x1 + x2) / 2
    out.push({ d: `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`, start: true })
  }

  for (const c of chapters.value) {
    for (const n of c.nodes) {
      for (const child of n.next || []) {
        const target = holder.get(child)
        if (!target) continue

        const to = target.nodes.find((m) => m.id === child)
        if (!to) continue

        const p1 = pointAt(c, n)
        const p2 = pointAt(target, to)
        const x1 = p1.x - b.x
        const y1 = p1.y - b.y
        const x2 = p2.x - b.x
        const y2 = p2.y - b.y
        const mid = (x1 + x2) / 2

        // from/to запоминаются вместе с линией: по ней же связь и снимают.
        out.push({
          d: `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`,
          arrow: true,
          from: n.id,
          to: child,
        })
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
    // Связь глав — это связи их точек, поэтому кольцо ловится тем же вопросом,
    // что и на карте главы. Отказываем целиком: провести половину концов и
    // бросить остальные значит оставить главу связанной наполовину, а это
    // хуже, чем несвязанной.
    if (ends.some((n) => lib.wouldCycle(n.id, entry))) {
      failed.value = `«${to.title}» уже ведёт обратно в «${from.title}» — так история замкнётся в кольцо.`

      return
    }

    if (ends.some((n) => lib.wouldRevisitChapter(n.id, entry))) {
      failed.value = `Из «${to.title}» путь уже возвращается назад: в одну главу дважды за путь не заходят.`

      return
    }

    for (const n of ends) n.next = [...(n.next || []), entry]
  } else {
    return
  }

  failed.value = null

  lib.save()
  persist(from.id)
  tick.value++
}

/*
 * Нажатие на узел истории с выбранной точкой: история начинается там.
 *
 * Повторное нажатие на уже назначенную точку связь снимает — ровно как
 * повторный shift-клик между точками. Историю без начала сервер принимает: она
 * ещё не дописана, а не сломана.
 */
function startHere() {
  const id = selPoint.value
  if (!id || !story.value) return

  story.value.start = story.value.start === id ? null : id
  lib.save()
  if (session.status === 'signed-in') renameStory(story.value)
  selPoint.value = null
  tick.value++
}

function onAreaDown(e, c) {
  if (e.shiftKey) {
    if (sel.value && sel.value !== c.id) link(lib.chapter(sel.value), c)
    return
  }
  selPoint.value = null
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

/*
 * Показать доску целиком при открытии.
 *
 * Раньше вид открывался с одних и тех же чисел, не зависящих от содержимого, и
 * узел «Story» уезжал за левый край: он стоит левее самой левой главы, а место
 * под него в границах доски учтено — просто на эти границы никто не смотрел.
 * Кнопка «Fit» это чинила, но нажимать её при каждом открытии автору не за что.
 */
onMounted(async () => {
  await nextTick()
  fit()
  loadReleases()
})

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

/*
 * Перенос плитки на доску — на pointer-событиях, а не на HTML5 drag-and-drop.
 *
 * Здесь стоял родной браузерный перенос, и он не начинался вовсе: ни в главу,
 * ни мимо. Разбирать, что именно ему мешало — захват указателя, touch-action на
 * доске, перерисовка Vue в момент dragstart, — можно долго, и проверить нечем:
 * jsdom HTML5-переноса не реализует, так что тест на него ничего не доказывает.
 * Мой и не доказывал: он слал dragstart руками и обходил ровно тот вопрос,
 * который надо было задать.
 *
 * Всё остальное на этом экране уже тащится указателем — точки, области, уголок
 * ресайза. Плитка была единственным исключением, и единственным, что не
 * работало. Теперь она такая же, как соседи, и её можно проверить нажатием.
 */
// Что тащим. Через dataTransfer, а не через переменную: браузер сам отменит
// перетаскивание, если увести курсор из окна, и переменная осталась бы висеть.
function grab(e, payload) {
  if (e.button !== 0) return

  const from = { x: e.clientX, y: e.clientY }
  let moved = 0

  const move = (m) => {
    moved = Math.max(moved, Math.abs(m.clientX - from.x) + Math.abs(m.clientY - from.y))

    // Пока не сдвинулись на несколько пикселей, это ещё не перенос, а нажатие:
    // иначе двойной щелчок по плитке не открыл бы уровень.
    if (moved < 4) return

    // Пока уровень в руке, главы подсвечены: иначе непонятно, что бросать надо
    // именно в них, и первый же промах выглядит как сломанный перенос.
    carrying.value = payload.kind
    ghost.value = { x: m.clientX, y: m.clientY, kind: payload.kind }
  }

  const up = (u) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)

    const wasCarrying = carrying.value
    carrying.value = null
    ghost.value = null

    if (!wasCarrying) return

    drop(payload, u)
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

const ghost = ref(null)
const ghostStyle = computed(() => (ghost.value
  ? { left: ghost.value.x + 12 + 'px', top: ghost.value.y + 12 + 'px' }
  : {}))

function areaAt(pt) {
  return chapters.value.find((c) => {
    const b = box(c)
    return pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h
  })
}

function drop(payload, e) {
  // Отпустили не над доской — просто ничего не произошло, и это понятно без
  // объяснений: плитка вернулась на место.
  const r = board.value?.getBoundingClientRect()
  if (!r) return
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return

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

  // Мимо главы — и раньше здесь просто ничего не происходило. Молчание в ответ
  // на осмысленное действие читается как поломка: автор тащил, отпустил, и
  // экран не шевельнулся. Уровень живёт на карте главы, значит и класть его
  // надо в главу, и сказать об этом надо словами.
  if (!target) {
    failed.value = chapters.value.length
      ? 'Уровень кладётся внутрь главы — бросьте его на область главы, а не на пустую доску.'
      : 'Сначала нужна глава: перетащите на доску «+ Chapter», а уровень — уже в неё.'

    return
  }

  failed.value = null

  // В тело главы, а не в область целиком: точки живут под шапкой, и считать
  // проценты вместе с ней значит класть уровень выше того места, куда целились.
  const b = bodyBox(target)
  carrying.value = null
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
const carrying = ref(null)
const failed = ref(null)
const releasing = ref(false)
const lastRelease = ref(null)

/*
 * Разошёлся ли черновик с последним выпуском.
 *
 * Хеш выпуска называет сервер — он же его и считает при публикации, — а хеш
 * черновика считается здесь по тому же правилу. Сравнивать с местным снимком
 * было бы неверно: на чужой машине снимка нет, и черновик всегда выглядел бы
 * невыпущенным.
 */
const unreleased = computed(() => {
  void tick.value

  return lastRelease.value ? drifted(props.storyId, lastRelease.value.hash) : false
})

async function loadReleases() {
  if (session.status !== 'signed-in') return

  try {
    const { releases } = await storyReleases(props.storyId)
    lastRelease.value = [...(releases || [])].sort((a, b) => b.number - a.number)[0] || null
  } catch {
    // Не знать номер выпуска — не повод не пускать автора на доску.
  }
}
const released = ref(null)

/*
 * Выпустить историю.
 *
 * Сервер отказывает по делу — «нечего выпускать», «с прошлого раза ничего не
 * изменилось», — и эти отказы автору надо читать дословно, а не в виде «что-то
 * пошло не так»: они говорят, что делать дальше.
 */
async function doRelease() {
  releasing.value = true
  failed.value = null
  released.value = null

  try {
    const rel = await releaseStory(props.storyId)

    // Выпуск не открывает историю остальным, и молчать об этом нельзя: автор
    // нажал кнопку и вправе думать, что дело сделано.
    lastRelease.value = { number: rel.number, hash: rel.hash }
    released.value = `Версия ${rel.number} выпущена. Пройдите в ней каждый уровень — тогда её увидят другие.`
  } catch (e) {
    failed.value = e.message
  } finally {
    releasing.value = false
  }
}

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
/*
 * «+» у уровней сначала спрашивает.
 *
 * Раньше нажатие сразу било в сервер, и уровень получал имя, которое сервер
 * придумывал сам, — отсюда вереница «Level 1». Спросить потом не предлагалось
 * нигде, так что имя оставалось таким навсегда.
 *
 * Рядом, в броске уровня на карту, всё это время лежал правильный образец: он
 * спрашивает имя и картинку и только затем создаёт. Кнопка просто шла мимо него.
 */
const naming = ref(false)
const levelSlots = [
  { key: 'image', label: 'Picture on the map', cta: 'Choose a picture', kind: 'image' },
]

async function newLevel({ title, ...extra }) {
  naming.value = false
  failed.value = null

  try {
    // Сервер называет уровень и сразу о нём знает: редактор начинает сохранять
    // с первой правки, и уровень, известный только браузеру, тут же получил бы
    // 404 по кругу.
    const l = await makeSpareLevel(props.storyId, title, extra)
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

.wires {
  position: absolute; overflow: visible; pointer-events: none;
  /* Сам слой кликов не принимает; их принимают только широкие полосы под
     линиями связей, иначе он накрыл бы собой всю доску. */
  /* Поверх областей, а не под ними.
     В разметке svg идёт раньше глав, поэтому области его закрывали: связь до
     точки внутри главы уходила под непрозрачный прямоугольник и просто
     пропадала — автор соединил, а на экране ничего. Кликам это не мешает:
     pointer-events здесь выключены. */
  z-index: 3;
}
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
.ptmenu {
  position: absolute; left: 50%; transform: translateX(-50%); bottom: 54px; z-index: 20;
  display: flex; align-items: center; gap: 8px;
  padding: 7px 12px; border-radius: 999px; font-size: 12.5px;
  background: rgba(11, 16, 20, 0.95); border: 1px solid var(--line);
}
.ptmenu-name { color: #e8c88f; }
.relstate { font-size: 11.5px; color: var(--muted); }
.relstate.ahead { color: #e8c88f; }
.ghost {
  position: fixed; z-index: 50; pointer-events: none;
  padding: 5px 10px; border-radius: 8px; font-size: 12px;
  background: rgba(11, 16, 20, 0.95); border: 1px solid rgba(232, 200, 143, 0.7); color: #e8c88f;
}
.handle {
  position: absolute; width: 16px; height: 16px; margin: -26px 0 0 -8px;
  border-radius: 50%; background: #e8c88f; border: 2px solid #2a1207;
  cursor: crosshair; padding: 0; z-index: 6;
  box-shadow: 0 0 0 4px rgba(232, 200, 143, 0.3);
}
.wires .hit { stroke: transparent; stroke-width: 14; fill: none; pointer-events: none; }
.wires .hit.cut { pointer-events: stroke; cursor: pointer; }
.wires .hit.cut:hover { stroke: rgba(224, 115, 107, 0.35); }
.wires line.ghostwire { stroke: #e8c88f; stroke-width: 2; stroke-dasharray: 6 6; }
.area.droppable {
  outline: 2px dashed rgba(232, 200, 143, 0.7); outline-offset: 3px;
}
.area.sel { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(122, 162, 247, 0.25); }

/* Узел истории оживает, только когда есть что к нему привязать: кликабельным
   без выбранной области он обещал бы действие, которого нет. */
.origin.armed { border-style: solid; border-color: var(--accent); cursor: pointer; }

.area-head {
  /* Высота закреплена: по ней считается место точек внутри главы (AREA_HEAD).
     Отдай её на усмотрение шрифта — и провод снова начнёт промахиваться. */
  height: 34px; flex: none;
  display: flex; align-items: center; gap: 8px;
  padding: 0 12px; border-bottom: 1px solid var(--line);
}
.area-title { font-size: 14px; font-weight: 600; }
.area-count { margin-left: auto; font-family: var(--font-mono); font-size: 11px; color: var(--muted); }

.area-body { position: relative; flex: 1; background-size: cover; background-position: center; }
.area-empty {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  margin: 0; font-size: 12px; color: var(--muted);
}

.pt-wrap { position: absolute; }
/* Стрелка появляется при наведении на точку и держится, пока точка выбрана. */
.pt-wrap .arrow { opacity: 0; transition: opacity 0.12s; }
.pt-wrap:hover .arrow, .pt-wrap.held .arrow { opacity: 1; }
.arrow {
  position: absolute; left: 8px; top: -9px;
  width: 18px; height: 18px; padding: 0; border-radius: 50%;
  background: rgba(11, 16, 20, 0.9); border: 1px solid #e8c88f; color: #e8c88f;
  font-size: 11px; line-height: 1; cursor: crosshair; z-index: 6;
}
.arrow:hover { background: #e8c88f; color: #2a1207; }

.pt {
  position: absolute; width: 10px; height: 10px; margin: -5px 0 0 -5px;
  border-radius: 50%; background: var(--text); opacity: 0.8;
  padding: 0; border: 0; font: inherit; cursor: pointer;
}
.pt:hover { opacity: 1; box-shadow: 0 0 0 3px rgba(232, 200, 143, 0.25); }
.pt.sel { background: #e8c88f; box-shadow: 0 0 0 3px rgba(232, 200, 143, 0.45); opacity: 1; }
/* An ending is ringed, not recoloured: colour already says whether a point is
   the start, and a second meaning on the same axis would not read. */
.pt.ending { box-shadow: 0 0 0 2px var(--panel), 0 0 0 4px #d98a6a; }
.pt.start { background: #e8c88f; }

.good { margin: 0 16px 8px; font-size: 12.5px; color: #8fd6a8; }
.bad {
  margin: 0; padding: 8px clamp(12px, 3vw, 28px); font-size: 12px; color: #d98a6a;
}

.hint {
  margin: 0; padding: 8px clamp(12px, 3vw, 28px); border-top: 1px solid var(--line);
  font-size: 12px; color: var(--muted);
}

</style>
