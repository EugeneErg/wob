// Отставание от призрака.
//
// Сравнивать прогоны по номеру тика бессмысленно: оба игрока на 400-м тике,
// но один уже отправил три шара в трубу, а другой ни одного. Число само по
// себе ничего не говорит.
//
// Сравнивать надо на общих отметках — на том, что случилось и там и там.
// Отметка здесь одна и естественная: сколько шаров дошло до цели. «Третий шар:
// у тебя на 4.2 с, у призрака на 3.6 с» — вот это спидранеру и нужно, потому
// что показывает, ГДЕ он потерял время, а не только сколько.

// Отметки хранятся разреженным массивом: splits[n] — тик, на котором цель
// была достигнута в n-й раз. Нулевой элемент не используется, отсчёт с единицы.
export const addSplit = (splits, count, tick) => { splits[count] = tick; return splits }

// Отставание на последней общей отметке, в тиках.
// Плюс — игрок медленнее призрака, минус — быстрее, null — сравнивать не с чем.
export function gapAt(mine, theirs) {
  if (!mine || !theirs) return null
  const upto = Math.min(mine.length, theirs.length) - 1
  for (let i = upto; i >= 1; i--) {
    if (mine[i] != null && theirs[i] != null) return mine[i] - theirs[i]
  }
  return null
}

// На скольких отметках уже можно сравнивать
export function commonSplits(mine, theirs) {
  if (!mine || !theirs) return 0
  let n = 0
  const upto = Math.min(mine.length, theirs.length) - 1
  for (let i = 1; i <= upto; i++) if (mine[i] != null && theirs[i] != null) n++
  return n
}

// Отставание на каждой общей отметке — на подробный разбор после попытки:
// видно не только итог, но и на каком шаре прогон разъехался.
export function allGaps(mine, theirs) {
  const out = []
  const upto = Math.min(mine?.length ?? 0, theirs?.length ?? 0) - 1
  for (let i = 1; i <= upto; i++) {
    if (mine[i] != null && theirs[i] != null) out.push({ at: i, gap: mine[i] - theirs[i] })
  }
  return out
}
