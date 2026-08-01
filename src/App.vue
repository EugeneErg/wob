<template>
  <MainMenu v-if="screen === 'menu'" @go="go" />
  <LevelPicker v-else-if="screen === 'play'" mode="play" @back="screen = 'menu'" @open="startGame" />
  <LevelPicker v-else-if="screen === 'editor'" mode="edit" @back="screen = 'menu'" @open="openEditor" />
  <GameView v-else-if="screen === 'game'" :level="current" @back="screen = 'play'" />
  <EditorView v-else-if="screen === 'edit-level'" :level-id="currentId" @back="screen = 'editor'" />
</template>

<script setup>
import { ref, shallowRef } from 'vue'
import MainMenu from './views/MainMenu.vue'
import LevelPicker from './views/LevelPicker.vue'
import GameView from './views/GameView.vue'
import EditorView from './views/EditorView.vue'
import { getLevel } from './core/levels.js'

const screen = ref('menu')
const current = shallowRef(null)
const currentId = ref(null)

const go = (s) => (screen.value = s)
function startGame(id) { current.value = getLevel(id); screen.value = 'game' }
function openEditor(id) { currentId.value = id; screen.value = 'edit-level' }
</script>
