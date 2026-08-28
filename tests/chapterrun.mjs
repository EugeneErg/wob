// Прохождение главы: сумма времени, развилки, проценты.
import { ChainRun, exitNodes, deadEnds, isAnyPercent, isFullPercent, categoryOf, percentOf, openNodes, needsRouting, nextChapterOf } from '../src/core/chain.js'
import { KIND, CATEGORY, formatTime } from '../src/core/replays.js'
import { check } from './assert.mjs'

// Глава с развилкой: старт → (лево | право) → общий финал.
//   a → b → d
//   a → c → d
// плюс тупиковая ветка e, до которой можно дойти, но она никуда не ведёт.
const ch = {
  id: 'ch1',
  nodes: [{ levelId: 'a' }, { levelId: 'b' }, { levelId: 'c' }, { levelId: 'd' }, { levelId: 'e' }],
  edges: [
    { from: 'a', to: 'b' }, { from: 'a', to: 'c' },
    { from: 'b', to: 'd' }, { from: 'c', to: 'd' },
    { from: 'a', to: 'e' },
  ],
}

console.log('без привязки продолжения — выходов нет:', exitNodes(ch).length === 0)
console.log('тупики:', deadEnds(ch).join(', '), '(d и e неотличимы: из обоих тропы не ведут)')
console.log('главе нужна рука автора:', needsRouting(ch))

// --- прогон 1: игрок берёт левую ветку и бежит в финал -----------------------
const seg = (ticks, finished = true) => ({ ticks, finished, seed: 1, rate: 60, input: [], camera: [], checks: [] })

const any = new ChainRun({ kind: KIND.CHAPTER, targetId: 'ch1' })
any.push(seg(300), { levelId: 'a' })
any.push(seg(180, false), { levelId: 'b' })   // слил
any.push(seg(240), { levelId: 'b' })          // переиграл
any.push(seg(420), { levelId: 'd' })

console.log('\n— прогон any%')
console.log('  заходов на b:', any.attempts('b'), '(один провальный, один удачный)')
console.log('  время:', formatTime(any.ticks), `= ${any.ticks} тиков`)
check('проваленный заход учтён во времени', any.ticks === 300 + 180 + 240 + 420)
console.log('  пройдено:', percentOf(ch, any.done) + '%')
check('без привязки продолжения зачёта нет', categoryOf(ch, any.done) === null)
console.log('  any% =', isAnyPercent(ch, any.done), ', 100% =', isFullPercent(ch, any.done))

// --- прогон 2: игрок обходит все ветки --------------------------------------
const full = new ChainRun({ kind: KIND.CHAPTER, targetId: 'ch1' })
for (const id of ['a', 'b', 'c', 'e', 'd']) full.push(seg(300), { levelId: id })

console.log('\n— прогон 100%')
console.log('  пройдено:', percentOf(ch, full.done) + '%')
console.log('  категория:', categoryOf(ch, full.done))
console.log('  дольше, чем any%:', full.ticks > any.ticks, `(${formatTime(full.ticks)} против ${formatTime(any.ticks)})`)

// --- прогон 3: брошен на середине -------------------------------------------
const quit = new ChainRun({ kind: KIND.CHAPTER, targetId: 'ch1' })
quit.push(seg(300), { levelId: 'a' })
quit.push(seg(90, false), { levelId: 'b' })
console.log('\n— брошенный прогон')
console.log('  категория:', categoryOf(ch, quit.done), '(глава не пройдена — зачёта нет)')
console.log('  но время записано:', formatTime(quit.ticks))

// --- какие уровни открыты по ходу попытки ------------------------------------
console.log('\n— маршрут')
console.log('  в начале открыт:', openNodes(ch, new Set()).join(', '))
console.log('  после a открыты:', openNodes(ch, new Set(['a'])).join(', '), '(развилка: три ветки на выбор)')
console.log('  после a и b:', openNodes(ch, new Set(['a', 'b'])).join(', '))

// --- время на карте в игровое не идёт ----------------------------------------
// Между сегментами тиков нет вовсе, поэтому сумма не зависит от того,
// сколько игрок думал над развилкой.
const slow = new ChainRun({ kind: KIND.CHAPTER, targetId: 'ch1' })
slow.startedAt = Date.now() - 60000     // как будто попытка идёт минуту по часам
slow.push(seg(300), { levelId: 'a' })
slow.push(seg(420), { levelId: 'd' })
console.log('\n— карта не тикает')
console.log('  IGT:', formatTime(slow.ticks), '— только уровни')
console.log('  RTA:', (slow.rta / 1000).toFixed(0) + ' с — вместе с картой и раздумьями')
check('IGT не зависит от времени на карте', slow.ticks === 720)


// --- дыра: тупиковая ветка засчитывается как прохождение ---------------------
// e — боковой тупик, не финал главы. Но тропы из него не ведут, значит по
// нынешнему правилу «конец = узел без исходящих троп» он тоже конец, и дойти
// до него достаточно для any%. Это неверно: игрок свернул в сторону и не
// прошёл главу. Граф сам по себе не отличает настоящий финал от тупика —
// это должен сказать автор.
const cheat = new ChainRun({ kind: KIND.CHAPTER, targetId: 'ch1' })
cheat.push(seg(300), { levelId: 'a' })
cheat.push(seg(120), { levelId: 'e' })
console.log('\n— тупик вместо финала')
console.log('  пройдено:', percentOf(ch, cheat.done) + '%')
check('тупик зачёта не даёт', categoryOf(ch, cheat.done) === null)
console.log('  и честный прогон тоже без зачёта:', categoryOf(ch, any.done))

// Автор привязал к d следующую главу — d стал выходом, e остался тупиком
const routed = { ...ch, nodes: ch.nodes.map((n) => (n.levelId === 'd' ? { ...n, next: 'ch2' } : n)) }
console.log('\n— после привязки следующей главы к d')
console.log('  выходы главы:', exitNodes(routed).join(', '), '| тупики:', deadEnds(routed).join(', '))
check('честный прогон засчитан как any%', categoryOf(routed, any.done) === 'any')
check('и после привязки тупик по-прежнему не засчитывается', categoryOf(routed, cheat.done) === null)
console.log('  все ветки:', categoryOf(routed, full.done))
console.log('  куда ведёт дальше:', nextChapterOf(routed, any.done))

// Развилка историй: два выхода ведут в разные главы
const forked = {
  ...ch,
  nodes: ch.nodes.map((n) =>
    n.levelId === 'd' ? { ...n, next: 'ch-mirnaya' } : n.levelId === 'e' ? { ...n, next: 'ch-temnaya' } : n),
}
console.log('\n— развилка истории')
console.log('  выходы:', exitNodes(forked).join(', '))
console.log('  вышли через d →', nextChapterOf(forked, any.done))
console.log('  вышли через e →', nextChapterOf(forked, cheat.done), '(не тупик, а другая ветка истории)')
