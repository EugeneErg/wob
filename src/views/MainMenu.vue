<template>
  <div class="menu">
    <WorldCanvas class="bg" :level="demo" />
    <div class="veil" />
    <div class="content">
      <p class="eyebrow">Верле-физика · SVG · Vue</p>
      <h1 class="title">GOO</h1>
      <p class="lede">Истории из глав, главы из уровней.<br />Шары в фоне тоже можно таскать.</p>
      <!-- Режим выбирается на входе, а не где-то внутри: с ним и заходим.
           Спидран отсюда накрывает всё, что откроем дальше, — историю, её
           главы и уровни; они переспрашивать не станут. Прохождение вниз не
           наследуется: внутри него можно взяться спидранить отдельную главу
           или уровень. -->
      <nav class="actions">
        <button class="btn primary" @click="$emit('go', 'play')">
          Прохождение<i>спокойно, с сохранением</i>
        </button>
        <button class="btn primary sr" @click="$emit('go', 'speedrun')">
          Спидран<i>на время, подряд, без сохранений</i>
        </button>
        <button class="btn" @click="$emit('go', 'editor')">Редактор историй</button>
      </nav>

      <!-- Частота отрисовки. Стоит в меню, а не только на паузе: задать её
           хочется до начала попытки, а не посреди неё. На результат она не
           влияет — симуляция идёт фиксированными тиками. -->
      <label class="fps">
        <span>Кадров в секунду</span>
        <select :value="fpsCap" @change="setFps(+$event.target.value)">
          <option v-for="f in FPS_OPTIONS" :key="f" :value="f">{{ fpsLabel(f) }}</option>
        </select>
        <i>симуляция всегда 60 тиков в секунду — результат от этого не зависит</i>
      </label>
    </div>
  </div>
</template>

<script setup>
import WorldCanvas from '../components/WorldCanvas.vue'
import { ref } from 'vue'
import demo from '../levels/menu.json'   // фон меню — обычный уровень
import { settings, setSetting, FPS_OPTIONS, fpsLabel } from '../core/settings.js'
defineEmits(['go'])

const fpsCap = ref(settings().fpsCap)
const setFps = (v) => { fpsCap.value = v; setSetting('fpsCap', v) }

</script>

<style scoped>
.menu { position: absolute; inset: 0; overflow: hidden; }
.actions .btn i {
  display: block; font-style: normal; font-family: var(--font-mono);
  font-size: 10px; opacity: 0.75; margin-top: 3px;
}
.actions .sr { background: #8c5a2c; border-color: #a86c34; }
.fps { display: block; margin-top: 6px; font-size: 12px; color: var(--muted); }
.fps span { display: block; margin-bottom: 5px; }
.fps select {
  font: inherit; font-size: 12px; padding: 6px 10px; min-width: 160px;
  background: rgba(16, 26, 32, 0.9); color: var(--text);
  border: 1px solid var(--line); border-radius: 8px;
}
.fps i {
  display: block; margin-top: 6px; font-style: normal;
  font-family: var(--font-mono); font-size: 10px; opacity: 0.7;
}
.bg { position: absolute; inset: 0; }
.veil {
  position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(100deg, var(--ink) 0%, rgba(11, 16, 20, 0.92) 32%, rgba(11, 16, 20, 0) 62%);
}
.content {
  position: relative; height: 100%;
  display: flex; flex-direction: column; justify-content: center;
  gap: 18px; padding: 0 clamp(24px, 7vw, 110px); max-width: 720px;
  pointer-events: none;
}
.content > * { pointer-events: auto; }
.eyebrow {
  font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.28em;
  text-transform: uppercase; color: var(--muted); margin: 0;
}
.title {
  font-family: var(--font-display); font-size: clamp(90px, 19vw, 210px);
  line-height: 0.82; margin: 0; letter-spacing: -0.03em; color: var(--text);
  text-shadow: 0 0 60px rgba(226, 112, 74, 0.25);
}
.title::after {
  content: ''; display: block; width: 96px; height: 6px; margin-top: 26px;
  background: var(--goo); border-radius: 3px;
}
.lede { margin: 0; color: var(--muted); font-size: 17px; line-height: 1.6; max-width: 46ch; }
.actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 10px; }

@media (max-width: 720px) {
  .veil { background: linear-gradient(180deg, var(--ink) 30%, rgba(11, 16, 20, 0.75) 100%); }
}
</style>
