/* eslint-disable no-sparse-arrays -- пропущенный нулевой индекс здесь смысл, а не
   опечатка: mine[1] — первый шар, mine[2] — второй. Сдвигать на единицу при
   каждом чтении хуже, чем оставить нулевую ячейку пустой. */
// Гонка с призраком. Проверяем два свойства: призрак не влияет на игру
// и отставание считается на общих отметках, а не по номеру тика.
import '../src/entities/index.js'
import { Run, replayOf, PLAY } from '../src/core/run.js'
import { EVENTS } from '../src/core/globals.js'
import { formatTime } from '../src/core/replays.js'
import { gapAt, commonSplits, allGaps } from '../src/core/splits.js'
import { check } from './assert.mjs'

// Свой маленький уровень: труба стоит прямо на конструкции, поэтому шар
// доходит до цели за пару секунд. На «Башне» для этого пришлось бы строить
// вверх до высоты 180, а проверяем мы не умение строить, а работу призрака.
// Просто поднести шар к трубе нельзя: засчитывается только тот, кто дошёл
// до неё сам, шагая по связям.
const lvl = {
  id: 'гонка', width: 1200, height: 900, gravity: { x: 0, y: 1800 }, goal: 3,
  entities: [
    { id: 'ground', type: 'terrain', data: { points: [[0, 780], [1200, 780], [1200, 900], [0, 900]], smoothness: 0.35, fill: '#2a3326', edge: '#66804f' } },
    { id: 'sb1', type: 'system-ball', data: { x: 700, y: 763, r: 17, static: true, links: ['sb2'], color: '#d8cbb0', linkColor: '#b9ae95' } },
    { id: 'sb2', type: 'system-ball', data: { x: 800, y: 763, r: 17, static: true, links: ['sb1'], color: '#d8cbb0', linkColor: '#b9ae95' } },
    { id: 'pipe', type: 'pipe', data: { points: [[800, 763], [800, 300], [1150, 300]], radius: 30, power: 1, color: '#4c93c4', inner: '#0d1a24' } },
    ...[0, 1, 2, 3].map((i) => ({
      id: `gb${i}`, type: 'game-ball',
      data: { x: 300 + i * 40, y: 755, r: 13, mass: 1, minLinks: 2, maxLinks: 3, range: 165, jump: 470, speed: 95, dropMax: 190, color: '#e2704a', linkColor: '#c2603e' },
    })),
  ],
}
const hash = (r) => {
  let h = 2166136261
  for (const p of r.world.physics.points) {
    const s = `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  }
  return (h >>> 0).toString(16)
}

// Отметки: на каком тике игрок довёл шар до цели в первый, второй, третий раз
function playWith(seed, targets, ghostRec = null) {
  const run = new Run(lvl, { mode: PLAY, seed })
  const splits = []
  let n = 0
  run.world.on(EVENTS.progress, (e) => { n += e?.delta ?? 1; splits[n] = run.tick })

  // призрак идёт теми же тиками рядом
  const gh = ghostRec ? replayOf(lvl, ghostRec) : null
  const gsplits = []
  if (gh) {
    let m = 0
    gh.world.on(EVENTS.progress, (e) => { m += e?.delta ?? 1; gsplits[m] = gh.tick })
  }

  const f = (n2) => {
    for (let i = 0; i < n2; i++) {
      run.frame(1 / 60)
      if (gh && gh.tick < (ghostRec.ticks || 0)) gh.frame(1 / 60)
    }
  }
  f(60)
  // Шар подносим прямо к устью трубы: цель нужна затем, чтобы появились
  // отметки, а не чтобы построить башню. Труба у этого уровня на высоте 180,
  // достроить до неё за пару секунд всё равно нельзя.
  for (const t of targets) {
    const b = run.world.instances.filter((x) => x.type === 'game-ball' && x.rt.state === 'free')
      .sort((a, c) => a.rt.p.x - c.rt.p.x)[0]
    if (!b) break
    run.down({ x: b.rt.p.x, y: b.rt.p.y })
    // ведём курсор к трубе плавно: рывком шар не тащится
    for (let k = 1; k <= 30; k++) {
      run.move({ x: b.rt.p.x + (t.x - b.rt.p.x) * (k / 30), y: b.rt.p.y + (t.y - b.rt.p.y) * (k / 30) })
      f(1)
    }
    run.up(t)
    f(50)
  }
  return { run, splits, gsplits }
}

// подносим шар к конструкции — дальше он идёт по ней сам и попадает в трубу
const targets = [{ x: 720, y: 750 }, { x: 760, y: 750 }]

// --- призрак не влияет на игру ----------------------------------------------
const alone = playWith(555, targets)
const rec = alone.run.snapshot()
const withGhost = playWith(555, targets, rec)

check('мир с призраком тот же, что без него', hash(alone.run) === hash(withGhost.run),
  `${hash(alone.run)} против ${hash(withGhost.run)}`)
check('тик тот же', alone.run.tick === withGhost.run.tick)
check('запись игрока не изменилась от присутствия призрака',
  JSON.stringify(rec.input) === JSON.stringify(withGhost.run.snapshot().input))

// --- отставание считается на общих отметках, а не по номеру тика ------------
// Это чистая арифметика, и проверяется она отдельно от игры: гонять шары до
// трубы ради неё не нужно, а вот ошибиться в ней легко — и игрок увидит
// неверную разницу, не имея способа заметить подвох.
//
// splits[n] — тик, на котором цель достигнута в n-й раз.
const mine =  [, 120, 260, 400]
const equal = [, 120, 260, 400]
const slower = [, 150, 320, 500]
const faster = [, 100, 200, 300]

check('против самого себя отставания нет', gapAt(mine, equal) === 0)
check('против медленного призрака игрок впереди', gapAt(mine, slower) === -100,
  `${gapAt(mine, slower)} тиков`)
check('против быстрого призрака игрок позади', gapAt(mine, faster) === 100,
  `${formatTime(Math.abs(gapAt(mine, faster)))} отставания`)

// Главное свойство: сравнение идёт по последней ОБЩЕЙ отметке, а не по концу
// чьего-то списка. Игрок дошёл до третьего шара, призрак пока до второго —
// сравнивать надо второй, иначе разница окажется выдумкой.
const behind = [, 100, 200]
check('сравнение по последней общей отметке', gapAt(mine, behind) === 60,
  `у игрока 3 отметки, у призрака 2 — сравниваем вторую: ${gapAt(mine, behind)}`)
check('общих отметок именно столько, сколько есть у обоих', commonSplits(mine, behind) === 2)
check('пока общих отметок нет, сравнивать нечего', gapAt(mine, []) === null)
check('и с пустым игроком тоже', gapAt([], faster) === null)

// Разбор по отметкам: видно, на каком шаре прогон разъехался
const gaps = allGaps(mine, [, 100, 260, 300])
console.log('\nразбор по отметкам:', gaps.map((g) => `${g.at}-й шар: ${g.gap > 0 ? '+' : ''}${g.gap}`).join(', '))
check('разбор показывает каждую отметку', gaps.length === 3)
// gaps — обычный массив с нуля, а поле at хранит номер отметки
const byMark = Object.fromEntries(gaps.map((g) => [g.at, g.gap]))
check('и находит, где именно потеряно время',
  byMark[1] === 20 && byMark[2] === 0 && byMark[3] === 100,
  'время потеряно на первом и третьем шаре, на втором отыграно')
