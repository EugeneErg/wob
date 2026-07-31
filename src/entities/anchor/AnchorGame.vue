<script setup>
defineProps({
  instance: { type: Object, required: true },
})
</script>

<template>
  <g>
    <circle
      :cx="instance.points[0].x"
      :cy="instance.points[0].y"
      :r="instance.state.radius"
      :fill="instance.state.color"
      stroke="#4c1d95"
      stroke-width="2"
    />
    <!-- Крестик внутри -->
    <line
      :x1="instance.points[0].x - instance.state.radius * 0.5"
      :y1="instance.points[0].y"
      :x2="instance.points[0].x + instance.state.radius * 0.5"
      :y2="instance.points[0].y"
      stroke="#4c1d95"
      stroke-width="2"
    />
    <line
      :x1="instance.points[0].x"
      :y1="instance.points[0].y - instance.state.radius * 0.5"
      :x2="instance.points[0].x"
      :y2="instance.points[0].y + instance.state.radius * 0.5"
      stroke="#4c1d95"
      stroke-width="2"
    />
  </g>
</template>
