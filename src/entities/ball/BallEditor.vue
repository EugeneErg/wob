<script setup>
const props = defineProps({
  instance: { type: Object, required: true },
  active: { type: Boolean, default: false },
})
const emit = defineEmits(['select'])
</script>

<template>
  <circle
    :cx="instance.points[0].x"
    :cy="instance.points[0].y"
    :r="instance.state.radius"
    :fill="instance.state.color"
    :stroke="active ? '#ffd166' : '#222'"
    :stroke-width="active ? 4 : 2"
    style="cursor: pointer"
    @pointerdown.stop="emit('select', instance.id)"
  />
</template>
