// Прогон обоих стендов в одном процессе: тот же уровень, те же коэффициенты,
// тот же порядок замера. Отличие от страниц одно — вместо записи пути в
// разметку контур просто строится и отбрасывается. Значит «отрисовка» здесь —
// это marching squares без DOM, и сравнивать её между стендами можно, а с
// браузером нельзя.

import './src/entities/index.js'
import { World } from './src/core/world.js'
import { FluidSolver, SurfaceMesher, bulkFieldValue } from './ref-core.js'
import { BENCH, PX, buildLevelWob, Recorder } from './bench-common.js'

const B = BENCH, S = B.solver

// ---------------------------------------------------------------- движок ----
function makeWob() {
  const world = new World(buildLevelWob())
  const drops = () => world.physics.points.filter((p) => p.owner === 'water' && !p.removed)
  return {
    name: 'wob',
    step: () => world.step(B.dt),
    draw: () => world.scene(),
    count: () => drops().length,
    sample() {
      const d = drops()
      let ke = 0, vmax = 0, top = Infinity, sy = 0
      const cols = new Map()
      for (const p of d) {
        const v2 = p.vx * p.vx + p.vy * p.vy
        ke += v2; if (v2 > vmax) vmax = v2
        if (p.y < top) top = p.y
        sy += p.y
        const c = Math.floor(p.x / 40), cur = cols.get(c)
        if (cur === undefined || p.y < cur) cols.set(c, p.y)
      }
      const hs = [...cols.values()]
      return {
        n: d.length,
        vRms: Math.sqrt(ke / Math.max(1, d.length)),
        vMax: Math.sqrt(vmax),
        yMean: sy / Math.max(1, d.length),
        yTop: top,
        flat: hs.length ? Math.max(...hs) - Math.min(...hs) : 0,
      }
    },
  }
}

// -------------------------------------------------------------- исходник ----
function makeRef() {
  const m = (px) => px / PX
  const SP = m(B.grain), G = B.gravity / PX
  const sim = new FluidSolver({
    maxParticles: 20000, h: SP * 2.6, spacing: SP, width: m(B.W), height: m(B.H),
  })
  sim.gx = 0; sim.gy = G
  Object.assign(sim, {
    iters: S.iters, omega: S.omega, relax: S.relax, tension: S.tension,
    tensile: S.tensile, viscosity: S.viscosity, cohesion: S.cohesionG * G,
    adhesion: S.adhesionG * G, film: S.film, vorticity: S.vorticity,
    friction: S.friction, surfLevel: S.surfLevel,
  })
  const boxOf = (x0, y0, x1, y1) => ({
    k: 'box', kind: 'static', a: 0,
    x: m((x0 + x1) / 2), y: m((y0 + y1) / 2),
    hw: m((x1 - x0) / 2), hh: m((y1 - y0) / 2), vx: 0, vy: 0,
  })
  const w = B.wall
  sim.colliders = [
    boxOf(0, 0, B.W, w), boxOf(0, B.H - w, B.W, B.H),
    boxOf(0, w, w, B.H - w), boxOf(B.W - w, w, B.W, B.H - w),
    boxOf(B.sand.x, B.sand.y, B.sand.x + B.sand.w, B.sand.y + B.sand.h),
  ]
  const d = SP, dy = d * Math.sqrt(3) / 2
  const solid = (x, y) => sim.colliders.some((c) => Math.abs(x - c.x) <= c.hw && Math.abs(y - c.y) <= c.hh)
  let row = 0
  for (let y = m(B.water.y); y <= m(B.water.y + B.water.h) && sim.n < B.particles; y += dy, row++) {
    for (let x = m(B.water.x) + (row & 1 ? d * 0.5 : 0); x <= m(B.water.x + B.water.w); x += d) {
      if (sim.n >= B.particles) break
      if (solid(x, y)) continue
      sim.addParticle(x + (Math.random() - 0.5) * d * 0.1, y, 0, 0, 0, S.rest0)
    }
  }
  const mesher = new SurfaceMesher(m(B.W), m(B.H), SP * 0.45, PX)
  const splatR = S.blob * SP
  const iso = S.iso * bulkFieldValue(splatR, SP)
  return {
    name: 'ref',
    step: () => sim.step(B.dt, S.substeps),
    draw: () => { if (mesher.splat(sim, 0, splatR)) mesher.contour(iso, S.smooth) },
    count: () => sim.n,
    sample() {
      const n = sim.n
      let ke = 0, vmax = 0, top = Infinity, sy = 0
      const cols = new Map()
      for (let i = 0; i < n; i++) {
        const vx = sim.vx[i] * PX, vy = sim.vy[i] * PX
        const v2 = vx * vx + vy * vy
        ke += v2; if (v2 > vmax) vmax = v2
        const y = sim.y[i] * PX, x = sim.x[i] * PX
        if (y < top) top = y
        sy += y
        const c = Math.floor(x / 40), cur = cols.get(c)
        if (cur === undefined || y < cur) cols.set(c, y)
      }
      const hs = [...cols.values()]
      return {
        n, vRms: Math.sqrt(ke / Math.max(1, n)), vMax: Math.sqrt(vmax),
        yMean: sy / Math.max(1, n), yTop: top,
        flat: hs.length ? Math.max(...hs) - Math.min(...hs) : 0,
      }
    },
  }
}

// ------------------------------------------------------------------ бег ----
function run(mk) {
  const t = mk()
  for (let i = 0; i < B.warmup; i++) t.step()
  const rec = new Recorder(t.name, B)
  for (let f = 0; f < B.frames; f++) {
    const a = performance.now(); t.step()
    const b = performance.now(); t.draw()
    const c = performance.now()
    rec.tick(b - a, c - b, () => t.sample())
  }
  return rec.report()
}

const order = process.argv[2] === 'ref-first' ? [makeRef, makeWob] : [makeWob, makeRef]
const out = {}
for (const mk of order) { const r = run(mk); out[r.build] = r }

const f = (x, w = 7) => String(x).padStart(w)
console.log(`\nуровень: ${B.W}×${B.H}, порода ${B.wall}, песок ${B.sand.w}×${B.sand.h}, ${B.particles} частиц, шаг ${B.grain}`)
console.log(`замер: ${B.frames} кадров после ${B.warmup} прогревочных\n`)
console.log('                        движок   исходник   отношение')
const rows = [
  ['частиц', (r) => r.behaviour.at(-1).n, 0],
  ['физика, среднее мс', (r) => r.perf.physMean, 2],
  ['физика, медиана', (r) => r.perf.physMed, 2],
  ['физика, 95-й проц.', (r) => r.perf.physP95, 2],
  ['контур, среднее мс', (r) => r.perf.drawMean, 2],
  ['итого мс', (r) => r.perf.totalMean, 2],
  ['кадров в секунду', (r) => r.perf.fps, 1],
]
for (const [name, get, dg] of rows) {
  const a = get(out.wob), b = get(out.ref)
  const rel = b ? (a / b).toFixed(2) + '×' : '—'
  console.log(`${name.padEnd(22)}${f(a.toFixed ? a.toFixed(dg) : a)}${f(b.toFixed ? b.toFixed(dg) : b)}${f(rel, 11)}`)
}

console.log('\nповедение (последняя выборка):')
const bw = out.wob.behaviour.at(-1), br = out.ref.behaviour.at(-1)
for (const k of ['vRms', 'vMax', 'yMean', 'yTop', 'flat']) {
  console.log(`${k.padEnd(22)}${f(bw[k])}${f(br[k])}`)
}

console.log('\nуровень воды по времени (yTop, px):')
console.log('  сек   движок  исходник')
for (let i = 0; i < out.wob.behaviour.length; i += 4) {
  const a = out.wob.behaviour[i], b = out.ref.behaviour[i]
  if (!a || !b) break
  console.log(`${f(a.t, 5)}${f(a.yTop)}${f(b.yTop)}`)
}

import { writeFileSync } from 'node:fs'
writeFileSync('bench-wob.json', JSON.stringify(out.wob, null, 1))
writeFileSync('bench-ref.json', JSON.stringify(out.ref, null, 1))
console.log('\nотчёты: bench-wob.json, bench-ref.json')
