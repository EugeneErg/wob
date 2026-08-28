// Детерминизм на тяжёлых уровнях.
//
// До сих пор повтор проверялся на «Башне»: два десятка точек, ничего текучего.
// Жидкости и песок — самое хрупкое место для повтора: там на каждом шаге идёт
// сумма по соседям, а соседи находятся через сетку. Стоит порядку обхода
// зависеть от чего-нибудь помимо содержимого уровня — и один и тот же ввод
// даст разные миры, причём разойдутся они не сразу, а через сотню тиков.
//
// Если эта проверка не проходит, спидраны на таких уровнях невозможны в
// принципе, и знать об этом надо до того, как на записях построена таблица
// рекордов.

import '../src/entities/index.js'
import { Run, replayOf, PLAY } from '../src/core/run.js'
import { check } from './assert.mjs'

const wall = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
const terr = (id, x0, y0, x1, y1) => ({
  id, type: 'terrain',
  data: { points: wall(x0, y0, x1, y1), smoothness: 0.35, fill: '#2a3326', edge: '#66804f' },
})

// Вода в чаше: льётся, растекается, бьётся о стенки — самый тяжёлый случай.
const water = {
  id: 'wet', width: 1200, height: 800, gravity: { x: 0, y: 1800 }, goal: 1,
  entities: [
    terr('floor', 0, 700, 1200, 800),
    terr('left', 300, 380, 340, 700),
    terr('right', 860, 380, 900, 700),
    terr('step', 520, 620, 680, 700),
    {
      id: 'w', type: 'liquid',
      data: {
        points: [[345, 400], [855, 400], [855, 600], [345, 600]], polys: null,
        substance: 'water', density: 1, viscosity: 0.05, tension: 3.06, grain: 16, limit: 400,
      },
    },
  ],
}

// Песок: сыпучая среда, другой набор ограничений
const sand = {
  id: 'dry', width: 1000, height: 700, gravity: { x: 0, y: 1800 }, goal: 1,
  entities: [
    terr('floor', 0, 600, 1000, 700),
    terr('l', 250, 300, 290, 600),
    terr('r', 710, 300, 750, 600),
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

// Отпечаток мира. Кроме частиц берём и геометрию сущностей: песок — не
// система частиц, а сплошная область, из которой игрок вычитает ходы, и его
// состояние живёт в мультиполигоне, а не в точках. Отпечаток только по точкам
// на таком уровне был бы пустым и проверял бы ровным счётом ничего.
function hash(run) {
  let h = 2166136261
  const put = (s) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } }
  for (const p of run.world.physics.points) {
    put(`${Math.round(p.x * 100)},${Math.round(p.y * 100)},${Math.round(p.vx)},${Math.round(p.vy)}`)
  }
  for (const inst of run.world.instances) {
    // Выкопанное живёт в рантайме сущности (rt.polys), а не в данных уровня:
    // data — это то, что задал автор, и копание его не трогает.
    const polys = inst.rt?.polys || inst.data?.polys
    if (!polys) continue
    for (const poly of polys) for (const ring of poly) for (const [x, y] of ring) {
      put(`${Math.round(x * 100)},${Math.round(y * 100)}`)
    }
  }
  return (h >>> 0).toString(16)
}

// Сколько всего вершин в областях — грубая мера «есть ли что проверять»
const shapeSize = (run) => run.world.instances
  .reduce((n, i) => n + ((i.rt?.polys || i.data?.polys)?.flat(2).length || 0), 0)

// Прогоняем уровень на разной частоте кадров и сверяем отпечатки.
// Ввода здесь нет намеренно: проверяем саму симуляцию, а не запись действий.
function probe(name, lvl, seconds, digs = null) {
  const t0 = Date.now()
  const ticks = seconds * 60
  // Ввод задаётся одинаковым для всех прогонов: у песка без копания вообще
  // ничего не происходит, и проверять было бы нечего.
  // Копание — это непрерывное протягивание курсора: из области вычитается
  // «колбаса» от прошлой точки к нынешней. Дёрганый ввод на одном месте не
  // выкапывает ничего, поэтому курсор ведём сплошной линией.
  const drive = (r) => {
    if (!digs) return
    const t = r.tick
    if (t < digs.from || t > digs.to) return
    const k = (t - digs.from) / (digs.to - digs.from)
    const pt = { x: digs.x0 + (digs.x1 - digs.x0) * k, y: digs.y0 + (digs.y1 - digs.y0) * k }
    if (t === digs.from) r.down(pt)
    else if (t === digs.to) r.up(pt)
    else r.move(pt)
  }
  const base = new Run(lvl, { mode: PLAY, seed: 777 })
  for (let i = 0; i < ticks; i++) { drive(base); base.frame(1 / 60) }
  const want = hash(base)
  const points = base.world.physics.points.length

  const pacings = {
    '60 Гц': () => 1 / 60,
    '30 Гц': () => 1 / 30,
    '144 Гц': () => 1 / 144,
    'рваные кадры': (() => { let i = 0; return () => [1 / 20, 1 / 144, 1 / 45, 1 / 90][i++ % 4] })(),
  }

  console.log(`\n${name}: ${points} частиц, ${shapeSize(base)} вершин области, ${seconds} с игры`)
  check(`${name}: есть что проверять`, points > 50 || shapeSize(base) > 50,
    `${points} частиц, ${shapeSize(base)} вершин области`)

  // Проверяется ПОВТОР ЗАПИСИ на разной частоте кадров, а не повторное
  // разыгрывание живого ввода. Разница принципиальная: живой ввод приходит
  // кадрами, и на 30 Гц кадров вдвое меньше — значит и движений курсора
  // вдвое меньше, то есть игра была бы просто другой. Запись же привязана
  // к тикам, и в этом весь смысл: она обязана воспроизводиться одинаково
  // при любой частоте кадров.
  const rec = base.snapshot()
  let all = true
  for (const [pace, next] of Object.entries(pacings)) {
    const r = replayOf(lvl, rec)
    let guard = 0
    // Кусок времени подрезаем, чтобы не перескочить нужный тик: кадр в 1/20
    // секунды даёт три тика разом, и без подрезки миры сравнивались бы на
    // разных тиках.
    while (r.tick < ticks && guard++ < 100000) {
      const left = (ticks - r.tick) / 60
      r.frame(Math.min(next(), left))
    }
    const same = hash(r) === want
    all &&= same
    check(`${name}: повтор совпал при «${pace}»`, same, `отпечаток ${hash(r)}`)
    check(`${name}: расхождений по отметкам нет при «${pace}»`, r.diverged === null,
      r.diverged === null ? '' : `разошлось на тике ${r.diverged}`)
  }

  console.log(`  (посчитано за ${((Date.now() - t0) / 1000).toFixed(1)} с)`)
  return all
}

// Секунд берём немного: вода считается медленнее реального времени, а прогон
// тестов не должен занимать минуты. Пяти секунд хватает: расхождение в таких
// средах проявляется за десятки тиков, а не за тысячи.
probe('вода', water, 3)
// Копаем ходы в песке: точки берутся из мировых координат, как настоящий ввод
probe('песок', sand, 3, { from: 20, to: 140, x0: 320, y0: 420, x1: 680, y1: 470 })
