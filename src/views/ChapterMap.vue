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
      <span v-else class="counter">{{ passed }} / {{ nodes.length }}</span>
    </header>

    <section v-if="hotOpen && mode === 'edit'" class="hot">
      <p class="note">Отмеченные поднимутся наверх списка редактора во всех уровнях этой главы.</p>
      <button
        v-for="a in allAssets" :key="a.id"
        class="chip" :class="{ on: isHot(a.id) }"
        @click="toggleHot(a.id)"
      >{{ a.title }}</button>
    </section>

    <div class="map-wrap">
      <div
        ref="map" class="map" :style="coverStyle(ch?.image)"
        @pointermove="onMove" @pointerup="onUp" @pointerleave="onUp"
        @click="sel = null"
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
          :class="{ done: isDone(n.levelId), locked: isLocked(n), sel: sel === n.levelId }"
          :style="{ left: n.x + '%', top: n.y + '%' }"
          @pointerdown.stop="onDown(n, $event)"
          @click.stop="onClick(n, $event)"
          @dblclick.stop="mode === 'edit' && $emit('edit', n.levelId)"
        >
          <span class="dot" />
          <span class="cap">{{ name(n.levelId) }}</span>
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
          <div class="menu-note">Shift+клик по другой точке — тропинка</div>
        </div>

        <p v-if="!nodes.length" class="empty">
          {{ mode === 'edit' ? 'Пока пусто — добавьте первый уровень.' : 'В этой главе ещё нет уровней.' }}
        </p>
      </div>

      <p class="hint">{{ hint }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import * as lib from '../core/library.js'
import { pickImage, coverStyle } from '../core/fileio.js'

const props = defineProps({ mode: { type: String, default: 'play' }, chapterId: String })
const emit = defineEmits(['back', 'play', 'edit'])

// ref разворачивает объект главы в реактивный прокси: правки узлов сразу видны,
// а пишутся они в тот же объект библиотеки, который потом сохраняется.
// Раньше здесь был computed, он возвращал один и тот же объект — Vue считал,
// что ничего не изменилось, и карта не перерисовывалась до перезагрузки.
const ch = ref(lib.chapter(props.chapterId))
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

const isDone = lib.isDone
const name = (id) => lib.level(id)?.name || '?'
const passed = computed(() => nodes.value.filter((n) => isDone(n.levelId)).length)
const selected = computed(() => (sel.value ? lib.level(sel.value) : null))
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
const isLocked = (n) => props.mode === 'play' && !lib.levelOpen(ch.value, n.levelId)

const hint = computed(() => {
  if (props.mode === 'play') return 'Открытые уровни горят ярче. Пройдите уровень — появится тропинка к следующим.'
  return 'Точки можно таскать. Клик — выбрать уровень, двойной клик — открыть его, Shift+клик по второй точке — тропинка между ними.'
})

// --- игра ---
function onClick(n, e) {
  if (props.mode === 'play') { if (!isLocked(n)) emit('play', n.levelId); return }
  if (drag?.moved > 1) return
  if (e.shiftKey && sel.value && sel.value !== n.levelId) { link(sel.value, n.levelId); return }
  sel.value = n.levelId
}

// --- редактор: перетаскивание точек ---
function onDown(n, e) {
  if (props.mode !== 'edit') return
  drag = { n, moved: 0 }
  map.value.setPointerCapture?.(e.pointerId)
}
function onMove(e) {
  if (!drag) return
  const r = map.value.getBoundingClientRect()
  const x = ((e.clientX - r.left) / r.width) * 100
  const y = ((e.clientY - r.top) / r.height) * 100
  drag.moved++
  drag.n.x = Math.max(2, Math.min(98, x))
  drag.n.y = Math.max(4, Math.min(96, y))
  tick.value++
}
function onUp() {
  if (drag) { lib.save(); drag = null }
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
.menu-note {
  padding: 8px 12px; border-top: 1px solid var(--line);
  font-family: var(--font-mono); font-size: 10.5px; color: var(--muted);
}
</style>
