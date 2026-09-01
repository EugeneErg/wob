<template>
  <div class="account">
    <!-- Бэкенда может не быть вовсе: игра обязана работать без него, поэтому
         панель просто молчит, а не ругается на всю страницу. -->
    <p v-if="session.status === 'unconfigured'" class="hint">
      Облако выключено — не задан <code>VITE_GOOGLE_CLIENT_ID</code>.
    </p>

    <template v-else-if="session.status === 'signed-in'">
      <div class="who">
        <img v-if="session.user.avatar" :src="session.user.avatar" alt="" />
        <span class="name">{{ session.user.name }}</span>
        <button class="link" @click="signOut">выйти</button>
      </div>

      <div class="sync">
        <button class="btn small" :disabled="busy" @click="upload">
          Загрузить библиотеку в облако
        </button>
        <button class="btn small" :disabled="busy" @click="download">
          Забрать из облака
        </button>
      </div>

      <p v-if="note" class="note">{{ note }}</p>
      <ul v-if="warnings.length" class="warnings">
        <li v-for="(w, i) in warnings" :key="i">{{ w }}</li>
      </ul>
    </template>

    <template v-else>
      <p class="hint">Войдите, чтобы держать библиотеку в аккаунте.</p>
      <div ref="buttonHost" class="gbtn" />
    </template>

    <p v-if="session.error" class="err">{{ session.error }}</p>
  </div>
</template>

<script setup>
import { nextTick, onMounted, ref, watch } from 'vue'
import { refresh, renderSignInButton, session, signOut } from '../core/session.js'
import { downloadLibrary, uploadLibrary } from '../core/cloud.js'

const buttonHost = ref(null)
const busy = ref(false)
const note = ref('')
const warnings = ref([])

async function mountButton() {
  await nextTick()
  if (!buttonHost.value || session.status === 'signed-in') return
  try {
    await renderSignInButton(buttonHost.value)
  } catch (e) {
    session.error = e.message
  }
}

onMounted(async () => {
  await refresh()
  if (session.status === 'anonymous') await mountButton()
})

// После выхода кнопку нужно нарисовать заново: Google рисует её в конкретный
// узел, а этого узла в дереве только что не было.
watch(() => session.status, (s) => { if (s === 'anonymous') mountButton() })

async function upload() {
  busy.value = true
  note.value = ''
  warnings.value = []

  try {
    const r = await uploadLibrary()
    const renamed = Object.entries(r.idMap || {}).filter(([a, b]) => a !== b).length
    note.value = renamed
      ? `Загружено историй: ${r.stories.length}. Переименовано id: ${renamed} — ничего не затёрлось.`
      : `Загружено историй: ${r.stories.length}.`
    warnings.value = r.warnings || []
  } catch (e) {
    session.error = e.message
  } finally {
    busy.value = false
  }
}

async function download() {
  busy.value = true
  note.value = ''
  warnings.value = []

  try {
    await downloadLibrary()
    note.value = 'Забрали. Библиотека пополнилась — старое на месте, копии добавились рядом.'
  } catch (e) {
    session.error = e.message
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.account { margin-top: 18px; font-size: 12px; color: var(--muted); }
.hint { margin: 0 0 8px; }
.hint code { font-size: 11px; opacity: 0.85; }
.who { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.who img { width: 22px; height: 22px; border-radius: 50%; }
.name { color: var(--text); }
.link {
  background: none; border: 0; padding: 0; font: inherit;
  color: var(--muted); text-decoration: underline; cursor: pointer;
}
.link:hover { color: var(--text); }
.sync { display: flex; gap: 8px; flex-wrap: wrap; }
.btn.small { font-size: 12px; padding: 6px 12px; }
.note { margin: 8px 0 0; color: var(--text); }
.warnings { margin: 6px 0 0; padding-left: 16px; }
.warnings li { margin: 2px 0; }
.err { margin: 8px 0 0; color: #e0736b; }
.gbtn { min-height: 32px; }
</style>
