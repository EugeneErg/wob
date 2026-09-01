// Засев библиотеки встроенным содержимым — для тестов.
//
// Игра его больше не везёт: всё, во что можно играть, приходит из каталога с
// сервера, и `src/levels/library.json` остался тестовыми данными (а заодно
// тем, чем наполняется свежий бэк). Раньше библиотека засевала себя сама при
// первом обращении, и тесты этим пользовались молча; теперь засев виден в коде
// теста, что и правильнее — видно, с чего начинается проверка.

import { readFileSync } from 'node:fs'

export const builtin = () =>
  JSON.parse(readFileSync(new URL('../src/levels/library.json', import.meta.url), 'utf8'))

export function seed(lib) {
  lib.save(structuredClone(builtin()))

  return lib.library()
}
