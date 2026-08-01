<template>
  <div class="picker">
    <header class="bar">
      <button class="btn ghost" @click="$emit('back')">← Меню</button>
      <h2>{{ mode === 'play' ? 'Выберите уровень' : 'Уровни' }}</h2>
      <button v-if="mode === 'edit'" class="btn primary" @click="create">Новый уровень</button>
      <span v-else class="spacer" />
    </header>

    <ul class="grid">
      <li v-for="l in levels" :key="l.id" class="card">
        <div class="thumb" @click="pick(l)">
          <svg :viewBox="`0 0 ${l.width} ${l.height}`" preserveAspectRatio="xMidYMid meet">
            <rect :width="l.width" :height="l.height" fill="#141f26" />
            <SvgScene :shapes="preview(l)" />
          </svg>
        </div>
        <div class="meta">
          <div>
            <h3>{{ l.name }}</h3>
            <p class="stat">{{ l.entities.length }} сущностей · цель {{ l.goal }}</p>
          </div>
          <div class="row">
            <button class="btn small primary" @click="pick(l)">{{ mode === 'play' ? 'Играть' : 'Изменить' }}</button>
            <template v-if="mode === 'edit'">
              <button class="btn small" @click="duplicate(l)">Копия</button>
              <button class="btn small danger" @click="remove(l)">Удалить</button>
            </template>
          </div>
        </div>
      </li>
    </ul>

    <footer v-if="mode === 'edit'" class="foot">
      <button class="btn ghost small" @click="reset">Вернуть встроенные уровни</button>
    </footer>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { listLevels, deleteLevel, copyLevel, blankLevel, resetLevels } from '../core/levels.js'
import { getEntity } from '../core/registry.js'
import SvgScene from '../components/SvgScene.js'

const props = defineProps({ mode: { type: String, default: 'play' } })
const emit = defineEmits(['back', 'open'])

const levels = ref(listLevels())
const refresh = () => (levels.value = listLevels())

function preview(level) {
  const out = []
  const sorted = [...level.entities].sort((a, b) => (getEntity(a.type)?.z || 0) - (getEntity(b.type)?.z || 0))
  for (const e of sorted) {
    const def = getEntity(e.type)
    if (def) out.push(...def.shapes(e.data, null))
  }
  return out
}

const pick = (l) => emit('open', l.id)
function duplicate(l) { copyLevel(l.id); refresh() }
function remove(l) {
  if (confirm(`Удалить уровень «${l.name}»?`)) { deleteLevel(l.id); refresh() }
}
function create() { const l = blankLevel(); emit('open', l.id) }
function reset() {
  if (confirm('Все изменения уровней будут потеряны. Вернуть встроенные?')) { resetLevels(); refresh() }
}
</script>

<style scoped>
.picker { position: absolute; inset: 0; overflow: auto; padding-bottom: 60px; }
.bar {
  display: flex; align-items: center; gap: 16px;
  padding: 20px clamp(16px, 4vw, 44px); position: sticky; top: 0; z-index: 2;
  background: linear-gradient(var(--ink) 70%, transparent);
}
.bar h2 { flex: 1; margin: 0; font-family: var(--font-display); font-size: 26px; letter-spacing: 0.02em; }
.spacer { width: 1px; }
.grid {
  list-style: none; margin: 0; padding: 0 clamp(16px, 4vw, 44px);
  display: grid; gap: 20px; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
}
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
.thumb { aspect-ratio: 16 / 9; background: #141f26; cursor: pointer; }
.thumb svg { display: block; width: 100%; height: 100%; }
.meta { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 12px; }
.meta h3 { margin: 0; font-size: 17px; }
.stat { margin: 4px 0 0; font-family: var(--font-mono); font-size: 12px; color: var(--muted); }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
.foot { padding: 26px clamp(16px, 4vw, 44px); }
</style>
