<script setup>
const props = defineProps({
  instance: { type: Object, required: true },
  active: { type: Boolean, default: false }, // true когда мы в контексте этой сущности
})
const emit = defineEmits(['select', 'vertex-drag'])

function pointsToSvg(points) {
  return points.map((p) => `${p.x},${p.y}`).join(' ')
}

function onVertexPointerDown(index, e) {
  e.stopPropagation()
  emit('vertex-drag', { instanceId: props.instance.id, index })
}

function isSelected(index) {
  return props.instance.state._selectedVertices?.includes(index)
}
</script>

<template>
  <g @pointerdown="emit('select', instance.id)">
    <polygon
      :points="pointsToSvg(instance.state.points)"
      :fill="instance.state.color || '#6b5b45'"
      :stroke="active ? '#ffd166' : '#4a3f30'"
      :stroke-width="active ? 3 : 2"
    />
    <template v-if="active">
      <circle
        v-for="(p, i) in instance.state.points"
        :key="i"
        :cx="p.x"
        :cy="p.y"
        r="7"
        :fill="isSelected(i) ? '#ffd166' : '#ffffff'"
        stroke="#4a3f30"
        stroke-width="1.5"
        style="cursor: grab"
        @pointerdown="onVertexPointerDown(i, $event)"
      />
    </template>
  </g>
</template>
