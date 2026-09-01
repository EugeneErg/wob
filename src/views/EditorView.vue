<template>
  <div class="editor">
    <!-- the entity rail: buttons come from the registry -->
    <aside class="rail">
      <template v-if="hot.length">
        <div class="rail-cap">Pinned</div>
        <button
          v-for="a in hot" :key="a.id"
          class="tool hot" :class="{ on: creating?.asset === a }"
          :title="a.title" @click="startAsset(a)"
        >
          <span class="ico" v-html="iconOf(a.type)" />
          <span class="lbl">{{ a.title }}</span>
        </button>
      </template>

      <div class="rail-cap">Entities</div>
      <button
        v-for="def in defs"
        :key="def.type"
        class="tool"
        :class="{ on: creating?.def === def && !creating?.asset }"
        :title="def.title"
        @click="toggleCreate(def)"
      >
        <span class="ico" v-html="def.icon" />
        <span class="lbl">{{ def.title }}</span>
      </button>

      <div class="rail-cap spread">
        Assets
        <select v-model="scope" class="scope" title="What the pin applies to">
          <option value="level">level</option>
          <option value="chapter">chapter</option>
          <option value="story">story</option>
        </select>
      </div>
      <div v-for="a in allAssets" :key="a.id" class="asset">
        <button class="tool" :class="{ on: creating?.asset === a }" @click="startAsset(a)">
          <span class="ico" v-html="iconOf(a.type)" />
          <span class="lbl">{{ a.title }}</span>
        </button>
        <button class="star" :class="{ on: isHot(a) }" :title="'Pinned to the ' + scope" @click="toggleHot(a)">★</button>
        <button class="star drop" title="Delete asset" @click="dropAsset(a)">×</button>
      </div>
    </aside>

    <main class="main">
      <header class="bar">
        <button class="btn ghost small" @click="leave">← Levels</button>
        <input v-model="level.name" class="name" spellcheck="false" />
        <label class="field inline">Goal <input v-model.number="level.goal" type="number" min="1" class="mini" /></label>
        <label class="field inline" title="The uniform part of the field. Zero is weightlessness, unless the level has attractors of its own">
          Gravity
          <input v-model.number="level.gravity.x" type="number" step="100" class="mini" />
          <input v-model.number="level.gravity.y" type="number" step="100" class="mini" />
        </label>
        <label class="field inline">Size
          <input v-model.number="level.width" type="number" step="100" class="mini" />
          <input v-model.number="level.height" type="number" step="100" class="mini" />
        </label>
        <button class="btn small" @click="save">Save</button>

        <!--
          What the queue is doing. An author who believes their work is safe
          when it is not finds out at the worst possible moment, so the two
          states worth naming are named.
        -->
        <span v-if="queueState.status === 'offline'" class="save-state warn">
          Not saved yet — retrying
        </span>
        <span v-else-if="queueState.status === 'conflict'" class="save-state warn">
          Changed elsewhere — reload
        </span>
        <span v-else-if="queueState.pending" class="save-state">Saving…</span>
        <button class="btn small primary" @click="play">Test</button>
      </header>

      <div class="canvas-wrap">
        <svg
          ref="svg"
          class="canvas"
          :viewBox="viewBox"
          preserveAspectRatio="xMidYMid meet"
          @pointerdown="onDown"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointerleave="onUp"
          @dblclick="onDbl"
          @wheel.prevent="onWheel"
          @contextmenu.prevent
        >
          <defs>
            <pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse">
              <path d="M80 0H0V80" fill="none" stroke="#1e2b33" stroke-width="1.5" />
            </pattern>
          </defs>
          <rect :x="-4000" :y="-4000" width="12000" height="12000" fill="#101a20" />
          <rect x="0" y="0" :width="level.width" :height="level.height" fill="url(#grid)" stroke="#2c3d47" stroke-width="3" />

          <SvgScene :shapes="sceneShapes" />

          <!-- what is attached to what -->
          <g>
            <line
              v-for="l in parentLines" :key="l.id"
              :x1="l.x1" :y1="l.y1" :x2="l.x2" :y2="l.y2"
              stroke="#6fc0ea" stroke-width="2" stroke-dasharray="3 7" opacity="0.75"
            />
            <circle v-for="l in parentLines" :key="l.id + 'd'" :cx="l.x2" :cy="l.y2" r="5" fill="#6fc0ea" opacity="0.75" />
          </g>

          <!-- the selected entities -->
          <rect
            v-for="b in selBoxes" :key="b.id"
            :x="b.x - 6" :y="b.y - 6" :width="b.w + 12" :height="b.h + 12"
            fill="none" stroke="#e2704a" stroke-width="2" stroke-dasharray="8 6" rx="6"
          />

          <!-- an entity's own points, while inside it -->
          <g v-if="ctxInst">
            <rect
              v-for="hd in handles" :key="hd.id"
              :x="hd.x - 7" :y="hd.y - 7" width="14" height="14" rx="3"
              :fill="hsel.includes(hd.id) ? '#ffd9a0' : '#101a20'"
              stroke="#ffd9a0" stroke-width="2"
            />
          </g>

          <SvgScene :shapes="draftShapes" />

          <rect
            v-if="band" :x="band.x" :y="band.y" :width="band.w" :height="band.h"
            fill="rgba(226,112,74,.12)" stroke="#e2704a" stroke-width="2" stroke-dasharray="6 5"
          />
        </svg>

        <p class="hint">{{ hint }}</p>
      </div>
    </main>

    <!-- the inspector -->
    <aside class="inspector">
      <template v-if="inspected">
        <div class="insp-head">
          <h3>{{ inspected.def.title }}</h3>
          <button v-if="ctxInst" class="btn ghost small" @click="exitContext">Leave</button>
        </div>
        <p v-if="soloBulk" class="tip">{{ soloBulk }}</p>
        <button class="btn small wide" @click="saveAsset">Save as asset</button>
        <div v-for="f in fields" :key="f.key" class="field">
          <span class="lab">
            {{ f.label }}
            <em v-if="f.global" class="badge" title="Affects how it interacts with the world">world</em>
          </span>
          <template v-if="f.type === 'list'">
            <p v-if="f.note" class="sub">{{ f.note }}</p>
            <p v-if="!(inspected.data[f.key] || []).length" class="sub">nothing to adjust yet</p>
            <div v-for="(row, i) in inspected.data[f.key] || []" :key="i" class="listrow">
              <span class="idx">{{ i + 1 }}</span>
              <label v-for="sub in f.fields" :key="sub.key">
                <span>{{ sub.label }}</span>
                <input type="number" v-model.number="row[sub.key]" :min="sub.min" :max="sub.max" :step="sub.step" />
              </label>
            </div>
          </template>
          <input v-else-if="f.type === 'bool'" type="checkbox" v-model="inspected.data[f.key]" />
          <input v-else-if="f.type === 'color'" type="color" v-model="inspected.data[f.key]" />
          <input v-else-if="f.type === 'number'" type="number" v-model.number="inspected.data[f.key]" :min="f.min" :max="f.max" :step="f.step" />
          <template v-else-if="f.type === 'range'">
            <input type="range" v-model.number="inspected.data[f.key]" :min="f.min" :max="f.max" :step="f.step" />
            <output>{{ inspected.data[f.key] }}</output>
          </template>
          <input v-else type="text" v-model="inspected.data[f.key]" />
        </div>
      </template>
      <template v-if="bulk">
        <div class="insp-head"><h3>{{ bulk.def.title }} · {{ bulk.list.length }}</h3></div>
        <button class="btn small primary wide" @click="runBulk">{{ bulk.def.editor.bulk.label }}</button>
      </template>

      <template v-if="parentBox">
        <div class="insp-head"><h3>Attachment</h3></div>
        <p v-if="parentBox.of" class="tip">Rides along with {{ parentBox.of }}</p>
        <button v-if="parentBox.canBind" class="btn small wide" @click="bindParent">
          Attach to {{ parentBox.target }}
        </button>
        <button v-if="parentBox.canFree" class="btn ghost small wide" @click="freeParent">Detach</button>
      </template>

      <template v-if="!inspected && !bulk && !parentBox">
        <div class="insp-head"><h3>Level</h3></div>
        <p class="empty">Select an entity to change its properties. {{ level.entities.length }} entities on this level.</p>
      </template>
    </aside>

    <!--
      Shown only once someone tries to keep their work, and it takes nothing
      away: the level is still on screen, and pressing Save again after signing
      in does what they asked the first time.
    -->
    <div v-if="needsAccount" class="need-account">
      <p>Sign in to keep this level.</p>
      <p class="sub">Your work is still here — sign in from the menu, then press Save again.</p>
      <button class="btn small" @click="needsAccount = false">Got it</button>
    </div>

    <div v-if="playing" class="test">
      <WorldCanvas :level="testLevel" />
      <button class="btn small close" @click="playing = false">Close the test</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, shallowRef } from 'vue'
import { allEntities, getEntity } from '../core/registry.js'
import { shapesForLevel } from '../core/scene.js'
import * as lib from '../core/library.js'
import { session } from '../core/session.js'
import { saveLevel as pushLevel } from '../core/authoring.js'
import { onQueueChange, queueState as queueSnapshot } from '../core/queue.js'
import { readOnlyContext } from '../core/scene.js'
import { newId } from '../core/world.js'
import { rectsIntersect, pointInRect } from '../core/geom.js'
import { svgPoint } from '../core/svgPoint.js'
import SvgScene from '../components/SvgScene.js'
import WorldCanvas from '../components/WorldCanvas.vue'

const props = defineProps({ levelId: String, chapterId: String, storyId: String })
const emit = defineEmits(['back'])

const defs = allEntities()
const iconOf = (type) => getEntity(type)?.icon || ''
const assetTick = ref(0)
const allAssets = computed(() => (assetTick.value, lib.assets()))
const hot = computed(() => (assetTick.value, lib.hotAssets({
  storyId: props.storyId, chapterId: props.chapterId, levelId: props.levelId,
})))
const scope = ref('level')
const scopeId = computed(() => ({ level: props.levelId, chapter: props.chapterId, story: props.storyId }[scope.value]))
const isHot = (a) => (assetTick.value, lib.isHot(scope.value, scopeId.value, a.id))
function toggleHot(a) { lib.toggleHot(scope.value, scopeId.value, a.id); assetTick.value++ }
function dropAsset(a) {
  if (confirm(`Delete the asset "${a.title}"?`)) { lib.removeAsset(a.id); assetTick.value++ }
}
function saveAsset() {
  const e = inspected.value
  if (!e) return
  const title = prompt('Asset name', e.def.title)
  if (!title) return
  lib.createAsset({ type: e.type, title, data: e.data })
  assetTick.value++
}

// An asset is placed with one click: a copy of its data is moved so its centre
// lands under the cursor. How to move that data is the entity's own business —
// editor.move.
function startAsset(a) {
  const def = getEntity(a.type)
  if (!def) return
  creating.value = { def, asset: a, draft: { at: null } }
  sel.value = []
  exitContext()
}
function assetData(a, pt) {
  const def = getEntity(a.type)
  const data = structuredClone(a.data)
  const b = def.editor.bounds?.(data)
  if (b) def.editor.move?.(data, pt.x - (b.x + b.w / 2), pt.y - (b.y + b.h / 2))
  return data
}
function placeAsset(pt) {
  const a = creating.value.asset
  const e = { id: newId(a.type + '-'), type: a.type, data: assetData(a, pt) }
  level.value.entities.push(e)
  touched()
  sel.value = [e.id]
  creating.value = null
  mode.value = 'idle'
}
const level = ref(lib.level(props.levelId) || { id: props.levelId, name: 'Level not found', width: 1600, height: 900, gravity: { x: 0, y: 1800 }, goal: 3, entities: [], hot: [] })
for (const e of level.value.entities) e.id ||= newId(e.type + '-')

const svg = ref(null)
const view = ref({ x: 0, y: 0, zoom: 1 })
const viewBox = computed(() => {
  const v = view.value
  return `${v.x} ${v.y} ${level.value.width / v.zoom} ${level.value.height / v.zoom}`
})

const mode = ref('idle')          // idle | create | context
const creating = shallowRef(null) // { def, draft }
const ctxId = ref(null)
const sel = ref([])
const hsel = ref([])
const band = ref(null)
const playing = ref(false)

// Raised the first time someone tries to keep their work without an account.
const needsAccount = ref(false)

// Зеркало состояния очереди.
//
// Очередь не реактивна намеренно — она модуль ядра и обязана работать без Vue.
// Реактивность добавляет тот, кому она нужна, то есть этот экран.
const queueState = ref({ ...queueSnapshot })
const unsubscribe = onQueueChange((next) => { queueState.value = next })
onBeforeUnmount(unsubscribe)

const testLevel = shallowRef(null)
let drag = null

const find = (id) => level.value.entities.find((e) => e.id === id)
const ctxInst = computed(() => (ctxId.value ? withDef(find(ctxId.value)) : null))
const inspected = computed(() => {
  if (ctxInst.value) return ctxInst.value
  if (sel.value.length === 1) return withDef(find(sel.value[0]))
  return null
})
const fields = computed(() => inspected.value?.def.editor.props?.(inspected.value.data) || [])

// same type + more than one selected + the entity offers a bulk action
const bulk = computed(() => {
  if (ctxInst.value || sel.value.length < 2) return null
  const list = sel.value.map((id) => find(id)).filter(Boolean)
  const type = list[0]?.type
  if (!type || !list.every((e) => e.type === type)) return null
  const def = getEntity(type)
  return def?.editor.bulk ? { def, list } : null
})
// the hint on a single entity's card when it has a bulk action
const soloBulk = computed(() => {
  const def = inspected.value?.def
  if (!def?.editor.bulk || bulk.value) return null
  return `"${def.editor.bulk.label}" — select several (shift-click)`
})
// Attachment is a relation of the level rather than of the entity: the world
// carries the child along with the parent and fuses it into the parent's body,
// if it has one.
const parentBox = computed(() => {
  if (ctxInst.value) return null
  const list = sel.value.map((id) => find(id)).filter(Boolean)
  if (!list.length) return null
  const of = list.length === 1 && list[0].parent ? getEntity(find(list[0].parent)?.type)?.title : null
  if (list.length < 2) return of ? { of, canFree: true, canBind: false } : null
  const target = list[list.length - 1]
  return {
    of: null,
    target: getEntity(target.type)?.title || target.type,
    canBind: true,
    canFree: list.some((e) => e.parent),
  }
})

function descendant(id, ofId, guard = 0) {
  if (id === ofId) return true
  if (guard > 32) return false
  const e = find(id)
  return e?.parent ? descendant(e.parent, ofId, guard + 1) : false
}

function bindParent() {
  const list = sel.value.map((id) => find(id)).filter(Boolean)
  const target = list[list.length - 1]
  for (const e of list) {
    if (e === target) continue
    if (descendant(target.id, e.id)) continue // no cycles
    e.parent = target.id
  }
  touched()
}
function freeParent() {
  for (const id of sel.value) { const e = find(id); if (e) delete e.parent }
  touched()
}

const parentLines = computed(() => {
  const out = []
  for (const e of level.value.entities) {
    if (!e.parent) continue
    const p = find(e.parent)
    if (!p) continue
    const a = getEntity(e.type)?.editor.bounds?.(e.data)
    const b = getEntity(p.type)?.editor.bounds?.(p.data)
    if (!a || !b) continue
    out.push({ id: e.id, x1: a.x + a.w / 2, y1: a.y + a.h / 2, x2: b.x + b.w / 2, y2: b.y + b.h / 2 })
  }
  return out
})

function runBulk() {
  const b = bulk.value
  b.def.editor.bulk.apply(b.list.map((e) => ({ id: e.id, data: e.data })))
}

function withDef(e) {
  if (!e) return null
  return { ...e, def: getEntity(e.type) }
}

const sceneShapes = computed(() => shapesForLevel(level.value))

const draftShapes = computed(() => {
  const c = creating.value
  if (!c) return []
  if (c.asset) {
    if (!c.draft.at) return []
    const data = assetData(c.asset, c.draft.at)
    const ctx = readOnlyContext(level.value, { id: 'preview', type: c.asset.type })
    return (c.def.shapes(data, null, ctx) || []).map((s) => ({ ...s, opacity: 0.65 }))
  }
  return c.def.editor.create.shapes?.(c.draft) || []
})

const selBoxes = computed(() =>
  sel.value.map((id) => {
    const e = withDef(find(id))
    if (!e?.def.editor.bounds) return null
    return { id, ...e.def.editor.bounds(e.data) }
  }).filter(Boolean),
)

const handles = computed(() => {
  const inst = ctxInst.value
  return inst?.def.editor.handles?.(inst.data) || []
})

const hint = computed(() => {
  if (creating.value?.asset) return `Asset "${creating.value.asset.title}": click where it should go. Esc cancels.`
  if (creating.value) return `${creating.value.def.title}: click on the canvas. Enter, or clicking the button again, finishes; Esc cancels.`
  if (ctxInst.value) return 'Inside an entity: drag a box to select points, drag them to move, Del removes them, click empty space or press Esc to step out.'
  if (bulk.value) return `${bulk.value.list.length} selected — the "${bulk.value.def.editor.bulk.label}" button is on the right. Del removes them.`
  if (parentBox.value?.canBind) return `The last one selected becomes the parent — "${parentBox.value.target}". Build the order with shift-click.`
  return 'Select entities with a box or shift-click, drag to move, click to step inside, Del to remove. Alt or middle mouse pans, the wheel zooms.'
})

// --- input ------------------------------------------------------------------
const toWorld = (e) => svgPoint(svg.value, e)

function onDown(e) {
  if (e.button === 1 || e.altKey) {
    drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.value.x, vy: view.value.y }
    return
  }
  if (e.button !== 0) return
  svg.value.setPointerCapture?.(e.pointerId)
  const p = toWorld(e)

  // Shift-click builds up a group and does not step inside
  if (e.shiftKey && !creating.value) {
    const hit = topHit(p)
    if (hit) {
      exitContext()
      sel.value = sel.value.includes(hit.id)
        ? sel.value.filter((id) => id !== hit.id)
        : [...sel.value, hit.id]
      return
    }
  }

  if (creating.value?.asset) { placeAsset(p); return }

  if (creating.value) {
    const r = creating.value.def.editor.create.click?.(creating.value.draft, p)
    if (r === 'done') finishCreate()
    else creating.value = { ...creating.value }
    return
  }

  if (ctxInst.value) {
    const hit = handles.value.find((h) => Math.hypot(h.x - p.x, h.y - p.y) < 12)
    if (hit) {
      if (!hsel.value.includes(hit.id)) hsel.value = [hit.id]
      drag = { kind: 'handles', last: p, moved: 0 }
      return
    }
    // landed on another entity: a click switches context, a drag moves it
    const other = topHit(p)
    if (other && other.id !== ctxId.value) {
      sel.value = [other.id]
      drag = { kind: 'instances', last: p, moved: 0, inst: other }
      return
    }
    drag = { kind: 'band', start: p, moved: 0 }
    band.value = { x: p.x, y: p.y, w: 0, h: 0 }
    return
  }

  const hit = topHit(p)
  if (hit) {
    if (!sel.value.includes(hit.id)) sel.value = [hit.id]
    drag = { kind: 'instances', last: p, moved: 0, inst: hit }
  } else {
    sel.value = []
    drag = { kind: 'band', start: p, moved: 0 }
    band.value = { x: p.x, y: p.y, w: 0, h: 0 }
  }
}

function onMove(e) {
  if (drag?.kind === 'pan') {
    const k = level.value.width / view.value.zoom / svg.value.clientWidth
    view.value.x = drag.vx - (e.clientX - drag.sx) * k
    view.value.y = drag.vy - (e.clientY - drag.sy) * k
    return
  }
  const p = toWorld(e)
  if (creating.value?.asset) { creating.value = { ...creating.value, draft: { at: p } }; return }
  if (creating.value) { creating.value.def.editor.create.move?.(creating.value.draft, p); creating.value = { ...creating.value }; return }
  if (!drag) return

  if (drag.kind === 'band') {
    band.value = {
      x: Math.min(drag.start.x, p.x), y: Math.min(drag.start.y, p.y),
      w: Math.abs(p.x - drag.start.x), h: Math.abs(p.y - drag.start.y),
    }
    drag.moved += 1
    return
  }
  const dx = p.x - drag.last.x
  const dy = p.y - drag.last.y
  drag.last = p
  drag.moved += Math.abs(dx) + Math.abs(dy)

  if (drag.kind === 'handles') {
    const inst = ctxInst.value
    inst.def.editor.moveHandles?.(inst.data, hsel.value, dx, dy)
  } else if (drag.kind === 'instances') {
    for (const id of sel.value) {
      const e2 = withDef(find(id))
      e2?.def.editor.move?.(e2.data, dx, dy)
    }
  }
}

function onUp() {
  if (!drag) return
  const d = drag
  drag = null

  // Dragging something is the commonest way a level changes, and the moment the
  // pointer lifts is when the change is finished. A hundred events went into
  // that drag; only this one is worth a write.
  if (d.moved > 0 && (d.kind === 'instances' || d.kind === 'handles')) touched()

  if (d.kind === 'band') {
    const r = band.value
    band.value = null
    if (r && (r.w > 3 || r.h > 3)) {
      if (ctxInst.value) hsel.value = handles.value.filter((h) => pointInRect(h.x, h.y, r)).map((h) => h.id)
      else sel.value = level.value.entities.filter((e) => {
        const def = getEntity(e.type)
        const b = def?.editor.bounds?.(e.data)
        return b && rectsIntersect(b, r)
      }).map((e) => e.id)
    } else if (ctxInst.value) exitContext()
    return
  }
  if (d.kind === 'instances' && d.moved < 4 && d.inst) enterContext(d.inst.id)
}

function onDbl(e) {
  const inst = ctxInst.value
  if (!inst?.def.editor.addHandle) return
  inst.def.editor.addHandle(inst.data, toWorld(e))
}

function onWheel(e) {
  const p = toWorld(e)
  const z = Math.min(6, Math.max(0.25, view.value.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
  const v = view.value
  v.x = p.x - (p.x - v.x) * (v.zoom / z)
  v.y = p.y - (p.y - v.y) * (v.zoom / z)
  v.zoom = z
}

function topHit(p) {
  const list = [...level.value.entities].sort((a, b) => (getEntity(b.type)?.z || 0) - (getEntity(a.type)?.z || 0))
  for (const e of list) {
    const def = getEntity(e.type)
    if (def?.editor.hit?.(e.data, p)) return e
  }
  return null
}

// --- modes ----------------------------------------------------------------
function toggleCreate(def) {
  if (creating.value?.def === def && !creating.value.asset) return finishCreate()
  creating.value = { def, draft: def.editor.create.start() }
  mode.value = 'create'
  sel.value = []
  exitContext()
}

function finishCreate() {
  const c = creating.value
  creating.value = null
  mode.value = 'idle'
  if (!c || c.asset) return
  const data = c.def.editor.create.finish?.(c.draft)
  if (data) {
    const e = { id: newId(c.def.type + '-'), type: c.def.type, data }
    level.value.entities.push(e)
  touched()
    sel.value = [e.id]
  }
}

function cancelCreate() { creating.value = null; mode.value = 'idle' }

function enterContext(id) {
  ctxId.value = id
  sel.value = [id]
  hsel.value = []
  mode.value = 'context'
}
function exitContext() {
  ctxId.value = null
  hsel.value = []
  if (mode.value === 'context') mode.value = 'idle'
}

function removeEntities(ids) {
  const gone = level.value.entities.filter((e) => ids.includes(e.id))
  level.value.entities = level.value.entities.filter((e) => !ids.includes(e.id))
  for (const g of gone) {
    const forget = getEntity(g.type)?.editor.forget
    if (!forget) continue
    for (const e of level.value.entities) if (e.type === g.type) forget(e.data, g.id)
  }
  for (const e of level.value.entities) if (ids.includes(e.parent)) delete e.parent
  sel.value = sel.value.filter((id) => !ids.includes(id))
  touched()
}

function del() {
  const inst = ctxInst.value
  if (inst) {
    if (!hsel.value.length) return
    const ok = inst.def.editor.deleteHandles?.(inst.data, hsel.value)
    if (ok === false) { const id = inst.id; exitContext(); removeEntities([id]) }
    else hsel.value = []
    return
  }
  if (sel.value.length) removeEntities([...sel.value])
  touched()
}

function onKey(e) {
  const t = e.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
  if (e.key === 'Enter') { if (creating.value) finishCreate() }
  else if (e.key === 'Escape') {
    if (creating.value) cancelCreate()
    else if (ctxInst.value) exitContext()
    else sel.value = []
  } else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); del() }
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// --- saving and testing --------------------------------------------------
const snapshot = () => JSON.parse(JSON.stringify(level.value))
/**
 * Save the level — and ask for an account the first time it matters.
 *
 * The gate is here rather than on the way into the editor on purpose. Someone
 * who has not built anything yet has nothing at stake, and demanding a sign-up
 * to look around loses exactly the people who came to try it. Saving is the
 * first moment the game makes a promise — "this will still be here tomorrow" —
 * and that promise is the one that needs an account behind it.
 */
function save() {
  if (session.status !== 'signed-in') {
    needsAccount.value = true

    return
  }

  needsAccount.value = false

  const level = snapshot()
  lib.saveLevel(level)

  // Queued, not awaited. The editor draws what the author already did; getting
  // it to the server is the queue's job, and it survives a lost connection and
  // a closed tab.
  pushLevel(props.storyId, level)
}

/**
 * Автосохранение.
 *
 * Правка уходит сама, через паузу после последнего действия. Кнопка остаётся —
 * людям нужно место, где можно нажать и убедиться, — но работа больше не
 * зависит от того, вспомнил ли автор про неё.
 *
 * Пауза, а не запись на каждое движение: перетаскивание камня — это сотня
 * событий, из которых на сервере имеет смысл только последнее.
 */
let autosaveTimer = null

function touched() {
  if (session.status !== 'signed-in') return

  clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(save, 1200)
}

onBeforeUnmount(() => {
  clearTimeout(autosaveTimer)

  // Уходя со страницы, дописываем: иначе последние секунды работы остались бы
  // только в таймере, который вот-вот исчезнет.
  if (session.status === 'signed-in') save()
})
function play() { testLevel.value = snapshot(); playing.value = true }
function leave() { save(); emit('back') }
</script>

<style scoped>
.save-state { font-size: 11px; color: var(--muted); margin-left: 8px; }
.save-state.warn { color: #e0b96b; }

.need-account {
  position: absolute; left: 50%; top: 64px; transform: translateX(-50%); z-index: 40;
  max-width: 380px; padding: 14px 18px; text-align: center;
  background: rgba(11, 16, 20, 0.96); border: 1px solid rgba(140, 200, 160, 0.45);
  border-radius: 14px;
}
.need-account p { margin: 0 0 6px; font-size: 13px; color: var(--text); }
.need-account .sub { font-size: 12px; color: var(--muted); }
.need-account .btn { margin-top: 8px; }

.editor {
  position: absolute; inset: 0;
  display: grid; grid-template-columns: 168px 1fr 258px;
  background: var(--ink);
}
.rail { border-right: 1px solid var(--line); padding: 14px 10px; overflow: auto; }
.rail-cap {
  font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.24em;
  text-transform: uppercase; color: var(--muted); padding: 0 6px 10px;
}
.tool {
  display: flex; align-items: center; gap: 10px; width: 100%;
  background: none; border: 1px solid transparent; border-radius: 10px;
  padding: 9px 10px; color: var(--text); cursor: pointer; text-align: left;
  font: inherit; font-size: 13px;
}
.tool:hover { background: var(--panel); }
.tool.on { background: rgba(226, 112, 74, 0.16); border-color: var(--goo); color: #ffd9a0; }
.tool.hot { color: #ffd9a0; }
.rail-cap.spread { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.scope {
  background: #101a20; color: var(--muted); border: 1px solid var(--line);
  border-radius: 6px; font: inherit; font-size: 10px; padding: 2px 4px;
}
.asset { display: flex; align-items: center; gap: 2px; }
.asset .tool { flex: 1; min-width: 0; }
.asset .lbl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.star {
  background: none; border: none; color: #38505d; cursor: pointer;
  font-size: 14px; line-height: 1; padding: 4px 3px;
}
.star.on { color: var(--goo); }
.star:hover { color: var(--text); }
.star.drop { font-size: 16px; }
.ico { width: 22px; height: 22px; flex: none; color: currentColor; }
.ico :deep(svg) { width: 100%; height: 100%; display: block; }

.main { display: flex; flex-direction: column; min-width: 0; }
.bar {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; border-bottom: 1px solid var(--line);
}
.name {
  flex: 1; min-width: 80px; background: none; border: 1px solid transparent;
  color: var(--text); font-family: var(--font-display); font-size: 20px;
  padding: 4px 8px; border-radius: 8px;
}
.name:hover, .name:focus { border-color: var(--line); outline: none; background: var(--panel); }
.inline { flex-direction: row; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
.mini { width: 70px; }

.canvas-wrap { position: relative; flex: 1; min-height: 0; background: #0d1519; }
.canvas { width: 100%; height: 100%; display: block; touch-action: none; cursor: crosshair; }
.hint {
  position: absolute; left: 12px; bottom: 10px; right: 12px; margin: 0;
  font-family: var(--font-mono); font-size: 11.5px; color: var(--muted);
  pointer-events: none;
}

.inspector { border-left: 1px solid var(--line); padding: 14px; overflow: auto; }
.insp-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.insp-head h3 { margin: 0; font-size: 15px; font-family: var(--font-display); letter-spacing: 0.02em; }
.empty { color: var(--muted); font-size: 13px; line-height: 1.6; }
.wide { width: 100%; margin-bottom: 12px; }
.sub { margin: 0 0 6px; color: var(--muted); font-size: 11px; line-height: 1.45; }
.listrow {
  display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
  background: #101a20; border: 1px solid var(--line); border-radius: 8px; padding: 5px 8px;
}
.listrow .idx {
  font-family: var(--font-mono); font-size: 11px; color: var(--muted);
  min-width: 14px; text-align: right;
}
.listrow label { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--muted); flex: 1; }
.listrow input { width: 100%; min-width: 0; padding: 4px 6px !important; }
.tip {
  margin: 0 0 14px; padding: 8px 10px; border-radius: 8px;
  background: rgba(111, 192, 234, 0.08); border: 1px solid rgba(111, 192, 234, 0.25);
  color: var(--muted); font-size: 12px; line-height: 1.5;
}
.badge {
  font-family: var(--font-mono); font-style: normal; font-size: 9px; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--pipe); border: 1px solid currentColor;
  border-radius: 4px; padding: 1px 4px; margin-left: 6px;
}
.lab { display: flex; align-items: center; font-size: 12px; color: var(--muted); }
output { font-family: var(--font-mono); font-size: 11px; color: var(--muted); }

.test { position: absolute; inset: 0; background: var(--ink); z-index: 20; }
.close { position: absolute; top: 14px; right: 14px; }

@media (max-width: 900px) {
  .editor { grid-template-columns: 120px 1fr; }
  .inspector { display: none; }
}
</style>
