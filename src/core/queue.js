// Очередь записи: каждая правка уезжает на сервер сама.
//
// Предыдущий вариант отправлял историю целиком по кнопке «Save», и это было
// неверно по одной причине: всё, что до кнопки, жило только в браузере.
// Закрытая вкладка, вычищенное хранилище, сломанный ноутбук — и вечер работы
// исчезает. Теперь на сервер уходит каждый элемент в момент изменения.
//
// Очередь, а не прямые вызовы, из-за трёх вещей, каждая из которых иначе теряет
// труд:
//
//   - порядок. Создание уровня и его сохранение — две записи, и вторая без
//     первой бессмысленна. Параллельные запросы приходят вразнобой;
//   - обрыв связи. Неудавшаяся запись остаётся в очереди и повторяется, а не
//     пропадает вместе с правкой;
//   - перезагрузка. Очередь лежит в localStorage, поэтому закрытая на середине
//     отправки вкладка ничего не уносит с собой.
//
// Версии историй сервер проверяет на каждой записи, поэтому очередь ещё и
// последовательная по необходимости: две одновременные правки одной истории
// гарантированно получили бы конфликт.

import { api, ApiError } from './api.js'

const KEY = 'goo.queue.v1'
const VERSIONS = 'goo.storyver.v1'

/**
 * Что происходит с очередью.
 *
 * Обычный объект, а не реактивный: очередь — модуль ядра, и тащить сюда Vue
 * значило бы затянуть UI-фреймворк в то, что обязано работать в голом Node.
 * Реактивность добавляет тот, кому она нужна, — обёрткой на стороне
 * компонента.
 */
export const queueState = {
  pending: 0,
  saving: false,
  // 'ok' | 'offline' | 'conflict' — что показать автору. Молчать здесь нельзя:
  // человек, уверенный, что работа сохранена, узнает обратное в худший момент.
  status: 'ok',
  error: null,
}

// Кто хочет знать об изменениях.
//
// Подписка, а не реактивный объект: очередь — модуль ядра и обязана работать в
// голом Node, а реактивность нужна только интерфейсу. Пусть он её и добавляет.
const listeners = new Set()

export function onQueueChange(fn) {
  listeners.add(fn)

  return () => listeners.delete(fn)
}

function announce() {
  for (const fn of listeners) fn({ ...queueState })
}

const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}

const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Хранилище переполнено. Правка всё равно уже в памяти и уедет, если
    // очередь доживёт до отправки.
  }
}

let queue = read(KEY, [])
queueState.pending = queue.length

const versions = () => read(VERSIONS, {})
export const versionOf = (storyId) => versions()[storyId] ?? 0
const setVersion = (storyId, version) => write(VERSIONS, { ...versions(), [storyId]: version })

/**
 * Поставить запись в очередь.
 *
 * Возвращается сразу: редактор не должен ждать сеть, чтобы нарисовать то, что
 * автор уже сделал. Ответственность очереди — довезти.
 */
export function enqueue(op) {
  queue.push({ ...op, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` })
  write(KEY, queue)
  queueState.pending = queue.length
  announce()
  drain()
}

let draining = false

async function drain() {
  if (draining || queue.length === 0) return

  draining = true
  queueState.saving = true

  try {
    while (queue.length > 0) {
      const op = queue[0]

      try {
        await send(op)
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          // История изменилась в другом месте. Дальше слать бессмысленно:
          // каждая следующая запись получит тот же отказ, а автор рискует
          // затереть чужую работу вслепую.
          queueState.status = 'conflict'
          queueState.error = 'This story changed somewhere else. Reload before editing further.'
          announce()

          return
        }

        // Отказ, который не пройдёт никогда: уровня нет, доступа нет, тело не
        // принято. Повторять такое бессмысленно — правка застревает первой в
        // очереди и блокирует все, что за ней, повторяясь каждые две секунды до
        // конца сессии. Ровно это и случалось с уровнем, созданным в панели, но
        // не отправленным на сервер: PUT по несуществующему id, 404, и так по
        // кругу.
        //
        // Такую правку выкидываем и идём дальше, а автору говорим вслух: она
        // потеряна, и молчать об этом — худшее из возможного.
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
          queue.shift()
          write(KEY, queue)
          queueState.pending = queue.length
          queueState.status = 'offline'
          queueState.error = `Не сохранилось: ${e.message}`
          announce()
          setTimeout(drain, 0)

          return
        }

        // Сеть или сервер. Ничего не выбрасываем: правка остаётся первой в
        // очереди и уйдёт при следующей попытке.
        queueState.status = 'offline'
        queueState.error = e.message
        announce()
        setTimeout(drain, 2000)

        return
      }

      queue.shift()
      write(KEY, queue)
      queueState.pending = queue.length
      announce()
    }

    queueState.status = 'ok'
    queueState.error = null
    announce()
  } finally {
    draining = false
    queueState.saving = queue.length > 0
    announce()
  }
}

async function send(op) {
  // Версия — свойство истории: она защищает от того, что двое правят одну
  // историю с разных вкладок. У правок без истории (полка ассетов — она общая
  // и ничьей истории не принадлежит) сравнивать нечего, и слать номер, который
  // ни с чем не сверяется, значит делать вид, что защита есть.
  const body = op.storyId === null
    ? op.body
    : { ...op.body, version: versionOf(op.storyId) }

  const result = await api[op.method](op.path, body)

  if (op.storyId !== null && result && typeof result.version === 'number') {
    setVersion(op.storyId, result.version)
  }
}

/** Забыть очередь и версии — после выхода из аккаунта. */
export function forgetQueue() {
  queue = []
  write(KEY, queue)
  write(VERSIONS, {})
  queueState.pending = 0
  queueState.status = 'ok'
  queueState.error = null
}

/** Попробовать снова — после конфликта, когда автор перечитал историю. */
export function retry() {
  queueState.status = 'ok'
  queueState.error = null
  drain()
}

// Вкладка вернулась в фокус или сеть ожила — самое время досылать.
if (typeof window !== 'undefined') {
  window.addEventListener('online', drain)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) drain()
  })

  // Не гарантия, но лучше, чем ничего: если очередь непуста, предупредить.
  window.addEventListener('beforeunload', (e) => {
    if (queue.length === 0) return

    e.preventDefault()
    e.returnValue = ''
  })

  drain()
}
