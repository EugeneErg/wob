export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
export const lerp = (a, b, t) => a + (b - a) * t
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

export function closestOnSegment(px, py, ax, ay, bx, by) {
  return closestOnSegmentInto({ x: 0, y: 0, t: 0 }, px, py, ax, ay, bx, by)
}

// То же самое, но в готовый объект. В горячих циклах контакта таких вызовов
// десятки тысяч за кадр, и создание объекта там дороже всей арифметики.
export function closestOnSegmentInto(out, px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 ? clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1) : 0
  out.x = ax + dx * t; out.y = ay + dy * t; out.t = t
  return out
}

export function pointInPoly(x, y, pts) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) inside = !inside
  }
  return inside
}

export function distToPolyline(x, y, pts, closed = false) {
  let best = Infinity
  const n = pts.length
  const last = closed ? n : n - 1
  for (let i = 0; i < last; i++) {
    const a = pts[i], b = pts[(i + 1) % n]
    const q = closestOnSegment(x, y, a[0], a[1], b[0], b[1])
    best = Math.min(best, Math.hypot(x - q.x, y - q.y))
  }
  return best
}

export function bboxOfPoints(pts) {
  if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function rectsIntersect(a, b) {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y)
}

export function pointInRect(x, y, r) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
}

// Индекс ребра ломаной, ближайшего к точке — нужен сущностям для вставки вершин
export function nearestEdgeIndex(x, y, pts, closed = false) {
  let best = 0, bestD = Infinity
  const n = pts.length
  const last = closed ? n : n - 1
  for (let i = 0; i < last; i++) {
    const a = pts[i], b = pts[(i + 1) % n]
    const q = closestOnSegment(x, y, a[0], a[1], b[0], b[1])
    const d = Math.hypot(x - q.x, y - q.y)
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

// Область может быть с дырками: мультиполигон — список полигонов,
// у каждого первое кольцо внешнее, остальные — дырки.
export function insideRegion(x, y, polys) {
  for (const poly of polys) {
    if (!pointInPoly(x, y, poly[0])) continue
    let hole = false
    for (let i = 1; i < poly.length; i++) if (pointInPoly(x, y, poly[i])) { hole = true; break }
    if (!hole) return true
  }
  return false
}

export const ringsOf = (polys) => polys.flat()

export function bboxOfRings(rings) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const r of rings) for (const [x, y] of r) {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
