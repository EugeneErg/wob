<script setup>
const props = defineProps({
  instance: { type: Object, required: true },
  active: { type: Boolean, default: false },
})
const emit = defineEmits(['select', 'endpoint-drag'])

function isSelected(end) {
  return props.instance.state._selectedEndpoint === end
}
</script>

<template>
  <g @pointerdown="emit('select', instance.id)">
    <line
      :x1="instance.state.from.x"
      :y1="instance.state.from.y"
      :x2="instance.state.to.x"
      :y2="instance.state.to.y"
      :stroke="active ? '#ffd166' : '#495057'"
      :stroke-width="instance.state.width"
      stroke-linecap="round"
    />
    <template v-if="active">
      <circle
        v-for="end in ['from', 'to']"
        :key="end"
        :cx="instance.state[end].x"
        :cy="instance.state[end].y"
        r="9"
        :fill="isSelected(end) ? '#ffd166' : '#ffffff'"
        stroke="#212529"
        stroke-width="1.5"
        style="cursor: grab"
        @pointerdown.stop="emit('endpoint-drag', { instanceId: instance.id, end })"
      />
    </template>
  </g>
</template>
