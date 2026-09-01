// Проверка прогонов: пересчёт записи тем же решателем, что и в игре.
//
// Зачем отдельная служба на Node, когда бэкенд на PHP. Прогон — это лог ввода,
// а не число: чтобы узнать время, его надо проиграть. Проиграть его может
// только тот же самый код физики — расхождение в одной частице даёт другой
// исход, — а этот код здесь, в src/core. Переписать решатель на PHP значило бы
// завести вторую физику, которая обязана совпадать с первой до последнего бита
// и не совпадёт: любая правка в игре тихо разъедет проверку с реальностью.
//
// Поэтому проверка живёт рядом с игрой и разговаривает с бэкендом по HTTP.
// В терминах архитектуры бэка это один порт с одним адаптером: PHP решает,
// хранит и ранжирует, а знать, что где-то есть второй язык, ему незачем.

import { createServer } from 'node:http'
import { engineFor, knownVersions, currentVersion } from './engines.mjs'

const PORT = Number(process.env.VERIFIER_PORT || 8090)

// Дальше этого прогон считается неправдоподобным и не проверяется.
//
// Не про читерство, а про ресурсы: запись можно подделать так, чтобы она
// считалась вечно, и служба, которая честно возьмётся за такую работу,
// перестанет успевать за настоящими.
const MAX_TICKS = 60 * 60 * 60   // час игры

/**
 * Проиграть запись и сказать, что получилось на самом деле.
 *
 * Возвращает не «да/нет», а факты: дошёл ли прогон до цели, за сколько тиков и
 * разошёлся ли с контрольными отметками. Решение принимает бэкенд — он один
 * знает, чего требует конкретная таблица.
 */
async function verify({ level, seed, input, ticks, rulesVersion }) {
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > MAX_TICKS) {
    return { ok: false, reason: 'implausible-length' }
  }

  // Прогон проигрывается на той физике, на которой игрался, а не на нынешней.
  // Иначе правка решателя объявляла бы подделками все накопленные рекорды —
  // хотя виноваты в их «неправильности» мы, а не те, кто их ставил.
  const engine = await engineFor(rulesVersion)

  if (!engine) {
    // Не отказ прогону, а признание, что проверить его нечем: такой версии
    // решателя в этой сборке нет. Разница принципиальная — за наш недосмотр
    // запись удалять нельзя.
    return {
      ok: false,
      undecided: true,
      reason: 'engine-unavailable',
      requested: Number(rulesVersion),
      known: knownVersions(),
    }
  }

  const { Run, REPLAY } = engine
  const run = new Run(level, { mode: REPLAY, seed, input })

  // Считаем до тех пор, пока прогон не остановится сам — достигнув цели или
  // исчерпав ввод, — и ни тиком дольше.
  //
  // Предел намеренно НЕ выводится из заявленного времени. Первая версия брала
  // «заявлено плюс запас», и это отдавало проверку в руки проверяемого: назови
  // единицу, и пересчёт остановится на сто двадцатом тике, не дойдя до места,
  // где всё разъезжается. Число из запроса не должно влиять ни на что, кроме
  // финального сравнения.
  //
  // Верхняя граница остаётся, но она наша и общая для всех: запись можно
  // составить так, чтобы она считалась вечно, и служба, которая честно
  // возьмётся за такую работу, перестанет успевать за настоящими.
  const step = run.clock.dt

  for (let i = 0; i < MAX_TICKS && !run.stopped; i++) run.frame(step)

  const actual = run.snapshot()

  // Проверять можно только законченный прогон, и это не ограничение реализации,
  // а свойство записи. Повтор брошенной попытки останавливается там, где
  // кончился ввод: дальше мир пошёл бы уже без игрока, и «сколько это заняло»
  // становится вопросом без ответа. В таблицу такие и не отправляются.
  if (!actual.finished) {
    return { ok: false, reason: 'not-finished', finished: false, ticks: actual.ticks, claimed: ticks }
  }

  if (run.diverged !== null) {
    // Не подделка и не ошибка игрока: пересчёт разошёлся с отметками, снятыми
    // при записи. Назвать тик важнее, чем сказать «не сошлось».
    return { ok: false, reason: 'diverged', diverged: run.diverged, ticks: actual.ticks, claimed: ticks }
  }

  return {
    ok: actual.ticks === ticks,
    reason: actual.ticks === ticks ? null : 'wrong-time',
    finished: true,
    ticks: actual.ticks,
    claimed: ticks,
    diverged: null,
  }
}

const server = createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/verify') {
    res.writeHead(404).end('{"error":"POST /verify"}')

    return
  }

  let body = ''
  req.on('data', (chunk) => {
    body += chunk

    // Записи бывают большими, но не безразмерными.
    if (body.length > 8_000_000) req.destroy()
  })

  req.on('end', async () => {
    res.setHeader('Content-Type', 'application/json')

    try {
      const result = await verify(JSON.parse(body))
      res.writeHead(200).end(JSON.stringify(result))
    } catch (e) {
      // Упавшая проверка — это не «прогон плохой», это «проверить не вышло».
      // Разница важна: во втором случае запись нельзя ни зачесть, ни отвергнуть.
      res.writeHead(500).end(JSON.stringify({ error: e.message }))
    }
  })
})

// Слушать начинаем только при прямом запуске.
//
// Иначе импорт verify() ради проверки поднимал бы порт как побочный эффект —
// и тест, которому нужна одна функция, оставлял бы за собой висящий сервер.
if (process.argv[1] && process.argv[1].endsWith('verifier.mjs')) {
  server.listen(PORT, () => {
    console.log(`verifier listening on ${PORT}, engines: ${knownVersions().join(', ')} (current ${currentVersion})`)
  })
}

export { verify }
