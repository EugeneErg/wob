<template>
  <!--
    Что с несохранёнными правками — на всех экранах, а не только в редакторе
    уровня.

    Индикатор существовал ровно там, где почти ничего и не ломалось. Конфликт
    версий случается на доске истории и на карте главы, а там не было ничего:
    очередь вставала, запросы уходили впустую, и автор продолжал рисовать в
    полной уверенности, что всё записывается.
  -->
  <div v-if="show" class="save" :class="state.status">
    <span v-if="state.status === 'conflict'">
      Эта история изменилась в другом месте — правки не сохраняются.
    </span>
    <span v-else-if="state.status === 'offline'">Не сохранено — пробуем снова…</span>
    <span v-else>Сохраняем…</span>

    <template v-if="state.status === 'conflict'">
      <button class="act" @click="reload">Обновить</button>
      <button class="act quiet" @click="drop">Отбросить правку</button>
    </template>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { discardStuck, onQueueChange, queueState } from '../core/queue.js'

const state = ref({ ...queueState })
const stop = onQueueChange((next) => { state.value = next })
onBeforeUnmount(stop)

const show = computed(() => state.value.status !== 'ok' || state.value.pending > 0)

// Перечитать историю — это и есть выход из конфликта, а надёжнее всего
// перечитывает её перезагрузка: содержимое приезжает с сервера при открытии
// редактора, и после неё версия снова та же, что у сервера.
const reload = () => window.location.reload()

const drop = () => {
  if (confirm('Эта правка не сохранится. Отбросить её и продолжить?')) discardStuck()
}
</script>

<style scoped>
.save {
  position: fixed; left: 50%; transform: translateX(-50%); bottom: 16px; z-index: 40;
  display: flex; align-items: center; gap: 10px;
  padding: 9px 14px; border-radius: 999px; font-size: 12.5px;
  background: rgba(11, 16, 20, 0.95); border: 1px solid var(--line); color: var(--muted);
}
.save.offline { border-color: rgba(224, 173, 107, 0.6); color: #e8c88f; }
.save.conflict { border-color: rgba(224, 115, 107, 0.7); color: #ffb9b2; }
.act {
  font: inherit; font-size: 12px; padding: 4px 10px; cursor: pointer;
  background: rgba(22, 36, 44, 0.9); color: var(--text);
  border: 1px solid var(--line); border-radius: 999px;
}
.act:hover { border-color: rgba(160, 190, 210, 0.6); }
.act.quiet { color: var(--muted); }
</style>
