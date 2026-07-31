<script setup>
import { ref } from 'vue'
import { createLevel } from './core/Level.js'
import LevelEditor from './components/LevelEditor.vue'
import GameCanvas from './components/GameCanvas.vue'

const level = createLevel()

// небольшой стартовый уровень, чтобы сразу было что смотреть/тестировать
level.addEntity('rock', { x: 480, y: 480 })
level.addEntity('ball', { x: 250, y: 100 })

const mode = ref('editor') // 'editor' | 'play'
</script>

<template>
  <div class="app">
    <header class="app-bar">
      <h1>Verlet Goo</h1>
      <div class="mode-switch">
        <button :class="{ active: mode === 'editor' }" @click="mode = 'editor'">Редактор</button>
        <button :class="{ active: mode === 'play' }" @click="mode = 'play'">Играть</button>
      </div>
    </header>
    <main class="stage">
      <LevelEditor v-if="mode === 'editor'" :level="level" />
      <GameCanvas v-else :level="level" />
    </main>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
.app-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: #111;
  color: #fff;
}
.app-bar h1 {
  font-size: 16px;
  margin: 0;
}
.mode-switch button {
  padding: 6px 14px;
  margin-left: 6px;
  border: 1px solid #444;
  background: #222;
  color: #ccc;
  border-radius: 4px;
  cursor: pointer;
}
.mode-switch button.active {
  background: #4285f4;
  color: #fff;
  border-color: #4285f4;
}
.stage {
  flex: 1;
  min-height: 0;
}
</style>
