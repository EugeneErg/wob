// Просмотр записи: разворачивание и перемотка.
//
// На сервере и в хранилище лежат только действия игрока — сид и ввод по тикам,
// килобайты. Это и есть запись. Ничего другого туда не уходит и уходить не
// должно: слепок мира весит в сотню раз больше, устаревает при каждой правке
// физики и не проверяем.
//
// Но смотреть запись, у которой есть только начало, неудобно: отмотать назад
// можно лишь пересчитав, а на уровне с водой пересчёт идёт втрое медленнее
// самой игры. Поэтому скачанная запись разворачивается на месте: в фоне она
// проигрывается вперёд, и через равные промежутки снимается копия мира
// (fork.js). Дальше перемотка считается от ближайшей копии, а не от начала.
//
// Разворачивание идёт порциями по несколько миллисекунд за кадр, поэтому
// смотреть можно сразу: с обычной скоростью — с самого начала, а перематывать
// — в пределах уже развёрнутого. Сколько развёрнуто, видно на полосе времени.
//
// Копии живут только в памяти этой вкладки. Они не сохраняются, не выгружаются
// и никуда не отправляются: это кэш, который всегда можно построить заново из
// тех же действий.

import { replayOf } from './run.js'
import { TICK_RATE } from './clock.js'

const CHUNK_MS = 6            // сколько миллисекунд за кадр отдаём работе
const STEP = TICK_RATE * 2    // копия раз в две секунды игры
// Предел по памяти: дальше промежуток удваивается, а копии прореживаются.
// Замер на тяжёлом уровне (711 частиц воды): одна копия ~215 КБ, шестнадцать
// копий — 3,4 МБ. Для вкладки это немного, поэтому предел выбран по удобству
// перемотки, а не по памяти.
const MAX_SHOTS = 16

export class Scrubber {
  constructor(level, record) {
    this.level = level
    this.record = record
    this.total = record.ticks || 0

    this.run = replayOf(level, record)        // то, что видит зритель
    this.target = 0
    this.busy = false                         // идёт пересчёт под перемотку

    // Разворачивание: отдельный прогон, идущий впереди зрителя.
    this.packer = replayOf(level, record)
    this.step = STEP
    this.shots = [{ tick: 0, run: this.packer.fork() }]
    this.ready = 0                            // докуда развёрнуто
  }

  // Доля развёрнутого, 0..1 — на полосу времени
  get unpacked() { return this.total ? Math.min(1, this.ready / this.total) : 1 }
  get done() { return this.ready >= this.total }

  // Порция разворачивания. Зовётся каждый кадр; работает, пока есть время
  // в бюджете. Перемотке бюджет уступается: зритель ждёт её, а не фоновой
  // работы.
  unpack(budget = CHUNK_MS) {
    if (this.done || this.busy) return false
    const until = now() + budget
    while (this.packer.tick < this.total && now() < until) {
      this.packer.frame(1 / TICK_RATE)
      if (this.packer.tick - this.shots[this.shots.length - 1].tick >= this.step) {
        this.shots.push({ tick: this.packer.tick, run: this.packer.fork() })
        if (this.shots.length > MAX_SHOTS) this._thin()
      }
    }
    this.ready = this.packer.tick
    return !this.done
  }

  // Копий стало слишком много — прореживаем через одну и удваиваем промежуток.
  // Так память ограничена сверху независимо от длины записи, а перемотка
  // дорожает плавно: вдвое реже копии — вдвое дальше считать от ближайшей.
  _thin() {
    const kept = [this.shots[0]]
    for (let i = 1; i < this.shots.length; i += 2) kept.push(this.shots[i])
    this.shots = kept
    this.step *= 2
  }

  get tick() { return this.run.tick }
  get world() { return this.run.world }
  get progress() { return this.target ? Math.min(1, this.run.tick / this.target) : 1 }

  // Ближайшая копия не позже нужного тика
  _shotFor(tick) {
    let best = this.shots[0]
    for (const s of this.shots) if (s.tick <= tick && s.tick >= best.tick) best = s
    return best
  }

  // Встать на тик. Вперёд — доиграть; назад — от ближайшей копии.
  seek(t) {
    this.target = Math.max(0, Math.min(t, this.total))
    if (this.target < this.run.tick) {
      // Сама копия остаётся на месте: с неё ещё не раз начнут, в работу идёт
      // её форк.
      this.run = this._shotFor(this.target).run.fork()
    }
    this.busy = this.run.tick < this.target
    return this.busy
  }

  step1(dir = 1) { return this.seek(this.run.tick + dir) }
  back(seconds = 1) { return this.seek(this.run.tick - Math.round(seconds * TICK_RATE)) }

  pump(budget = CHUNK_MS) {
    if (!this.busy) return false
    const until = now() + budget
    while (this.run.tick < this.target && now() < until) this.run.frame(1 / TICK_RATE)
    this.busy = this.run.tick < this.target
    return this.busy
  }

  // Сколько тиков придётся пересчитать, чтобы попасть на t. Цена известна до
  // начала перемотки: по ней видно, показывать полосу ожидания или нет.
  costOf(t) {
    const target = Math.max(0, Math.min(t, this.total))
    if (target >= this.run.tick) return target - this.run.tick
    return target - this._shotFor(target).tick
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

// Лестница копий для живой игры.
//
// В обычном прохождении откат разрешён, и пересчитывать его с начала уровня
// так же дорого, как и в повторе. Копии здесь строятся по ходу самой игры и
// живут только в памяти: на сервер, как и всё остальное, уходят одни действия.
export class Ladder {
  constructor(step = STEP, max = MAX_SHOTS) {
    this.step = step
    this.max = max
    this.shots = []
  }

  // Зовётся после каждого тика живой игры. Копия делается редко и стоит
  // единицы миллисекунд, поэтому на кадр это не влияет.
  // at — номер тика, которому соответствует состояние мира. Передаётся явно:
  // во время обработки тика счётчик часов ещё не увеличен, и брать его прямо
  // отсюда значило бы пометить копию номером на единицу меньше.
  keep(run, at) {
    const tick = at ?? run.tick
    const last = this.shots[this.shots.length - 1]
    if (last && tick - last.tick < this.step) return
    const copy = run.fork()
    copy.clock.tick = tick
    this.shots.push({ tick, run: copy })
    if (this.shots.length > this.max) {
      const kept = [this.shots[0]]
      for (let i = 1; i < this.shots.length; i += 2) kept.push(this.shots[i])
      this.shots = kept
      this.step *= 2
    }
  }

  // Ближайшая копия не позже тика; null — придётся считать с начала
  at(tick) {
    let best = null
    for (const s of this.shots) if (s.tick <= tick && (!best || s.tick > best.tick)) best = s
    return best
  }

  // Всё, что позже отката, больше не нужно: игрок переигрывает это место.
  cut(tick) { this.shots = this.shots.filter((s) => s.tick <= tick) }
}
