<template>
  <section class="pick">
    <h3>{{ title }}</h3>
    <div class="row">
      <button class="btn primary" @click="$emit('pick', true)">
        Speedrun<i>{{ srNote }}</i>
      </button>
      <button class="btn" @click="$emit('pick', false)">
        Play through<i>{{ plainNote }}</i>
      </button>
    </div>
    <p v-if="note" class="note-pick">{{ note }}</p>
  </section>
</template>

<script setup>
// The mode is asked about at every depth, but only where there is something to
// choose. A speedrun is inherited downwards: once a story speedrun has begun,
// the chapters and levels inside are already being run and there is nothing to
// ask. Ordinary play is not inherited downwards — inside it you may decide to
// speedrun one chapter or one level, and that is a legitimate contest of its
// own.
defineProps({
  title: { type: String, required: true },
  srNote: { type: String, default: 'in one go, no saves and no rewinds' },
  plainNote: { type: String, default: 'saved as you go, come back whenever' },
  note: { type: String, default: '' },
})
defineEmits(['pick'])
</script>

<style scoped>
.pick {
  margin: 0 clamp(16px, 4vw, 44px) 18px; padding: 16px 18px;
  border: 1px solid var(--line); border-radius: 14px; background: var(--panel);
}
.pick h3 { margin: 0 0 12px; font-family: var(--font-display); font-size: 20px; }
.row { display: flex; gap: 10px; flex-wrap: wrap; }
.btn i {
  display: block; font-style: normal; font-family: var(--font-mono);
  font-size: 10.5px; opacity: 0.75; margin-top: 3px;
}
.note-pick { margin: 12px 0 0; font-size: 12px; color: var(--muted); line-height: 1.45; }
</style>
