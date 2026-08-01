<template>
  <div class="menu">
    <WorldCanvas class="bg" :level="demo" />
    <div class="veil" />
    <div class="content">
      <p class="eyebrow">Верле-физика · SVG · Vue</p>
      <h1 class="title">GOO</h1>
      <p class="lede">Стройте башни из живых шаров и доведите их до трубы.<br />Шары в фоне тоже можно таскать.</p>
      <nav class="actions">
        <button class="btn primary" @click="$emit('go', 'play')">Играть</button>
        <button class="btn" @click="$emit('go', 'editor')">Редактор уровней</button>
      </nav>
    </div>
  </div>
</template>

<script setup>
import WorldCanvas from '../components/WorldCanvas.vue'
defineEmits(['go'])

const ball = (x, y) => ({
  type: 'game-ball',
  data: { x, y, r: 13, mass: 1, minLinks: 2, maxLinks: 3, range: 165, jump: 470, color: '#e2704a', linkColor: '#f0b48c' },
})

const demo = {
  id: 'menu', name: 'menu', width: 1600, height: 900,
  gravity: { x: 0, y: 1800 }, goal: 99,
  entities: [
    { type: 'terrain', data: { points: [[0, 800], [1600, 800], [1600, 900], [0, 900]], smoothness: 0.35, fill: '#232e20', edge: '#4d6338' } },
    { type: 'system-ball', data: { x: 1180, y: 783, r: 17, static: true, color: '#d8cbb0' } },
    { type: 'system-ball', data: { x: 1290, y: 783, r: 17, static: true, color: '#d8cbb0' } },
    { type: 'pipe', data: { points: [[1240, 330], [1240, 150], [1580, 150]], radius: 30, power: 1, color: '#4c93c4', inner: '#0d1a24' } },
    ...[980, 1030, 1080, 1000, 1050, 1100, 1400, 1450, 1350].map((x, i) => ball(x, 700 - (i % 3) * 40)),
  ],
}
</script>

<style scoped>
.menu { position: absolute; inset: 0; overflow: hidden; }
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
