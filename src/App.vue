<template>
  <MainMenu v-if="at === 'menu'" @go="go" />

  <StoryPicker
    v-else-if="at === 'stories'"
    :mode="mode" @back="at = 'menu'" @open="openStory"
  />
  <ChapterList
    v-else-if="at === 'chapters'"
    :mode="mode" :story-id="storyId" @back="at = 'stories'" @open="openChapter"
  />
  <ChapterMap
    v-else-if="at === 'map'"
    :mode="mode" :chapter-id="chapterId"
    @back="at = 'chapters'" @play="play" @edit="editLevel"
  />
  <GameView
    v-else-if="at === 'game'"
    :key="levelId" :level="current" @back="at = 'map'"
  />
  <EditorView
    v-else-if="at === 'level'"
    :key="levelId" :level-id="levelId" :chapter-id="chapterId" :story-id="storyId"
    @back="at = 'map'"
  />
</template>

<script setup>
import { ref, shallowRef } from 'vue'
import MainMenu from './views/MainMenu.vue'
import StoryPicker from './views/StoryPicker.vue'
import ChapterList from './views/ChapterList.vue'
import ChapterMap from './views/ChapterMap.vue'
import GameView from './views/GameView.vue'
import EditorView from './views/EditorView.vue'
import { level as getLevel } from './core/library.js'

const at = ref('menu')
const mode = ref('play')
const storyId = ref(null)
const chapterId = ref(null)
const levelId = ref(null)
const current = shallowRef(null)

function go(where) {
  mode.value = where === 'editor' ? 'edit' : 'play'
  at.value = 'stories'
}
function openStory(id) { storyId.value = id; at.value = 'chapters' }
function openChapter(id) { chapterId.value = id; at.value = 'map' }
function play(id) { levelId.value = id; current.value = getLevel(id); at.value = 'game' }
function editLevel(id) { levelId.value = id; at.value = 'level' }
</script>
