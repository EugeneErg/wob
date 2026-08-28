// Попытка прохождения: мир, часы, запись ввода — одним куском.
//
// Зачем отдельный слой. Раньше игровой цикл жил прямо в компоненте:
// requestAnimationFrame считал dt и звал world.step(dt), а ввод уходил в мир
// из обработчиков событий, то есть в произвольный момент между шагами. Так
// нельзя ни записать попытку, ни повторить её: «в какой момент игрок отпустил
// шар» не имело точного ответа.
//
// Здесь ответ есть: ввод копится в очереди и попадает в мир строго на границе
// тика. Живая игра и повтор идут по одному и тому же коду — разница только
// в том, откуда берутся события: из очереди указателя или из записи.

import { World } from './world.js'
import { FixedClock, TICK_DT, TICK_RATE } from './clock.js'
import { InputLog, applyEvent, DOWN, MOVE, UP, HOVER } from './input.js'
import { CameraTrack } from './camera.js'
import { forkWorld } from './fork.js'
import { Ladder } from './scrub.js'

// Раз в столько тиков снимается контрольная отметка: секунда игры при 60 Гц.
// Чаще — лишняя работа в кадре, реже — расхождение находится слишком грубо.
const CHECK_EVERY = 60

export const PLAY = 'play'
export const REPLAY = 'replay'

export class Run {
  // seed попытки. В живой игре его выбирают один раз при старте и кладут
  // в запись; при повторе берут из записи. Никакого Date.now() внутри мира.
  constructor(level, { mode = PLAY, seed = 1, input = null, camera = null, checks = null, branches = null, speedrun = false, rate = TICK_RATE } = {}) {
    this.level = level
    this.mode = mode
    this.seed = seed >>> 0
    this.world = new World(structuredClone(level), { seed: this.seed })
    this.clock = new FixedClock(rate)
    this.log = mode === REPLAY ? InputLog.from(input) : new InputLog()
    // Камера идёт рядом со вводом, а не внутри него: на симуляцию она не
    // влияет и выбросить её можно без вреда для результата.
    this.camera = mode === REPLAY ? CameraTrack.from(camera) : new CameraTrack()
    this.pending = []       // живой ввод, ждущий ближайшего тика
    this.paused = false
    this.finished = false   // цель уровня достигнута
    this.stopped = false    // попытка закончена: пройдена, брошена или доиграна

    // Контрольные отметки состояния мира, раз в CHECK_EVERY тиков.
    //
    // Содержимое уровня едет вместе с записью, поэтому правку уровня повтор
    // переживает. А вот правку физики — нет: старого кода решателя в сборке
    // нет и взять его неоткуда. Врать об этом нельзя, но и молчать тоже:
    // отметки позволяют увидеть, что повтор разошёлся, и назвать точный тик,
    // на котором это случилось. Одно дело «запись со старой версии, возможны
    // расхождения», и совсем другое — «разошлась на 412-м тике».
    this.checks = mode === REPLAY ? (checks || []) : []
    this.diverged = null    // тик, на котором повтор перестал совпадать

    // Спидран это или обычное прохождение. Отличие ровно одно: в спидране
    // нельзя откатываться. Флаг живёт здесь, а не в интерфейсе, потому что
    // запрет должен держаться там, где его нельзя обойти, — иначе он держится
    // ровно до первого, кто откроет консоль.
    this.speedrun = speedrun

    // Откаты живой попытки: с какого тика игрок переигрывал и сколько игры
    // при этом выбросил. В спидране список всегда пуст.
    this.branches = branches || []

    // Лестница копий для отката. Строится по ходу игры и живёт только в
    // памяти: в записи по-прежнему одни действия. В спидране откатов нет,
    // поэтому и лестница не нужна.
    this.ladder = mode === PLAY && !speedrun ? new Ladder() : null
  }

  get tick() { return this.clock.tick }
  // Игровое время попытки. Оно считается тиками, а не секундомером: у двух
  // игроков с 30 и 144 кадрами результат одного и того же прохождения обязан
  // совпадать до тысячной, иначе таблица рекордов бессмысленна.
  get time() { return this.clock.tick * TICK_DT }

  // --- живой ввод -----------------------------------------------------------
  // Компонент зовёт это из обработчиков указателя. В мир прямо сейчас ничего
  // не уходит: событие ждёт границы тика.
  queue(kind, pt) {
    if (this.mode !== PLAY || this.paused || this.stopped) return
    this.pending.push({ kind, x: pt?.x ?? 0, y: pt?.y ?? 0 })
  }
  down(pt) { this.queue(DOWN, pt) }
  move(pt) { this.queue(MOVE, pt) }
  up(pt) { this.queue(UP, pt) }
  hover(pt) { this.queue(HOVER, pt) }

  // --- ход времени ----------------------------------------------------------
  // elapsed — сколько реального времени прошло с прошлого кадра. Сколько из
  // него превратится в тики, решает FixedClock; на паузе не превращается
  // ничего, и накопитель не растёт (иначе после паузы мир бы «доганял»).
  // cam — где сейчас стоит камера зрителя. В живой попытке её кладут в дорожку
  // (разреженно, только когда сдвинулась); в повторе аргумент не нужен.
  frame(elapsed, cam = null) {
    if (this.paused || this.stopped) return 0
    return this.clock.advance(elapsed, (tick) => {
      if (this.mode === PLAY && cam) this.camera.record(tick, cam)
      this._tick(tick)
    })
  }

  // Куда смотреть в повторе на текущем тике. null — записи камеры нет
  // (старая запись или камера не двигалась), зритель смотрит сам.
  camAt() { return this.mode === REPLAY ? this.camera.at(this.clock.tick) : null }

  _tick(tick) {
    if (this.mode === REPLAY) {
      for (const ev of this.log.at(tick)) applyEvent(this.world, ev)
      // Запись кончилась, а цель не достигнута — игрок эту попытку бросил.
      // Доигрывать нечего: мир дальше пошёл бы уже без него.
      if (this.log.done && tick >= this.log.lastTick && !this.finished) this._checkReplayEnd()
    } else {
      const q = this.pending
      this.pending = []
      for (const ev of q) {
        const pt = this.log.record(tick, ev.kind, ev)
        // в мир уходит округлённое значение — ровно то, что попадёт в запись
        applyEvent(this.world, { kind: ev.kind, x: pt.x, y: pt.y })
      }
    }
    this.world.step(TICK_DT)
    // Копия снимается ПОСЛЕ шага, а часы увеличивают номер тика уже после
    // возврата из этого обработчика. Поэтому в мире копии состояние на конец
    // тика tick, то есть на начало tick + 1 — этим номером её и помечаем.
    // Ошибка на единицу здесь не видна глазом: откат просто даёт мир, который
    // на один шаг отстал, и расхождение вылезает через десятки тиков.
    if (this.ladder) this.ladder.keep(this, tick + 1)

    if (tick % CHECK_EVERY === 0) {
      const sum = this._checksum()
      const i = tick / CHECK_EVERY
      if (this.mode === REPLAY) {
        const want = this.checks[i]
        if (want !== undefined && want !== sum && this.diverged === null) this.diverged = tick
      } else {
        this.checks[i] = sum
      }
    }
  }

  // Дешёвый отпечаток состояния: позиции всех точек, огрублённые до сотой.
  // Считается раз в CHECK_EVERY тиков, чтобы не съедать время кадра.
  _checksum() {
    let h = 2166136261
    for (const p of this.world.physics.points) {
      const v = (Math.round(p.x * 100) * 31 + Math.round(p.y * 100)) | 0
      h ^= v; h = Math.imul(h, 16777619)
    }
    return h >>> 0
  }

  _checkReplayEnd() {
    // немного добегаем после последнего действия: шар ещё летит в трубу
    if (this.clock.tick > this.log.lastTick + TICK_RATE * 3) this.stopped = true
  }

  // Откат живой попытки на указанный тик.
  //
  // Сам пересчёт ничем не отличается от перемотки повтора: мир заново
  // проигрывает ту же запись с начала до нужного места. Отличается то, что
  // будет дальше. В повторе запись только читается, и откат — это движение
  // взгляда. В живой игре запись после отката ДОПИСЫВАЕТСЯ: игрок кладёт
  // поверх новый ввод, а прежний исчезает.
  //
  // Получается запись, по которой не видно, что до неё было пятьдесят
  // провалов: она гладкая, непротиворечивая и проигрывается один в один.
  // Именно поэтому откат нельзя просто разрешить и промолчать — иначе прогон,
  // собранный из кусков, станет неотличим от сыгранного подряд, и время
  // будет показывать только удачные куски.
  //
  // Поэтому откат остаётся в записи отметкой: где переигрывали и сколько
  // выбросили. Тогда честный прогон и собранный по кускам различимы, а
  // потраченное время видно целиком.
  //
  // В спидране откат запрещён совсем. Отметки было бы мало: даже с честно
  // посчитанным временем откат даёт то, чего нет у играющего подряд, —
  // возможность не переигрывать удавшееся начало. Прогон с откатами и прогон
  // одним заходом — разные состязания, и мерить их одной таблицей нельзя.
  rollback(tick) {
    if (this.mode !== PLAY) return false
    if (this.speedrun) return false
    const from = this.clock.tick
    const to = Math.max(0, Math.min(tick, from))
    if (to === from) return false

    this.log.truncate(to)
    this.branches.push({ at: to, lost: from - to })

    // Мир не отматывается: он строится заново по обрезанной записи. Но не
    // обязательно с самого начала — если рядом позади есть копия, считаем
    // от неё. Копии сделаны по ходу этой же игры и хранятся только в памяти.
    const shot = this.ladder?.at(to)
    const world = shot ? shot.run.world : new World(structuredClone(this.level), { seed: this.seed })
    const clock = new FixedClock(Math.round(1 / this.clock.dt))
    clock.tick = shot ? shot.tick : 0

    const cursor = this.log._cursor
    this.log.rewind()
    // курсор чтения подводим к тому месту, с которого продолжаем
    while (this.log._cursor < this.log.events.length
      && this.log.events[this.log._cursor] < clock.tick) this.log._cursor += 4

    while (clock.tick < to) {
      clock.advance(this.clock.dt, (t) => {
        for (const ev of this.log.at(t)) applyEvent(world, ev)
        world.step(TICK_DT)
      })
    }
    this.log._cursor = cursor
    this.world = world
    this.clock = clock
    this.pending = []
    this.checks.length = Math.ceil(to / CHECK_EVERY)
    // Всё, что позже отката, переигрывается — старые копии оттуда не годятся
    this.ladder?.cut(to)
    return true
  }

  // Сколько игры на самом деле потрачено: путь, который остался в записи,
  // плюс всё, что выброшено откатами. Именно это число честно сравнивать
  // с прогоном, сыгранным подряд.
  get spentTicks() { return this.clock.tick + this.branches.reduce((s, b) => s + b.lost, 0) }

  // Прогон сыгран подряд, без откатов
  get clean() { return this.branches.length === 0 }

  // --- управление -----------------------------------------------------------
  pause() { this.paused = true }
  resume() { this.paused = false }
  toggle() { this.paused = !this.paused; return this.paused }

  // Цель достигнута. Момент фиксируем тиком: это и есть результат спидрана.
  finish() {
    if (this.finished) return
    this.finished = true
    this.finishTick = this.clock.tick
    this.stopped = true
  }

  // Копия прогона целиком: мир, часы, положение в записи. Нужна перемотке —
  // отмотать назад можно только пересчитав, а от близкого снимка пересчитывать
  // недалеко.
  fork() {
    const r = Object.create(Object.getPrototypeOf(this))
    Object.assign(r, this)
    r.world = forkWorld(this.world)
    r.clock = new FixedClock(Math.round(1 / this.clock.dt))
    r.clock.tick = this.clock.tick
    r.clock._acc = this.clock._acc
    // Лог общий на оригинал и копию — он только читается при повторе. А вот
    // курсор чтения свой: копия стоит на своём месте записи.
    r.log = InputLog.from(this.log.events)
    r.log._cursor = this.log._cursor
    r.camera = CameraTrack.from(this.camera.toJSON())
    r.camera._cursor = this.camera._cursor
    r.pending = []
    r.branches = this.branches.slice()
    r.checks = this.checks.slice()
    return r
  }

  // Готовая запись попытки — то, что уйдёт в хранилище.
  snapshot() {
    return {
      levelId: this.level.id,
      seed: this.seed,
      rate: this.clock.dt ? Math.round(1 / this.clock.dt) : TICK_RATE,
      ticks: this.finished ? this.finishTick : this.clock.tick,
      finished: this.finished,
      input: this.log.toJSON(),
      camera: this.camera.toJSON(),
      checks: this.checks,
      branches: this.branches,
      speedrun: this.speedrun,
      // время «начисто» и время с учётом выброшенного откатами
      spentTicks: this.spentTicks,
      clean: this.clean,
    }
  }
}

// Повтор записи: тот же класс, только события берутся из лога.
export const replayOf = (level, rec) =>
  new Run(level, {
    mode: REPLAY, seed: rec.seed, input: rec.input,
    camera: rec.camera, checks: rec.checks, rate: rec.rate,
  })
