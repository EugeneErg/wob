<script setup>
defineProps({
  instance: { type: Object, required: true },
})
</script>

<template>
  <g>
    <line
      :x1="instance.state.from.x"
      :y1="instance.state.from.y"
      :x2="instance.state.to.x"
      :y2="instance.state.to.y"
      stroke="#495057"
      :stroke-width="instance.state.width"
      stroke-linecap="round"
    />
    <circle :cx="instance.state.from.x" :cy="instance.state.from.y" r="10" fill="#212529" />
  </g>
</template>
