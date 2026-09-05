<template>
  <!--
    Кто вошёл — и единственный отсюда выход.

    Раньше здесь была подпись без кнопок, а комментарий отправлял за выходом на
    экран настроек. Выхода там не было: панель аккаунта существует отдельным
    компонентом и не подключена никуда, так что выйти из игры было нельзя вовсе
    — только чистить куки руками.

    Угол меню остаётся тем местом, куда смотрят, чтобы понять, кто ты. Поэтому
    подпись не превратилась в кнопку с надписью «выход»: она открывает короткое
    меню, и выход лежит в нём.
  -->
  <div v-if="session.status === 'signed-in'" class="wrap">
    <button class="badge" :class="{ open }" @click.stop="open = !open">
      <img v-if="session.user.avatar" :src="session.user.avatar" alt="" />
      <span>{{ firstName }}</span>
      <span class="chev" aria-hidden="true">▾</span>
    </button>

    <div v-if="open" class="menu" @click.stop>
      <p class="who">{{ session.user.name }}</p>
      <p v-if="session.user.email" class="mail">{{ session.user.email }}</p>
      <button class="item" :disabled="busy" @click="leave">
        {{ busy ? 'Signing out…' : 'Sign out' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { session, signOut } from '../core/session.js'
import { queueState } from '../core/queue.js'

const firstName = computed(() => (session.user?.name || '').split(' ')[0] || 'Account')
const open = ref(false)
const busy = ref(false)

async function leave() {
  // Выход уносит очередь: держать неотправленные правки некому — они помечены
  // версиями историй, которых у следующего вошедшего нет. Молча потерять их
  // хуже, чем задержать человека на один вопрос.
  const pending = queueState.pending

  if (pending && !confirm(
    `Не сохранено правок: ${pending}. Выход их потеряет. Всё равно выйти?`,
  )) return

  busy.value = true

  try {
    await signOut()
  } finally {
    busy.value = false
    open.value = false
  }
}

// Клик мимо закрывает. Меню в углу перекрывает кнопки под собой, и оставлять
// его открытым до повторного попадания по той же подписи — значит загородить
// человеку то, ради чего он сюда шёл.
const shut = () => (open.value = false)
onMounted(() => window.addEventListener('click', shut))
onBeforeUnmount(() => window.removeEventListener('click', shut))
</script>

<style scoped>
.wrap { position: relative; }
.badge {
  display: flex; align-items: center; gap: 7px;
  font: inherit; font-size: 12px; color: var(--muted); cursor: pointer;
  padding: 4px 10px 4px 4px;
  background: rgba(16, 26, 32, 0.66);
  border: 1px solid var(--line); border-radius: 999px;
  transition: border-color 0.15s, color 0.15s;
}
.badge:hover, .badge.open { border-color: rgba(160, 190, 210, 0.5); color: var(--text); }
.badge img { width: 22px; height: 22px; border-radius: 50%; }
.chev { font-size: 9px; opacity: 0.7; }

.menu {
  position: absolute; top: calc(100% + 6px); right: 0; min-width: 190px;
  background: rgba(11, 16, 20, 0.97); border: 1px solid var(--line);
  border-radius: 12px; padding: 10px; z-index: 5;
}
.who { margin: 0; font-size: 13px; color: var(--text); }
.mail { margin: 2px 0 8px; font-size: 11px; color: var(--muted); word-break: break-all; }
.item {
  display: block; width: 100%; text-align: left; font: inherit; font-size: 13px;
  padding: 7px 9px; cursor: pointer; color: var(--text);
  background: rgba(16, 26, 32, 0.7); border: 1px solid var(--line); border-radius: 9px;
}
.item:hover:not([disabled]) { border-color: rgba(224, 115, 107, 0.55); color: #ffb9b2; }
.item[disabled] { opacity: 0.6; cursor: default; }
</style>
