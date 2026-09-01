import { h } from 'vue'

// Entities hand back a description of shapes rather than Vue components, so
// they can be serialised and one day fetched from the server.

const ptsStr = (pts) => pts.map((p) => `${p[0]},${p[1]}`).join(' ')

const common = (s) => ({
  fill: s.fill ?? 'none',
  stroke: s.stroke ?? undefined,
  'stroke-width': s.sw ?? undefined,
  'stroke-linecap': s.cap ?? undefined,
  'stroke-linejoin': s.join ?? undefined,
  'stroke-dasharray': s.dash ?? undefined,
  'fill-rule': s.fillRule ?? undefined,
  opacity: s.opacity ?? undefined,
  class: s.class || undefined,
})

function draw(s, i) {
  if (!s) return null
  switch (s.k) {
    case 'circle':
      return h('circle', { key: i, cx: s.x, cy: s.y, r: s.r, ...common(s) })
    case 'ellipse':
      return h('ellipse', { key: i, cx: s.x, cy: s.y, rx: s.rx, ry: s.ry, ...common(s) })
    case 'poly':
      return h(s.closed ? 'polygon' : 'polyline', { key: i, points: ptsStr(s.pts), ...common(s) })
    case 'line':
      return h('line', { key: i, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, ...common(s) })
    case 'rect':
      return h('rect', { key: i, x: s.x, y: s.y, width: s.w, height: s.h, rx: s.rx, ...common(s) })
    case 'path':
      return h('path', { key: i, d: s.d, ...common(s) })
    case 'text':
      return h('text', {
        key: i, x: s.x, y: s.y,
        'font-size': s.size ?? 16,
        'text-anchor': s.anchor ?? 'middle',
        fill: s.fill ?? '#fff',
        class: s.class,
      }, s.text)
    case 'g':
      return h('g', { key: i, ...common(s) }, (s.items || []).map(draw))
    default:
      return null
  }
}

export default {
  name: 'SvgScene',
  props: { shapes: { type: Array, default: () => [] } },
  render() {
    return this.shapes.map(draw)
  },
}
