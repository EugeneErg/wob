<template>
  <section class="pick">
    <h3>{{ title }}</h3>
    <div class="row">
      <button class="btn primary" @click="$emit('pick', true)">
        Спидран<i>{{ srNote }}</i>
      </button>
      <button class="btn" @click="$emit('pick', false)">
        Прохождение<i>{{ plainNote }}</i>
      </button>
    </div>
    <p v-if="note" class="note-pick">{{ note }}</p>
  </section>
</template>

<script setup>
// Выбор режима спрашивают на каждом уровне вложенности, но только когда есть
// что выбирать. Спидран наследуется вниз: начал спидран истории — главы и
// уровни внутри уже спидранятся, переспрашивать нечего. Обычное прохождение
// вниз не наследуется: внутри него можно взяться спидранить отдельную главу
// или отдельный уровень, и это законное самостоятельное состязание.
defineProps({
  title: { type: String, required: true },
  srNote: { type: String, default: 'подряд, без сохранений и откатов' },
  plainNote: { type: String, default: 'сохраняется, можно вернуться позже' },
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
