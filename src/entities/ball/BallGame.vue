<script setup>
// Связи между шарами — межсущностная концепция (см. GlobalProperties.BONDABLE),
// поэтому рисуются на уровне GameCanvas/LevelEditor, а не здесь.
// Сам шар отвечает только за собственный внешний вид.
defineProps({
  instance: { type: Object, required: true },
})
</script>

<template>
  <circle
    :cx="instance.points[0].x"
    :cy="instance.points[0].y"
    :r="instance.state.radius"
    :fill="instance.state.color"
    stroke="#222"
    stroke-width="2"
  />
</template>
