<template>
  <div class="account">
    <!-- Nothing to sign in with: the panel stays quiet rather than shouting
         across the page. It used to say the game had to work without a backend
         at all — that is not true and has not been for a while. Stories live in
         the account, covers and films are uploaded, and the shelf is fetched;
         what survives is tolerance for the sign-in button being unconfigured in
         a local build. -->
    <p v-if="session.status === 'unconfigured'" class="hint">
      Cloud is off — <code>VITE_GOOGLE_CLIENT_ID</code> is not set.
    </p>

    <template v-else-if="session.status === 'signed-in'">
      <div class="who">
        <img v-if="session.user.avatar" :src="session.user.avatar" alt="" />
        <span class="name">{{ session.user.name }}</span>
        <button class="link" @click="signOut">sign out</button>
      </div>

      <div class="sync">
        <button class="btn small" :disabled="busy" @click="upload">
          Upload library to the cloud
        </button>
        <button class="btn small" :disabled="busy" @click="download">
          Fetch from the cloud
        </button>
      </div>

      <p v-if="note" class="note">{{ note }}</p>
      <ul v-if="warnings.length" class="warnings">
        <li v-for="(w, i) in warnings" :key="i">{{ w }}</li>
      </ul>
    </template>

    <template v-else>
      <p class="hint">Sign in to keep your library in your account.</p>
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

// After signing out the button has to be drawn again: Google renders it into
// one specific node, and that node was not in the tree a moment ago.
watch(() => session.status, (s) => { if (s === 'anonymous') mountButton() })

async function upload() {
  busy.value = true
  note.value = ''
  warnings.value = []

  try {
    const r = await uploadLibrary()
    const renamed = Object.entries(r.idMap || {}).filter(([a, b]) => a !== b).length
    note.value = renamed
      ? `Stories uploaded: ${r.stories.length}. Ids renamed: ${renamed} — nothing was overwritten.`
      : `Stories uploaded: ${r.stories.length}.`
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
    note.value = 'Fetched. The library grew — the old entries stayed, the copies landed beside them.'
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
