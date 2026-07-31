<script setup>
import { ref } from 'vue'
import { createLevel } from './core/Level.js'
import LevelEditor from './components/LevelEditor.vue'
import GameCanvas from './components/GameCanvas.vue'

const level = createLevel()

level.addEntity('rock', { x: 480, y: 480 })
level.addEntity('ball', { x: 250, y: 100 })
level.addEntity('anchor', { x: 480, y: 200, pinned: true })
level.updateAllBondCounts()

const mode = ref('editor')
const snapshot = ref(null)

function saveSnapshot() {
  snapshot.value = level.state.entities.map(e => {
    const snap = { id: e.id, type: e.type }
    if (e.points) {
      snap.points = e.points.map(p => ({ x: p.x, y: p.y, oldX: p.oldX, oldY: p.oldY }))
    }
    if (e.state?.points) {
      snap.statePoints = e.state.points.map(p => ({ x: p.x, y: p.y }))
    }
    if (e.state?.from) snap.from = { ...e.state.from }
    if (e.state?.to) snap.to = { ...e.state.to }
    return snap
  })
}

function restoreSnapshot() {
  if (!snapshot.value) return
  for (const snap of snapshot.value) {
    const inst = level.getInstance(snap.id)
    if (!inst) continue
    if (snap.points && inst.points) {
      inst.points.forEach((p, i) => {
        if (snap.points[i]) {
          p.x = snap.points[i].x
          p.y = snap.points[i].y
          p.oldX = snap.points[i].oldX
          p.oldY = snap.points[i].oldY
        }
      })
    }
    if (snap.statePoints && inst.state?.points) {
      inst.state.points = snap.statePoints.map(p => ({ x: p.x, y: p.y }))
      if (inst.collisionShape) inst.collisionShape.points = inst.state.points
    }
    if (snap.from && inst.state?.from) {
      inst.state.from = { ...snap.from }
      inst.state.to = { ...snap.to }
    }
  }
  snapshot.value = null
}

function setMode(newMode) {
  if (newMode === 'play') {
    saveSnapshot()
  } else if (newMode === 'editor') {
    restoreSnapshot()
  }
  mode.value = newMode
}
</script>

<template>
  <div class="app">
    <header class="app-bar">
      <h1>Verlet Goo</h1>
      <div class="mode-switch">
        <button :class="{ active: mode === 'editor' }" @click="setMode('editor')">Редактор</button>
        <button :class="{ active: mode === 'play' }" @click="setMode('play')">Играть</button>
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
  flex-shrink: 0;
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
  display: flex;
}
</style>
