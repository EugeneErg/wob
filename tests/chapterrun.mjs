// Прохождение главы: сумма времени, развилки, проценты.
import { ChainRun, exitNodes, endingNodes, isAnyPercent, isFullPercent, categoryOf, percentOf, openNodes, nextChapterOf } from '../src/core/chain.js'
import { KIND, CATEGORY, formatTime } from '../src/core/replays.js'
import { check } from './assert.mjs'

// Глава с развилкой: старт → (лево | право) → общий финал.
//   a → b → d
//   a → c → d
// плюс короткая ветка e, до которой можно дойти сразу.
const ch = {
  id: 'ch1',
  nodes: [
    { id: 'nd-a', levelId: 'a', next: ['nd-b', 'nd-c', 'nd-e'] },
    { id: 'nd-b', levelId: 'b', next: ['nd-d'] },
    { id: 'nd-c', levelId: 'c', next: ['nd-d'] },
    { id: 'nd-d', levelId: 'd', next: [] },
    { id: 'nd-e', levelId: 'e', next: [] },
  ],
}

console.log('связи наружу не ведут — выходов нет:', exitNodes(ch).length === 0)
console.log('финалы:', endingNodes(ch).join(', '))
// d и e оба финальны: связей из них нет. Это и есть принятое правило, и это же
// его цена — короткая ветка e засчитывается наравне с честным маршрутом.
console.log('  их два, и различить их по графу нельзя:', endingNodes(ch).length === 2)

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
// d — финал: связей из него нет. Дойти до него и есть пройти главу.
check('дошли до финала — есть зачёт any%', categoryOf(ch, any.done) === CATEGORY.ANY)
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
console.log('  после a открыты:', openNodes(ch, new Set(['nd-a'])).join(', '), '(развилка: три ветки на выбор)')
console.log('  после a и b:', openNodes(ch, new Set(['nd-a', 'nd-b'])).join(', '))

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


// --- короткая ветка засчитывается, и это осознанно ---------------------------
// e — боковая ветка, не задуманный финал главы. Но связей из неё не ведёт,
// значит по принятому правилу «финал = точка без исходящих связей» она финал,
// и дойти до неё достаточно для any%.
//
// Раньше это считалось дырой, и её закрывала привязка узла к следующей главе:
// она несла смысл «глава кончилась здесь». Привязок больше нет — связи идут от
// точки к точке, — поэтому граф действительно не отличает задуманный конец от
// недорисованной ветки, и правило принято вместе с этой ценой.
//
// Прикрывает теперь редактор: финальные точки на карте выделены, и автор видит
// незакрытую ветку сразу.
const short = new ChainRun({ kind: KIND.CHAPTER, targetId: 'ch1' })
short.push(seg(300), { levelId: 'a' })
short.push(seg(120), { levelId: 'e' })
console.log('\n— короткая ветка')
console.log('  пройдено:', percentOf(ch, short.done) + '%')
check('короткая ветка засчитана как any%', categoryOf(ch, short.done) === CATEGORY.ANY)
check('честный маршрут засчитан так же', categoryOf(ch, any.done) === CATEGORY.ANY)
check('все ветки — это 100%', categoryOf(ch, full.done) === CATEGORY.FULL)

// --- связь может уйти в соседнюю главу --------------------------------------
// Точка d ведёт в первую точку следующей главы. Для главы это выход, а не
// финал, и последней она быть перестаёт.
const next = { id: 'ch2', nodes: [{ id: 'nd-x', levelId: 'x', next: [] }] }
const routed = { ...ch, nodes: ch.nodes.map((n) => (n.id === 'nd-d' ? { ...n, next: ['nd-x'] } : n)) }

console.log('\n— связь наружу')
console.log('  выходы:', exitNodes(routed).join(', '), '| финалы:', endingNodes(routed).join(', '))
check('выход наружу нашёлся', exitNodes(routed).join() === 'nd-d')
check('e остаётся финалом', endingNodes(routed).join() === 'nd-e')
check('куда ведёт дальше', nextChapterOf(routed, any.done, [routed, next]) === 'ch2')
check('через короткую ветку наружу не выйти', nextChapterOf(routed, short.done, [routed, next]) === null)
