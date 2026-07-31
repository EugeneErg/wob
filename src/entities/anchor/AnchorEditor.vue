<script setup>
const props = defineProps({
  instance: { type: Object, required: true },
  active: { type: Boolean, default: false },
})
const emit = defineEmits(['select'])
</script>

<template>
  <g @pointerdown.stop="emit('select', instance.id)">
    <circle
      :cx="instance.points[0].x"
      :cy="instance.points[0].y"
      :r="instance.state.radius"
      :fill="instance.state.color"
      :stroke="active ? '#ffd166' : '#4c1d95'"
      :stroke-width="active ? 4 : 2"
    />
    <line
      :x1="instance.points[0].x - instance.state.radius * 0.5"
      :y1="instance.points[0].y"
      :x2="instance.points[0].x + instance.state.radius * 0.5"
      :y2="instance.points[0].y"
      :stroke="active ? '#ffd166' : '#4c1d95'"
      stroke-width="2"
    />
    <line
      :x1="instance.points[0].x"
      :y1="instance.points[0].y - instance.state.radius * 0.5"
      :x2="instance.points[0].x"
      :y2="instance.points[0].y + instance.state.radius * 0.5"
      :stroke="active ? '#ffd166' : '#4c1d95'"
      stroke-width="2"
    />
  </g>
</template>
