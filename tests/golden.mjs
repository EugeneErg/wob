// Эталонные отпечатки: сторож против забытой версии правил.
//
// Записи хранят не состояние мира, а сид и ввод, и это работает ровно до тех
// пор, пока одинаковый ввод даёт одинаковый мир. Любая правка физики или
// поведения сущностей это ломает: прошлогодний рекорд начинает проигрываться
// иначе, а выглядит по-прежнему безупречно.
//
// Защита от этого — RULES_VERSION в releases.js: записи помнят, при какой
// версии сняты, и чужую версию мы не пускаем в общую таблицу. Но версию
// поднимает человек, а человек забудет. Забудет не со зла: правка в solver.js
// не выглядит как «сегодня я обесценил все рекорды».
//
// Поэтому здесь эталон. Отпечатки нескольких прогонов лежат в golden.json
// рядом с номером версии правил. Если отпечаток изменился, а версия — нет,
// проверка падает и говорит, что нужно сделать. Забыть больше нельзя.
//
// Обновить эталон осознанно:  node tests/golden.mjs --update

import { readFileSync, writeFileSync } from 'fs'
import '../src/entities/index.js'
import { Run, PLAY } from '../src/core/run.js'
import { RULES_VERSION } from '../src/core/releases.js'
import { level } from './level.mjs'
import { check } from './assert.mjs'

const FILE = new URL('./golden.json', import.meta.url)

const wall = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
const terr = (id, x0, y0, x1, y1) => ({
  id, type: 'terrain',
  data: { points: wall(x0, y0, x1, y1), smoothness: 0.35, fill: '#2a3326', edge: '#66804f' },
})

// Уровни подобраны так, чтобы задеть разные части движка: связи и контакты,
// текучую среду, вычитаемую область, поле притяжения. Правка любой из них
// сдвинет хотя бы один отпечаток.
const water = {
  id: 'эталон-вода', width: 1200, height: 800, gravity: { x: 0, y: 1800 }, goal: 1,
  entities: [
    terr('floor', 0, 700, 1200, 800), terr('left', 300, 380, 340, 700), terr('right', 860, 380, 900, 700),
    {
      id: 'w', type: 'liquid',
      data: {
        points: [[345, 400], [855, 400], [855, 600], [345, 600]], polys: null,
        substance: 'water', density: 1, viscosity: 0.05, tension: 3.06, grain: 16, limit: 400,
      },
    },
  ],
}

const sand = {
  id: 'эталон-песок', width: 1000, height: 700, gravity: { x: 0, y: 1800 }, goal: 1,
  entities: [
    terr('floor', 0, 600, 1000, 700),
    {
      id: 's', type: 'sand',
      data: {
        points: [[295, 320], [705, 320], [705, 520], [295, 520]], polys: null,
        dig: 22, smoothness: 0.25, fill: '#c9a86a', edge: '#8a6f3e',
      },
    },
    { id: 'b', type: 'system-ball', data: { x: 500, y: 200, r: 17, static: false, links: [], color: '#d8cbb0', linkColor: '#b9ae95' } },
  ],
}

// Отпечаток берётся и по частицам, и по областям: песок живёт не в точках,
// а в вычитаемом многоугольнике, и по одним лишь точкам правка копания
// осталась бы незамеченной.
function fingerprint(run) {
  let h = 2166136261
  const put = (s) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } }
  for (const p of run.world.physics.points) {
    put(`${Math.round(p.x * 100)},${Math.round(p.y * 100)},${Math.round(p.vx)},${Math.round(p.vy)}`)
  }
  for (const inst of run.world.instances) {
    const polys = inst.rt?.polys || inst.data?.polys
    if (!polys) continue
    for (const poly of polys) for (const ring of poly) for (const [x, y] of ring) {
      put(`${Math.round(x * 100)},${Math.round(y * 100)}`)
    }
  }
  put(`links:${run.world.physics.links.length}`)
  return (h >>> 0).toString(16)
}

// Ввод задаётся жёстко и не зависит от того, что сейчас в мире: иначе эталон
// менялся бы вместе с уровнем и сторожил бы сам себя.
const scenes = {
  'башня: постройка': () => {
    const run = new Run(level('lvl-tower'), { mode: PLAY, seed: 20260828 })
    const f = (n) => { for (let i = 0; i < n; i++) run.frame(1 / 60) }
    f(60)
    for (const [i, y] of [700, 660, 620].entries()) {
      const b = run.world.instances.filter((x) => x.type === 'game-ball' && x.rt.state === 'free')
        .sort((a, c) => a.rt.p.x - c.rt.p.x)[0]
      if (!b) break
      const x = 745 + (i % 2 ? 26 : -26)
      run.down({ x: b.rt.p.x, y: b.rt.p.y })
      for (let k = 0; k < 20; k++) { run.move({ x, y }); f(1) }
      run.up({ x, y })
      f(60)
    }
    return run
  },
  'орбита: притяжение': () => {
    const run = new Run(level('lvl-orbit'), { mode: PLAY, seed: 7 })
    for (let i = 0; i < 240; i++) run.frame(1 / 60)
    return run
  },
  'вода: растекание': () => {
    const run = new Run(water, { mode: PLAY, seed: 777 })
    for (let i = 0; i < 180; i++) run.frame(1 / 60)
    return run
  },
  'песок: копание': () => {
    const run = new Run(sand, { mode: PLAY, seed: 777 })
    for (let t = 0; t < 180; t++) {
      if (t === 20) run.down({ x: 320, y: 420 })
      else if (t > 20 && t < 140) {
        const k = (t - 20) / 120
        run.move({ x: 320 + 360 * k, y: 420 + 50 * k })
      } else if (t === 140) run.up({ x: 680, y: 470 })
      run.frame(1 / 60)
    }
    return run
  },
}

const now = {}
for (const [name, make] of Object.entries(scenes)) now[name] = fingerprint(make())

const update = process.argv.includes('--update')
if (update) {
  writeFileSync(FILE, `${JSON.stringify({ rules: RULES_VERSION, prints: now }, null, 2)}\n`)
  console.log(`эталон обновлён для версии правил ${RULES_VERSION}:`)
  for (const [k, v] of Object.entries(now)) console.log(`  ${k}: ${v}`)
  process.exit(0)
}

let saved = null
try { saved = JSON.parse(readFileSync(FILE, 'utf8')) } catch { /* эталона ещё нет */ }

if (!saved) {
  console.log('эталона нет — создайте его: node tests/golden.mjs --update')
  check('эталон существует', false)
} else {
  console.log(`версия правил: эталон ${saved.rules}, сейчас ${RULES_VERSION}`)
  const changed = Object.keys(now).filter((k) => saved.prints[k] !== now[k])

  if (saved.rules === RULES_VERSION) {
    // Версия та же — значит и мир обязан быть тем же. Разошлось: либо правку
    // физики сделали, не подняв версию, либо она вообще не задумывалась.
    for (const k of Object.keys(now)) {
      check(`«${k}» совпадает с эталоном`, saved.prints[k] === now[k],
        saved.prints[k] === now[k] ? '' : `было ${saved.prints[k]}, стало ${now[k]}`)
    }
    if (changed.length) {
      console.log('')
      console.log('  Мир изменился при той же версии правил. Это значит, что все')
      console.log('  прошлые записи теперь проигрываются иначе, а выглядят как прежде.')
      console.log('  Если правка физики намеренная — поднимите RULES_VERSION в')
      console.log('  src/core/releases.js и обновите эталон: node tests/golden.mjs --update')
      console.log('  Если нет — вы только что сломали детерминизм, и это надо чинить.')
    }
  } else {
    // Версию подняли — эталон устарел законно, но обновить его всё равно надо.
    check('версию правил подняли, но эталон не обновили', false,
      `эталон на версии ${saved.rules}, код на ${RULES_VERSION} — выполните: node tests/golden.mjs --update`)
  }
}
