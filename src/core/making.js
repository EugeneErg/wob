// Создание содержимого: сначала сервер, потом библиотека.
//
// Всё остальное здесь устроено наоборот — правка ложится в локальную библиотеку
// сразу, а очередь досылает её, когда сможет. Создание так не умеет: имя выдаёт
// сервер, и до ответа класть к себе нечего. Положить с придуманным именем и
// поправить потом — это и есть та схема, из-за которой имя жило в двух местах,
// а каждое следующее сохранение уходило по несуществующему id.
//
// Отсюда следует то, что видно пользователю: без аккаунта содержимое не
// создаётся. Не потому, что так решили, а потому, что назвать его некому.

import { api } from './api.js'
import * as lib from './library.js'

import { session } from './session.js'

export class NeedsAccount extends Error {
  constructor() {
    super('Sign in to create — stories are kept in your account.')
    this.name = 'NeedsAccount'
  }
}

function assertSignedIn() {
  if (session.status !== 'signed-in') throw new NeedsAccount()
}

/**
 * Выпустить историю.
 *
 * Черновик замораживается в релиз на сервере — здесь ничего не сохраняется и
 * сохраняться не должно. Прежняя публикация делала снимок в localStorage, и это
 * было изобретением: снимок не видел никто, кроме сделавшего его автора, а
 * номер релиза считался по длине местного списка, так что на другой машине тот
 * же релиз назывался бы иначе.
 *
 * Выпуск не делает историю доступной остальным. Для этого автор должен пройти
 * в ней каждый уровень, и засчитывает это сервер по тому, что видел сам.
 */
export async function releaseStory(storyId) {
  assertSignedIn()

  return api.post(`/api/stories/${storyId}/publish`)
}

/** Версии, которые уже выпущены. */
export async function storyReleases(storyId) {
  assertSignedIn()

  return api.get(`/api/stories/${storyId}/releases`)
}



export async function makeStory(title, extra = {}) {
  assertSignedIn()

  const made = await api.post('/api/stories', {
    title,
    cover: extra.cover || 'linear-gradient(140deg,#2b4a5c,#16242b)',
    intro: extra.intro || '',
    chapter: { title: 'Chapter 1', image: 'linear-gradient(160deg,#1d3040,#0f1a20)' },
  })

  return lib.createStory({ id: made.id, chapterId: made.chapterId }, title, extra)
}

export async function makeChapter(storyId, title, extra = {}) {
  assertSignedIn()

  const made = await api.post(`/api/stories/${storyId}/chapters`, {
    title,
    image: extra.image || 'linear-gradient(160deg,#1d3040,#0f1a20)',
  })

  return lib.createChapter(storyId, made.id, title, extra)
}

/**
 * Уровень, которому ещё не выбрали место.
 *
 * Сервер о нём знает сразу: редактор начинает сохранять с первой правки, и
 * уровень, известный только браузеру, тут же получил бы 404.
 */
export async function makeSpareLevel(storyId, name) {
  assertSignedIn()

  const made = await api.post(`/api/stories/${storyId}/levels`, {
    chapterId: null,
    name: name || 'Level',
  })

  return lib.createLevelIn(storyId, made.id, name)
}

/** Уровень сразу с точкой на карте главы. */
export async function makeLevel(storyId, chapterId, name, at = {}) {
  assertSignedIn()

  const made = await api.post(`/api/stories/${storyId}/levels`, {
    chapterId,
    name: name || 'Level',
    x: at.x ?? 50,
    y: at.y ?? 50,
  })

  return lib.createLevel(chapterId, { id: made.id, nodeId: made.nodeId }, name)
}

/**
 * Ещё одна точка для уже существующего уровня.
 *
 * Точку сервер называет вместе с уровнем, а отдельного «назови точку» у него
 * нет — карта главы сохраняется целиком. Поэтому имя берётся из ответа на
 * создание, а сама карта уезжает следом обычным сохранением.
 */
export async function makePoint(storyId, chapterId, levelId, at = {}) {
  assertSignedIn()

  const made = await api.post(`/api/stories/${storyId}/points`, {
    chapterId,
    levelId,
    x: at.x ?? 50,
    y: at.y ?? 50,
  })

  return lib.pinLevel(chapterId, levelId, made.nodeId, at)
}

export async function makeAsset({ title, entities }) {
  assertSignedIn()

  const made = await api.post('/api/assets', { title, entities })

  return lib.createAsset({ id: made.id, title, entities })
}
