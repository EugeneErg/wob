// Правки автора, уходящие на сервер поштучно.
//
// Каждая функция здесь — одно изменение, которое ставится в очередь и
// доезжает само. Ничего не ждёт сети: редактор рисует то, что автор уже
// сделал, а довезти — забота очереди.
//
// Пакетной отправки «всей истории по кнопке» здесь намеренно нет. Она была, и
// её главный порок в том, что до нажатия кнопки работа существует только в
// браузере: закрытая вкладка уносит вечер. Два пути записи одних и тех же
// данных вдобавок неизбежно расходятся, поэтому остался один — этот.

import { api } from './api.js'
import { enqueue } from './queue.js'

export const createStory = (story, chapter) => enqueue({
  storyId: story.id,
  method: 'post',
  path: '/api/stories',
  body: {
    id: story.id,
    title: story.title,
    cover: story.cover || '#1a2b33',
    intro: story.intro || '',
    chapter: { id: chapter.id, title: chapter.title, image: chapter.image || '#123' },
  },
})

export const renameStory = (story) => enqueue({
  storyId: story.id,
  method: 'patch',
  path: `/api/stories/${story.id}`,
  body: { title: story.title, cover: story.cover, intro: story.intro || '', startNodeId: story.start || null },
})

export const deleteStory = (storyId) => enqueue({
  storyId,
  method: 'del',
  path: `/api/stories/${storyId}`,
  body: {},
})

export const createChapter = (storyId, chapter) => enqueue({
  storyId,
  method: 'post',
  path: `/api/stories/${storyId}/chapters`,
  body: { id: chapter.id, title: chapter.title, image: chapter.image || '#123' },
})

/**
 * Карта главы целиком.
 *
 * Единственное место, где отправляется не один объект: узлы, тропы и выходы —
 * это один жест автора. Он перетащил точку, дорисовал тропу и отпустил мышь;
 * дробить это на три записи значило бы завести возможность сохранить карту
 * наполовину.
 */
/*
 * Мелкие правки карты: по одной на движение руки.
 *
 * Ниже лежит saveChapterMap, отправляющий карту целиком. Это неверная единица
 * записи: подвинул одну точку — уехал весь набор, поэтому две правки в одной
 * главе спорили всегда, даже если касались разных мест. Спор разнимали номером
 * версии, а номер клиент был обязан угадать — отсюда и конфликты на создании
 * уровня, которое ни с чем конфликтовать не может.
 *
 * Эти четыре ничего не угадывают. Разные точки не пересекаются, одна и та же
 * сходится к последней правке — так же, как на любой доске с одновременным
 * редактированием.
 */
export const moveNode = (storyId, chapterId, node) => enqueue({
  storyId,
  method: 'patch',
  path: `/api/stories/${storyId}/chapters/${chapterId}/nodes/${node.id}`,
  body: { x: node.x, y: node.y },
})

export const describeNode = (storyId, chapterId, node) => enqueue({
  storyId,
  method: 'patch',
  path: `/api/stories/${storyId}/chapters/${chapterId}/nodes/${node.id}`,
  body: { name: node.name || '', image: node.image || '', outro: node.outro || '' },
})

export const describeChapter = (storyId, chapter) => enqueue({
  storyId,
  method: 'patch',
  path: `/api/stories/${storyId}/chapters/${chapter.id}`,
  body: { title: chapter.title, image: chapter.image || '', map: chapter.map || '' },
})

/*
 * Связи идут напрямую, а не через очередь, и их ответ ждут.
 *
 * Всё остальное здесь можно отправить и забыть: переезд точки, подпись, фон
 * главы — сервер их не отвергает. Связь отвергает: она единственная способна
 * замкнуть кольцо или вернуть путь в покинутую главу, и решает это сервер.
 *
 * Очередь при отказе 4xx молча выбрасывает запрос и идёт дальше. Для связи это
 * означало расхождение: на экране линия есть, на сервере её нет — и автор видит
 * у себя кольцо, которого в истории не существует. Поэтому здесь ответа ждут и
 * при отказе снимают связь обратно.
 */
export const linkNodes = (storyId, from, to) =>
  api.post(`/api/stories/${storyId}/links`, { from, to })

export const unlinkNodes = (storyId, from, to) =>
  api.del(`/api/stories/${storyId}/links/${from}/${to}`)

export const saveChapterMap = (storyId, chapter) => enqueue({
  storyId,
  method: 'put',
  path: `/api/stories/${storyId}/chapters/${chapter.id}/map`,
  body: {
    title: chapter.title,
    image: chapter.image || '',
    map: chapter.map || '',
    canvas: chapter.canvas || null,
    nodes: (chapter.nodes || []).map((n) => ({
      id: n.id, levelId: n.levelId, x: n.x, y: n.y,
      next: n.next || [], name: n.name || '', image: n.image || '', outro: n.outro || '',
    })),
  },
})

/*
 * Удаление главы ждёт ответа, а не уходит в очередь.
 *
 * Оно необратимо, и промолчать об отказе тут хуже всего: автор увидит, что
 * главы нет, закроет вкладку — а на сервере она осталась.
 */
export const deleteChapter = (storyId, chapterId) =>
  api.del(`/api/stories/${storyId}/chapters/${chapterId}`)

const _deleteChapterQueued = (storyId, chapterId) => enqueue({
  storyId,
  method: 'del',
  path: `/api/stories/${storyId}/chapters/${chapterId}`,
  body: {},
})

export const createLevel = (storyId, chapterId, level, at) => enqueue({
  storyId,
  method: 'post',
  path: `/api/stories/${storyId}/levels`,
  // chapterId === null — уровень пока нигде не лежит. Такой уровень всё равно
  // должен появиться на сервере сразу: редактор начнёт его сохранять раньше,
  // чем автор решит, в какую главу его положить.
  body: { id: level.id, chapterId: chapterId ?? null, nodeId: at?.id ?? null, name: level.name, x: at?.x ?? 50, y: at?.y ?? 50 },
})

/** Содержимое уровня. Уходит после каждой законченной правки, а не по кнопке. */
export const saveLevel = (storyId, level) => enqueue({
  storyId,
  method: 'put',
  path: `/api/stories/${storyId}/levels/${level.id}`,
  body: {
    name: level.name,
    width: level.width,
    height: level.height,
    gravity: level.gravity,
    goal: level.goal,
    entities: level.entities || [],
    hot: level.hot || [],
    image: level.image || '',
  },
})

/**
 * Полка ассетов.
 *
 * Раньше ассеты ездили только внутри пакета библиотеки, то есть полка была
 * клиентской, а сервер держал слепок с последней заливки. Ассет переживает и
 * историю, в которой сделан, и браузер, поэтому пишется поштучно, как всё
 * остальное здесь.
 */
export const createAsset = (asset) => enqueue({
  storyId: null,
  method: 'post',
  path: '/api/assets',
  body: { id: asset.id, title: asset.title, entities: asset.entities },
})

export const saveAsset = (asset) => enqueue({
  storyId: null,
  method: 'patch',
  path: `/api/assets/${asset.id}`,
  body: { title: asset.title, entities: asset.entities },
})

export const deleteAsset = (assetId) => enqueue({
  storyId: null,
  method: 'del',
  path: `/api/assets/${assetId}`,
  body: {},
})

export const deleteLevel = (storyId, chapterId, levelId) => enqueue({
  storyId,
  method: 'del',
  path: `/api/stories/${storyId}/chapters/${chapterId}/levels/${levelId}`,
  body: {},
})
