// Копия мира целиком.
//
// Нужна ради дешёвой отмотки. Симуляция идёт только вперёд, поэтому встать на
// прошлый тик можно лишь пересчитав всё с начала — на уровне с водой это
// двадцать секунд ожидания на минуту записи, и покадровый разбор там был
// невозможен. С копией достаточно держать снимок неподалёку позади и считать
// от него.
//
// Почему это не structuredClone. Мир — не дерево данных, а граф ссылок: у
// сущности в rt лежит та же самая точка, что и в хранилище частиц, та же
// связь, что в списке связей, тот же коллайдер. Обычное глубокое копирование
// размножило бы их: у копии сущность двигала бы свою точку, а решатель — свою,
// и мир разъехался бы не сразу, а через десяток тиков, когда расхождение
// накопится. Поэтому здесь копирование с подстановкой: каждый объект физики
// копируется ровно один раз, а все ссылки на него заменяются на копию.
//
// Проверяется это не рассуждением, а испытанием: снимок делается посреди
// прогона, обе половины досчитываются до конца, и отпечатки миров обязаны
// совпасть до последнего знака (tests/fork.mjs).

import { ParticleStore, Point } from './particles.js'
import { Rng } from './rng.js'

// --- копия хранилища частиц ---------------------------------------------------
// Числа лежат в типизированных массивах, копируются целиком. Ручки (Point)
// пересоздаются на тех же местах: индекс — это и есть личность точки.
function forkStore(src) {
  const out = new ParticleStore(src.cap)
  out.n = src.n
  out.gen = src.gen
  for (const k of Object.keys(src)) {
    const v = src[k]
    if (ArrayBuffer.isView(v)) out[k] = v.slice()
  }
  // Interner переводит имя группы в число. Копируем как есть: имена — строки
  // из содержимого уровня, они одинаковы у оригинала и копии.
  out.groups.map = new Map(src.groups.map)
  out.groups.list = src.groups.list.slice()
  out.groups.cohesive = new Set(src.groups.cohesive)
  return out
}

// --- копирование с подстановкой -----------------------------------------------
// map хранит соответствие «объект оригинала → объект копии». Всё, что уже
// скопировано, второй раз не копируется, а берётся из неё — иначе граф ссылок
// превратился бы в дерево с размноженными узлами.
function cloner(map) {
  const clone = (v) => {
    if (v === null || typeof v !== 'object') return v
    if (map.has(v)) return map.get(v)

    // Генератор случайных чисел держит состояние в замыкании, а не в полях.
    // Скопировать его как обычный объект нельзя: функция next досталась бы
    // копии по ссылке, и оба мира тянули бы числа из одного потока. Тогда
    // копия ведёт себя правдоподобно, но иначе — а поймать это можно только
    // на сущностях, которые спрашивают случайность, и не сразу.
    //
    // Поток восстанавливается из сида и числа обращений: то и другое —
    // обычные поля, и по ним состояние определяется однозначно.
    if (v instanceof Rng) {
      const r = new Rng(v.seed)
      for (let i = 0; i < v.calls; i++) r.next()
      map.set(v, r)
      return r
    }
    if (ArrayBuffer.isView(v)) { const c = v.slice(); map.set(v, c); return c }
    if (Array.isArray(v)) {
      const c = []
      map.set(v, c)
      for (const item of v) c.push(clone(item))
      return c
    }
    if (v instanceof Map) {
      const c = new Map()
      map.set(v, c)
      for (const [k, val] of v) c.set(clone(k), clone(val))
      return c
    }
    if (v instanceof Set) {
      const c = new Set()
      map.set(v, c)
      for (const item of v) c.add(clone(item))
      return c
    }
    // Обычный объект: сохраняем прототип, чтобы методы никуда не делись
    const c = Object.create(Object.getPrototypeOf(v))
    map.set(v, c)
    for (const k of Object.keys(v)) c[k] = clone(v[k])
    return c
  }
  return clone
}

// --- копия мира ---------------------------------------------------------------
export function forkWorld(world) {
  const map = new Map()
  const clone = cloner(map)

  const ph = world.physics
  const store = forkStore(ph.store)
  map.set(ph.store, store)

  // Точки заводим до всего остального: на них ссылается почти всё, и они
  // должны попасть в таблицу подстановки раньше, чем встретятся в ссылках.
  const handles = []
  for (let i = 0; i < ph.store.handle.length; i++) {
    const h = ph.store.handle[i]
    if (!h) continue
    const p = new Point(store, i)
    store.handle[i] = p
    map.set(h, p)
    handles.push([h, p])
  }

  // На саму точку сущности вешают свои поля: игровой шар помечает её как
  // пригодную для присоединения, труба — как всасывающую, конструкция — чьей
  // она стала. Числа физики лежат в хранилище и копируются массивами, а вот
  // эти поля живут на объекте ручки, и без них копия выглядит правильной, но
  // ведёт себя иначе: шар рядом с трубой перестаёт в неё проходить.
  //
  // Копируются вторым проходом: к этому моменту все точки уже в таблице
  // подстановки, поэтому ссылки друг на друга встанут на копии, а не на
  // оригиналы.
  for (const [h, p] of handles) {
    for (const k of Object.keys(h)) {
      if (k === '_s' || k === '_i') continue   // адрес в хранилище у копии свой
      p[k] = clone(h[k])
    }
  }

  // Сам решатель: числа копируем, списки — с подстановкой.
  const phys = Object.create(Object.getPrototypeOf(ph))
  map.set(ph, phys)
  for (const k of Object.keys(ph)) {
    if (k === 'store') { phys.store = store; continue }
    phys[k] = clone(ph[k])
  }
  // _points — кэш, который решатель пересобирает по метке поколения. Проще
  // сбросить, чем копировать: пересоберётся сам на первом же шаге.
  phys._points = []
  phys._pgen = -1

  const w = Object.create(Object.getPrototypeOf(world))
  map.set(world, w)
  for (const k of Object.keys(world)) {
    if (k === 'physics') { w.physics = phys; continue }
    // Подписчики не копируются: у копии свои слушатели, и вешает их тот, кто
    // копию завёл. Иначе события копии полетели бы в интерфейс оригинала.
    if (k === '_listeners') { w._listeners = new Map(); continue }
    w[k] = clone(world[k])
  }
  return w
}
