// Единственный словарь, который знают одновременно и мир, и сущности.
// Всё остальное — приватное дело сущности.
//
// Правило: если свойство влияет на ВЗАИМОДЕЙСТВИЕ тел — оно здесь.
// Если это внешний вид или внутренняя логика — оно живёт внутри сущности.

export const GLOBAL_PROPS = {
  mass: { label: 'Вес', default: 1 },
  restitution: { label: 'Упругость', default: 0.2, min: 0, max: 1 },
  smoothness: { label: 'Гладкость', default: 0.5, min: 0, max: 1 },
  collision: { label: 'Коллизия', default: { world: true, points: true } },
  attachable: { label: 'Можно прилепить связь', default: false },
  suction: { label: 'Всасывание', default: 0, min: 0, max: 3 },
}

export const GLOBAL_KEYS = Object.keys(GLOBAL_PROPS)

// Слои отрисовки — общая для мира ось глубины, как z-index.
// Сущность выбирает слой для каждой фигуры; по умолчанию берётся z сущности.
export const LAYERS = {
  background: -60,
  ground: -20,
  midground: 0,   // между рельефом и конструкцией
  structure: 5,   // связи — всегда под телами
  body: 20,
  overlay: 70,    // то, что игрок тащит
}

// События мира. Сущность сообщает о прогрессе к цели уровня этим именем,
// а не своим: интерфейс считает очки, не зная, кто их принёс.
export const EVENTS = {
  progress: 'goal:progress',   // { delta } — засчитать шаг к цели уровня
  missing: 'entity:missing',   // { type } — в уровне есть сущность, которой нет в сборке
}

// Глобальные свойства связи (их выставляет тот, кто связь создал,
// а уважает весь мир): stiffness, breakStrain, visible.
