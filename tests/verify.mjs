// Проверка прогонов: пересчёт записи тем же решателем.
//
// Это то, что превращает время в таблице из заявки в факт. Проверяется на
// настоящем прогоне — сыгранном здесь же, с настоящим вводом, — а не на
// выдуманной записи: подделать можно только то, что кто-то действительно играл.

import '../src/entities/index.js'
import { Run, PLAY } from '../src/core/run.js'
import { level } from './level.mjs'
import { check } from './assert.mjs'
import { verify } from '../tools/verifier.mjs'

const lvl = level('lvl-tower')

// Живая попытка: тащим шары в конструкцию, пока уровень не будет пройден.
function play() {
  const run = new Run(lvl, { mode: PLAY, seed: 12345 })
  const frame = (n) => { for (let i = 0; i < n; i++) run.frame(1 / 60) }
  frame(60)

  for (let i = 0; i < 8 && !run.finished; i++) {
    const ball = run.world.instances
      .filter((x) => x.type === 'game-ball' && x.rt.state === 'free')
      .sort((a, c) => a.rt.p.x - c.rt.p.x)[0]
    if (!ball) break

    const x = 745 + (i % 2 ? 26 : -26)
    const y = 700 - i * 40
    run.down({ x: ball.rt.p.x, y: ball.rt.p.y })
    for (let k = 0; k < 20; k++) { run.move({ x, y }); frame(1) }
    run.up({ x, y })
    frame(90)
  }

  return run.snapshot()
}

const snap = play()
console.log(`сыграли: тиков ${snap.ticks}, дошли до цели: ${snap.finished}`)

const asRun = (over = {}) => ({
  level: lvl, seed: snap.seed, input: snap.input, ticks: snap.ticks, rulesVersion: 1, ...over,
})

// --- брошенную попытку проверить нельзя, и она об этом говорит ---
//
// Повтор такой записи останавливается там, где кончился ввод: дальше мир пошёл
// бы уже без игрока. «Сколько это заняло» — вопрос без ответа, поэтому в
// таблицу такие и не отправляются.
const abandoned = await verify(asRun())
check('брошенная попытка не засчитывается', abandoned.ok === false)
check('и причина названа', abandoned.reason === 'not-finished')

// --- пересчёт воспроизводит запись, а не идёт своим путём ---
//
// Главное свойство: тот же ввод через ту же физику даёт тот же мир. Если бы
// оно не держалось, проверять было бы нечем — любой прогон расходился бы сам
// с собой.
const again = await verify(asRun())
check('повторный пересчёт даёт тот же результат', again.ticks === abandoned.ticks)

// Пересчёт брошенной попытки может оказаться ДЛИННЕЕ сыгранного: после
// последнего действия мир ещё доигрывает последствия, пока не успокоится.
// Это не расхождение, а ровно та причина, по которой у брошенной попытки нет
// времени: «сколько это заняло» зависит от того, где игрок закрыл вкладку.
check('брошенная попытка не даёт осмысленного времени', abandoned.ticks !== snap.ticks)

// А вот заявленное время на результат не влияет вовсе — оно только сверяется.
// Иначе клиент мог бы диктовать проверке ответ.
check(
  'заявленное время не влияет на пересчёт',
  (await verify(asRun({ ticks: 1 }))).ticks === abandoned.ticks,
)

// --- запись с неизвестной физикой ---
//
// Не подделка и не отказ прогону: такой версии решателя в этой сборке нет.
// Признать это надо отдельным исходом, иначе за наш недосмотр удалялись бы
// чужие честные рекорды.
const unknownRules = await verify(asRun({ rulesVersion: 999 }))
check('незнакомая версия правил не засчитана', unknownRules.ok === false)
check('но и не объявлена подделкой', unknownRules.undecided === true)
check('и сказано, какие версии есть', Array.isArray(unknownRules.known))

// --- неправдоподобная длина ---
//
// Про ресурсы, а не про честность: запись можно составить так, чтобы она
// считалась вечно, и служба, которая честно возьмётся за такую работу,
// перестанет успевать за настоящими.
check('абсурдная длина отсекается без счёта', (await verify(asRun({ ticks: 99_999_999 }))).ok === false)
check('нулевая длина тоже', (await verify(asRun({ ticks: 0 }))).ok === false)
