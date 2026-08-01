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
