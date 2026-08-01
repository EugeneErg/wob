<template>
  <div class="editor">
    <!-- панель сущностей: кнопки появляются из реестра -->
    <aside class="rail">
      <div class="rail-cap">Сущности</div>
      <button
        v-for="def in defs"
        :key="def.type"
        class="tool"
        :class="{ on: creating?.def === def }"
        :title="def.title"
        @click="toggleCreate(def)"
      >
        <span class="ico" v-html="def.icon" />
        <span class="lbl">{{ def.title }}</span>
      </button>
    </aside>

    <main class="main">
      <header class="bar">
        <button class="btn ghost small" @click="leave">← Уровни</button>
        <input v-model="level.name" class="name" spellcheck="false" />
        <label class="field inline">Цель <input v-model.number="level.goal" type="number" min="1" class="mini" /></label>
        <label class="field inline">Гравитация <input v-model.number="level.gravity.y" type="number" step="100" class="mini" /></label>
        <button class="btn small" @click="save">Сохранить</button>
        <button class="btn small primary" @click="play">Проверить</button>
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

          <!-- выделенные сущности -->
          <rect
            v-for="b in selBoxes" :key="b.id"
            :x="b.x - 6" :y="b.y - 6" :width="b.w + 12" :height="b.h + 12"
            fill="none" stroke="#e2704a" stroke-width="2" stroke-dasharray="8 6" rx="6"
          />

          <!-- вершины сущности в её контексте -->
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

    <!-- инспектор -->
    <aside class="inspector">
      <template v-if="inspected">
        <div class="insp-head">
          <h3>{{ inspected.def.title }}</h3>
          <button v-if="ctxInst" class="btn ghost small" @click="exitContext">Выйти</button>
        </div>
        <div v-for="f in fields" :key="f.key" class="field">
          <span class="lab">
            {{ f.label }}
            <em v-if="f.global" class="badge" title="Влияет на взаимодействие с миром">мир</em>
          </span>
          <input v-if="f.type === 'bool'" type="checkbox" v-model="inspected.data[f.key]" />
          <input v-else-if="f.type === 'color'" type="color" v-model="inspected.data[f.key]" />
          <input v-else-if="f.type === 'number'" type="number" v-model.number="inspected.data[f.key]" :min="f.min" :max="f.max" :step="f.step" />
          <template v-else-if="f.type === 'range'">
            <input type="range" v-model.number="inspected.data[f.key]" :min="f.min" :max="f.max" :step="f.step" />
            <output>{{ inspected.data[f.key] }}</output>
          </template>
          <input v-else type="text" v-model="inspected.data[f.key]" />
        </div>
      </template>
      <template v-else-if="bulk">
        <div class="insp-head"><h3>{{ bulk.def.title }} · {{ bulk.list.length }}</h3></div>
        <button class="btn small primary wide" @click="runBulk">{{ bulk.def.editor.bulk.label }}</button>
        <p class="empty">Действие сущности над выделенной группой.</p>
      </template>
      <template v-else>
        <div class="insp-head"><h3>Уровень</h3></div>
        <p class="empty">Выберите сущность, чтобы менять её свойства. {{ level.entities.length }} сущностей на уровне.</p>
      </template>
    </aside>

    <div v-if="playing" class="test">
      <WorldCanvas :level="testLevel" />
      <button class="btn small close" @click="playing = false">Закрыть проверку</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, shallowRef } from 'vue'
import { allEntities, getEntity } from '../core/registry.js'
import { shapesForLevel } from '../core/scene.js'
import { getLevel, saveLevel, blankLevel } from '../core/levels.js'
import { newId } from '../core/world.js'
import { rectsIntersect, pointInRect } from '../core/geom.js'
import { svgPoint } from '../core/svgPoint.js'
import SvgScene from '../components/SvgScene.js'
import WorldCanvas from '../components/WorldCanvas.vue'

const props = defineProps({ levelId: String })
const emit = defineEmits(['back'])

const defs = allEntities()
const level = ref(getLevel(props.levelId) || blankLevel())
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
const testLevel = shallowRef(null)
let drag = null

const find = (id) => level.value.entities.find((e) => e.id === id)
const ctxInst = computed(() => (ctxId.value ? withDef(find(ctxId.value)) : null))
const inspected = computed(() => {
  if (ctxInst.value) return ctxInst.value
  if (sel.value.length === 1) return withDef(find(sel.value[0]))
  return null
})
const fields = computed(() => inspected.value?.def.editor.props?.() || [])

// одинаковый тип + несколько выделенных + сущность умеет групповое действие
const bulk = computed(() => {
  if (ctxInst.value || sel.value.length < 2) return null
  const list = sel.value.map((id) => find(id)).filter(Boolean)
  const type = list[0]?.type
  if (!type || !list.every((e) => e.type === type)) return null
  const def = getEntity(type)
  return def?.editor.bulk ? { def, list } : null
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
  if (creating.value) return `${creating.value.def.title}: кликайте по холсту. Enter или повторный клик по кнопке — готово, Esc — отмена.`
  if (ctxInst.value) return 'Контекст сущности: рамкой выделяйте вершины, тащите их мышью, Del — удалить, Esc — наружу.'
  if (bulk.value) return `Выделено ${bulk.value.list.length} шт. — справа доступно групповое действие. Del — удалить.`
  return 'Рамкой выделяйте сущности, тащите — двигайте, клик — войти внутрь, Del — удалить. Alt или средняя кнопка — панорама, колесо — зум.'
})

// --- ввод ------------------------------------------------------------------
const toWorld = (e) => svgPoint(svg.value, e)

function onDown(e) {
  if (e.button === 1 || e.altKey) {
    drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.value.x, vy: view.value.y }
    return
  }
  if (e.button !== 0) return
  svg.value.setPointerCapture?.(e.pointerId)
  const p = toWorld(e)

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
    // попали в другую сущность: клик переключит контекст, перетаскивание — подвинет
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
    } else if (ctxInst.value) hsel.value = []
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

// --- режимы ----------------------------------------------------------------
function toggleCreate(def) {
  if (creating.value?.def === def) return finishCreate()
  creating.value = { def, draft: def.editor.create.start() }
  mode.value = 'create'
  sel.value = []
  exitContext()
}

function finishCreate() {
  const c = creating.value
  creating.value = null
  mode.value = 'idle'
  if (!c) return
  const data = c.def.editor.create.finish?.(c.draft)
  if (data) {
    const e = { id: newId(c.def.type + '-'), type: c.def.type, data }
    level.value.entities.push(e)
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
  sel.value = sel.value.filter((id) => !ids.includes(id))
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

// --- сохранение / проверка --------------------------------------------------
const snapshot = () => JSON.parse(JSON.stringify(level.value))
function save() { saveLevel(snapshot()) }
function play() { testLevel.value = snapshot(); playing.value = true }
function leave() { save(); emit('back') }
</script>

<style scoped>
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
