// core/EntityRegistry.js
//
// Единая точка регистрации сущностей. Игровой компонент и редактор
// работают ТОЛЬКО через этот реестр — они не импортируют entities/* напрямую.
// Чтобы добавить новую сущность в проект, нужна одна строка в entities/index.js.

const registry = new Map()

/**
 * @typedef {Object} EntityDefinition
 * @property {string} type - уникальный ключ сущности, напр. 'rock'
 * @property {string} name - отображаемое имя (для кнопки в редакторе)
 * @property {string} [icon] - эмодзи/иконка для кнопки в редакторе
 * @property {(id: string, initProps: object) => object} createInstance
 *    Фабрика инстанса сущности. Возвращает произвольный state-объект,
 *    сущность сама решает свою форму данных.
 * @property {Object.<string, any|Function>} properties
 *    Глобальные свойства взаимодействия. Значение — либо константа,
 *    либо функция (state, instance, world) => value, читается в рантайме.
 * @property {Object} [physics]
 * @property {(instance: object, dt: number, world: object) => void} [physics.update]
 *    Кастомный шаг физики сущности (например труба, засасывающая шары).
 * @property {import('vue').Component} GameComponent - рендер в игровом режиме
 * @property {import('vue').Component} EditorComponent - рендер в редакторе
 * @property {Object} [editor] - поведение сущности в редакторе (см. entities/*)
 */

/** @param {EntityDefinition} definition */
export function registerEntity(definition) {
  if (!definition || !definition.type) {
    throw new Error('[EntityRegistry] У сущности должен быть уникальный "type"')
  }
  if (registry.has(definition.type)) {
    console.warn(`[EntityRegistry] Сущность "${definition.type}" уже зарегистрирована — перезаписываю`)
  }
  registry.set(definition.type, definition)
}

export function getEntityDefinition(type) {
  return registry.get(type)
}

export function getAllEntityDefinitions() {
  return Array.from(registry.values())
}

export function hasEntity(type) {
  return registry.has(type)
}
