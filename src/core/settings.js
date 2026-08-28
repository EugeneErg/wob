// Настройки игрока. Хранятся отдельно от прогресса и записей: это про то, как
// человеку удобно, а не про то, что он прошёл.

const KEY = 'goo.settings.v1'

// Предел частоты отрисовки. На симуляцию не влияет вообще: тик всегда 60 Гц,
// поэтому результат прохождения от этой настройки не зависит — она про то,
// сколько раз в секунду перерисовывается картинка.
//
// Зачем её вообще давать. На слабой машине тяжёлый уровень не успевает
// отрисоваться за кадр, и время уходит на отрисовку вместо симуляции: игра
// начинает дёргаться. Ограничив отрисовку, можно вернуть плавность хода.
// А кому-то наоборот нужен предел повыше монитора.
export const FPS_OPTIONS = [30, 60, 90, 120, 144, 240, 0]   // 0 — без предела

const DEFAULTS = {
  fpsCap: 0,
  showFps: true,
}

let cache = null

export function settings() {
  if (cache) return cache
  try { cache = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) } } catch { cache = { ...DEFAULTS } }
  return cache
}

export function setSetting(key, value) {
  const s = settings()
  s[key] = value
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* некуда сохранить — не беда */ }
  return s
}

export const fpsLabel = (n) => (n ? `${n}` : 'без предела')
