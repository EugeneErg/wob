// Уровень для проверки берётся из той же библиотеки, что и в игре.
// Отдельных копий в src/levels больше нет: копия молча расходится с оригиналом,
// и тест начинает проверять уровень, которого никто не видит.
import { readFileSync } from 'fs'

const library = JSON.parse(readFileSync(new URL('../src/levels/library.json', import.meta.url), 'utf8'))

export function level(id) {
  const found = library.levels.find((l) => l.id === id)
  if (!found) throw new Error(`в библиотеке нет уровня ${id}`)
  return structuredClone(found)
}
