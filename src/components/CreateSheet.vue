<template>
  <div class="sheet" @click.self="$emit('close')">
    <form class="form" @submit.prevent="submit">
      <h2>{{ heading }}</h2>

      <label class="field">
        <span>{{ nameLabel }}</span>
        <input ref="first" v-model="draft.title" :placeholder="placeholder" />
      </label>

      <label v-for="slot in slots" :key="slot.key" class="field">
        <span>{{ slot.label }}</span>
        <div class="pick">
          <span class="swatch" :class="{ film: slot.kind === 'video' }" :style="swatch(slot)" />
          <button type="button" class="btn small" :disabled="!!busy" @click="upload(slot)">
            {{ busy === slot.key ? 'Uploading…' : (draft[slot.key] ? 'Replace' : slot.cta) }}
          </button>
          <button
            v-if="draft[slot.key]"
            type="button" class="btn small" :disabled="!!busy" @click="draft[slot.key] = ''"
          >
            Clear
          </button>
        </div>
      </label>

      <p v-if="failed" class="bad">{{ failed }}</p>

      <div class="row">
        <button type="button" class="btn small" @click="$emit('close')">Cancel</button>
        <button type="submit" class="btn small accent" :disabled="!draft.title.trim() || !!busy">
          Create
        </button>
      </div>
    </form>
  </div>
</template>

<script setup>
/*
  One form for stories, chapters and levels.

  They ask for different things — a story has a film, a chapter has a map
  backdrop, a level has neither — but the shape is the same, and three copies
  would drift apart the first time one of them grew a field.

  It asks for everything up front on purpose. Create-then-go-and-set-the-picture
  is how a library fills up with items called "New chapter" and no cover: the
  second step is always something you will do later.
*/
import { nextTick, onMounted, ref } from 'vue'
import { coverStyle } from '../core/fileio.js'
import { pickMedia } from '../core/media.js'

const props = defineProps({
  heading: { type: String, required: true },
  nameLabel: { type: String, default: 'Title' },
  placeholder: { type: String, default: '' },

  // { key, label, cta, kind: 'image' | 'video' }
  slots: { type: Array, default: () => [] },
})

const emit = defineEmits(['close', 'create'])

const first = ref(null)
const busy = ref(null)
const failed = ref(null)
const draft = ref({ title: '', ...Object.fromEntries(props.slots.map((s) => [s.key, ''])) })

onMounted(() => nextTick(() => first.value?.focus()))

// A film has no thumbnail worth showing before it is uploaded, and asking the
// browser to decode one just to fill a 54px box is not worth the wait — so a
// video slot shows that something is there rather than what.
const swatch = (slot) => {
  const v = draft.value[slot.key]
  if (!v) return {}
  return slot.kind === 'video' ? {} : coverStyle(v)
}

async function upload(slot) {
  failed.value = null
  busy.value = slot.key
  try {
    const url = await pickMedia({ kind: slot.kind })
    if (url) draft.value[slot.key] = url
  } catch (e) {
    failed.value = e.message
  } finally {
    busy.value = null
  }
}

function submit() {
  const title = draft.value.title.trim()
  if (!title) return

  // Empty slots are left out rather than sent as empty strings: "not set" and
  // "set to nothing" are the same thing to a reader and different things to a
  // patch, and only one of them is meant here.
  const extra = {}
  for (const slot of props.slots) {
    if (draft.value[slot.key]) extra[slot.key] = draft.value[slot.key]
  }

  emit('create', { title, ...extra })
}
</script>

<style scoped>
.sheet {
  position: absolute; inset: 0; background: rgba(0, 0, 0, 0.45); z-index: 10;
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.form {
  width: min(420px, 100%); background: var(--panel); border: 1px solid var(--line);
  border-radius: 14px; padding: 18px; display: flex; flex-direction: column; gap: 14px;
}
.form h2 { margin: 0; font-size: 16px; }
.field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--muted); }
.field input {
  background: var(--bg); border: 1px solid var(--line); border-radius: 8px;
  padding: 9px 10px; color: var(--text); font: inherit; font-size: 13px;
}
.pick { display: flex; align-items: center; gap: 8px; }
.swatch {
  width: 54px; height: 34px; border-radius: 6px; border: 1px solid var(--line);
  background-size: cover; background-position: center; flex: none;
}
.swatch.film { border-style: dashed; }
.row { display: flex; gap: 8px; justify-content: flex-end; }
.bad { margin: 0; font-size: 12px; color: #d98a6a; }
</style>
