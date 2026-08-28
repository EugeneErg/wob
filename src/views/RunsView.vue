<template>
  <div class="screen">
    <header class="bar">
      <button class="btn ghost small" @click="$emit('back')">← Назад</button>
      <h2>Попытки: {{ title }}</h2>
      <span v-if="best" class="best">лучшее {{ fmt(best.ticks, best.rate) }}</span>
    </header>

    <p v-if="!loading && !list.length" class="empty">
      Здесь пока пусто. Пройдите уровень — попытка запишется сама,
      и её можно будет пересмотреть.
    </p>
    <p v-else-if="loading" class="empty">Читаем записи…</p>

    <ul v-else class="runs">
      <li v-for="r in list" :key="r.id" class="run" :class="{ best: best && r.id === best.id }">
        <div class="left">
          <span class="time">{{ fmt(r.ticks, r.rate) }}</span>
          <span class="tags">
            <i v-if="r.speedrun" class="tag sr">спидран</i>
            <i v-else class="tag">прохождение</i>
            <i v-if="r.kind !== 'level'" class="tag">{{ r.category === '100' ? '100%' : 'any%' }}</i>
            <i v-if="!r.finished" class="tag dim">не пройдено</i>
            <i v-if="r.clean === false" class="tag warn">с откатами</i>
          </span>
        </div>

        <div class="mid">
          <span class="when">{{ when(r.at) }}</span>
          <span v-if="r.segments" class="sub">{{ r.segments.length }} заходов</span>
          <span v-else-if="r.input" class="sub">{{ r.input.length / 4 }} действий</span>
          <!-- Устаревшая запись не прячется и играется — просто честно
               помечена: она снята на другой версии, и сравнивать её время
               с нынешними рекордами не с чем. -->
          <span v-if="stale(r)" class="sub old">{{ stale(r) }}</span>
        </div>

        <div class="right">
          <button class="btn small primary" :disabled="!playable(r)" @click="$emit('watch', r)">
            Смотреть
          </button>
          <button class="btn small danger" @click="drop(r)">Удалить</button>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { runsFor, bestRun, removeRun, formatTime, checkRecord } from '../core/replays.js'
import * as lib from '../core/library.js'

const props = defineProps({
  kind: { type: String, default: 'level' },   // level | chapter | story
  targetId: { type: String, required: true },
})
defineEmits(['back', 'watch'])

const list = ref([])
const best = ref(null)
const loading = ref(true)

const title = computed(() =>
  props.kind === 'level' ? lib.level(props.targetId)?.name || '?'
    : props.kind === 'chapter' ? lib.chapter(props.targetId)?.title || '?'
      : lib.story(props.targetId)?.title || '?')

const fmt = (ticks, rate) => formatTime(ticks, rate || 60)

// Записи сортируются по времени: смотреть чужой прогон интереснее с быстрых.
// Непройденные уходят в конец — они не про результат, а про то, как слили.
async function load() {
  loading.value = true
  const all = await runsFor(props.targetId, { kind: props.kind })
  list.value = all.sort((a, b) => (b.finished - a.finished) || (a.ticks - b.ticks))
  best.value = await bestRun(props.targetId, { kind: props.kind })
  loading.value = false
}
onMounted(load)

// Запись с другой версии играть можно — врать про совпадение нельзя.
const stale = (r) => {
  const v = checkRecord(r)
  return v.ok ? null : v.text
}
// Смотреть нечего только если записи ввода нет вовсе
const playable = (r) => !!(r.input?.length || r.segments?.length)

const when = (t) => {
  const d = new Date(t)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay
    ? `сегодня ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

async function drop(r) {
  if (!confirm(`Удалить попытку ${fmt(r.ticks, r.rate)}?`)) return
  await removeRun(r.id)
  await load()
}
</script>

<style scoped>
.screen { position: absolute; inset: 0; overflow: auto; display: flex; flex-direction: column; }
.bar { display: flex; align-items: center; gap: 12px; padding: 18px clamp(16px, 4vw, 44px) 12px; }
.bar h2 { flex: 1; margin: 0; font-family: var(--font-display); font-size: 24px; }
.best { font-family: var(--font-mono); font-size: 13px; color: var(--moss); }
.empty { margin: 40px clamp(16px, 4vw, 44px); color: var(--muted); font-size: 14px; max-width: 46ch; line-height: 1.5; }

.runs { list-style: none; margin: 0; padding: 0 clamp(16px, 4vw, 44px) 32px; display: grid; gap: 8px; }
.run {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding: 12px 16px; border: 1px solid var(--line); border-radius: 12px;
  background: var(--panel);
}
.run.best { border-color: var(--moss); }
.left { display: flex; flex-direction: column; gap: 6px; min-width: 150px; }
.time { font-family: var(--font-mono); font-size: 20px; color: #ffd9a0; }
.tags { display: flex; gap: 5px; flex-wrap: wrap; }
.tag {
  font-style: normal; font-family: var(--font-mono); font-size: 9.5px;
  letter-spacing: 0.1em; text-transform: uppercase;
  border: 1px solid var(--line); border-radius: 999px; padding: 2px 7px; color: var(--muted);
}
.tag.sr { color: #ffd9a0; border-color: #8c5a2c; }
.tag.dim { opacity: 0.6; }
.tag.warn { color: #ffb9a4; border-color: #8c3b2c; }

.mid { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 140px; }
.when { font-size: 12.5px; color: var(--text); }
.sub { font-family: var(--font-mono); font-size: 10.5px; color: var(--muted); }
.sub.old { color: #d8b98a; }
.right { display: flex; gap: 8px; margin-left: auto; }
</style>
