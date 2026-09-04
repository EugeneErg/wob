// Отладочные снимки: картинка экрана и выгрузка состояния.
//
// Нужны, чтобы разговор об ошибке шёл о фактах, а не о пересказе. «Шар
// застревает в трубе» — это описание; снимок экрана плюс выгрузка состояния —
// это воспроизводимый случай: видно и что было на экране, и на каком тике, и
// с каким сидом, и какую запись при этом играли.
//
// Ничего из этого не участвует в игре и не влияет на симуляцию.

// --- снимок экрана -----------------------------------------------------------
//
// Сцена и так рисуется в SVG, поэтому снимок — это сама разметка сцены, без
// растеризации. Так снимок остаётся вектором: его можно открыть в браузере,
// увеличить любой кусок, а главное — прочитать глазами и посмотреть, из каких
// именно фигур сложилась картинка. На растре видно только то, что видно, а
// по разметке видно, почему.
export function snapshotSVG(svg) {
  if (!svg) return null
  const box = svg.viewBox?.baseVal
  const w = Math.max(1, Math.round(box?.width || svg.clientWidth || 1600))
  const h = Math.max(1, Math.round(box?.height || svg.clientHeight || 900))

  // Клон, а не сам узел: в разметку надо дописать размеры и пространство имён,
  // а живое дерево трогать нельзя — оно на экране.
  const clone = svg.cloneNode(true)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', w)
  clone.setAttribute('height', h)

  // Стили лежат в отдельном файле сборки, и в вынутой разметке их не будет.
  // Тащить всю таблицу стилей незачем — цвета сцены заданы прямо на фигурах,
  // — но фон нужен, иначе снимок открывается прозрачным.
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  bg.setAttribute('x', box?.x ?? 0)
  bg.setAttribute('y', box?.y ?? 0)
  bg.setAttribute('width', w)
  bg.setAttribute('height', h)
  bg.setAttribute('fill', '#16242b')
  clone.insertBefore(bg, clone.firstChild)

  const markup = new XMLSerializer().serializeToString(clone)
  return new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${markup}`], {
    type: 'image/svg+xml;charset=utf-8',
  })
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

export function saveScreenshot(svg, tag = 'screenshot') {
  const blob = snapshotSVG(svg)
  if (blob) download(blob, `${tag}-${stamp()}.svg`)
  return !!blob
}

// --- выгрузка состояния ------------------------------------------------------
//
// Всё, что игра о себе помнит, лежит в localStorage: библиотека, прогресс,
// записи попыток, релизы. Выгружаем целиком — чтобы случай воспроизводился
// у другого человека на другой машине, а не «у меня не повторяется».
//
// Момент выгружается так же, как спидран: сид и запись ввода, а не слепок
// физики. Частицы, скорости, связи, выкопанные полигоны — всё это ничего не
// добавляет: симуляция детерминирована, и то же состояние получается из тех
// же сида и ввода. Слепок был бы вдесятеро тяжелее, устаревал бы при каждой
// правке физики и не позволял бы отмотать назад, а запись позволяет —
// открыл её как обычный повтор и встал на любой тик до нужного.
export function dumpState(extra = {}) {
  const storage = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k.startsWith('goo.')) continue
    try { storage[k] = JSON.parse(localStorage.getItem(k)) } catch { storage[k] = localStorage.getItem(k) }
  }
  return {
    version: 1,
    at: new Date().toISOString(),
    // Чем отличается эта сборка: без версии правил выгрузка бесполезна,
    // потому что физика могла поменяться.
    agent: typeof navigator !== 'undefined' ? navigator.userAgent : 'node',
    screen: typeof window !== 'undefined'
      ? { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }
      : null,
    // где игрок был и что играл: ссылки на версии и запись попытки
    now: { ...extra },
    storage,
  }
}

export function saveState(extra = {}, tag = 'state') {
  const json = JSON.stringify(dumpState(extra), null, 2)
  download(new Blob([json], { type: 'application/json' }), `${tag}-${stamp()}.json`)
}

// Загрузить выгрузку обратно: тот же случай на другой машине. Заменяет всё
// содержимое localStorage, поэтому спрашивать подтверждение обязан вызывающий.
export function loadState(dump) {
  if (!dump?.storage) return false
  for (const k of Object.keys(localStorage)) if (k.startsWith('goo.')) localStorage.removeItem(k)
  for (const [k, v] of Object.entries(dump.storage)) {
    localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v))
  }
  return true
}
