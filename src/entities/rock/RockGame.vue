<script setup>
defineProps({
  instance: { type: Object, required: true },
})

function pointsToSvg(points) {
  return points.map((p) => `${p.x},${p.y}`).join(' ')
}
</script>

<template>
  <polygon
    :points="pointsToSvg(instance.state.points)"
    :fill="instance.state.color || '#6b5b45'"
    stroke="#4a3f30"
    stroke-width="2"
  />
</template>
