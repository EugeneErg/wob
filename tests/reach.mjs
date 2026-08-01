import '../src/entities/index.js'
import { World } from '../src/core/world.js'

// конструкция висит над землёй на разной высоте — шары должны пытаться допрыгнуть
function trial(h) {
  const y = 780 - h
  const lvl = { width: 1600, height: 900, gravity: { x: 0, y: 1800 }, entities: [
    { id: 'g', type: 'terrain', data: { points: [[0, 780], [1600, 780], [1600, 900], [0, 900]], smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } },
    { id: 's1', type: 'system-ball', data: { x: 760, y, r: 17, static: true, links: ['s2'], color: '#d8cbb0', linkColor: '#b9ae95' } },
    { id: 's2', type: 'system-ball', data: { x: 840, y, r: 17, static: true, links: ['s1'], color: '#d8cbb0', linkColor: '#b9ae95' } },
    ...[200, 260, 320].map((x, i) => ({ id: 'b' + i, type: 'game-ball', data: { x, y: 760, r: 13, mass: 1, minLinks: 2, maxLinks: 3, range: 165, jump: 470, speed: 95, dropMax: 190, color: '#e2704a', linkColor: '#f0b48c' } })),
  ] }
  const w = new World(lvl)
  const balls = () => w.instances.filter((q) => q.type === 'game-ball')
  let jumps = 0, prev = balls().map((b) => b.rt.p.y)
  for (let i = 0; i < 60 * 14; i++) {
    w.step(1 / 60)
    balls().forEach((b, k) => {
      const up = prev[k] - b.rt.p.y
      if (up > 18 && b.rt.state === 'free') { jumps++; prev[k] = b.rt.p.y } else prev[k] = Math.max(prev[k], b.rt.p.y)
    })
  }
  const st = balls().map((b) => b.rt.state)
  const xs = balls().map((b) => b.rt.p.x.toFixed(0))
  return `высота ${String(h).padStart(3)} px: прыжков ${String(jumps).padStart(3)}, состояния ${st.join(',')}, x ${xs.join(',')}`
}
for (const h of [0, 40, 80, 200]) console.log(trial(h))
