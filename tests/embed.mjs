import '../src/entities/index.js'
import { World } from '../src/core/world.js'
const ground = { id: 'g', type: 'terrain', data: { points: [[0, 780], [1600, 780], [1600, 900], [0, 900]], smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } }
const slab = { id: 'slab', type: 'object', data: { points: [[500, 700], [800, 700], [800, 760], [500, 760]], mass: 4, smoothness: 0.4, restitution: 0.1, static: false, fill: '#5c5346', edge: '#8d7f68' } }
for (const [x, y] of [[540, 715], [650, 715], [790, 750], [520, 755]]) {
  const w = new World({ width: 1600, height: 900, gravity: { x: 0, y: 1800 }, entities: [ground, slab,
    { id: 'sb', parent: 'slab', type: 'system-ball', data: { x, y, r: 17, static: true, links: [], color: '#d8cbb0', linkColor: '#b9ae95' } }] })
  const verts = () => w.instances.find((i) => i.type === 'object').rt.verts
  let peak = 0
  for (let i = 0; i < 60 * 6; i++) { w.step(1 / 60); peak = Math.max(peak, ...verts().map((p) => Math.hypot(p.x - p.px, p.y - p.py) * 120)) }
  const v = verts()
  console.log(`шар в (${x},${y}): пик ${peak.toFixed(0)} px/с, центр плиты y=${(v.reduce((a, p) => a + p.y, 0) / 4).toFixed(0)}`)
}
