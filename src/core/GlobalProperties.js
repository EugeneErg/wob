// core/GlobalProperties.js
//
// Свойства, влияющие на ВЗАИМОДЕЙСТВИЕ сущностей друг с другом.
// Мир опирается только на эти ключи, а не на конкретные типы сущностей —
// это то, что позволяет добавлять новые сущности без изменения физики/движка.
//
// Намеренно НЕ включены сюда: цвет, центр вращения и т.п. — это не влияет
// на взаимодействие и остаётся полностью в ответственности самой сущности.

export const PROP = Object.freeze({
  WEIGHT: 'weight',         // число (кг) либо Infinity для статики
  COLLISION: 'collision',   // bool — участвует ли в столкновениях
  SMOOTHNESS: 'smoothness', // 0..1, 0 = максимальное трение, 1 = лёд
  BONDABLE: 'bondable',     // bool — можно ли создавать связь (stick) с сущностью
  Z_INDEX: 'zIndex',        // число — приоритет отрисовки (шары всегда выше и т.д.)
})

const DEFAULTS = {
  [PROP.WEIGHT]: 1,
  [PROP.COLLISION]: true,
  [PROP.SMOOTHNESS]: 0.5,
  [PROP.BONDABLE]: false,
  [PROP.Z_INDEX]: 0,
}

/**
 * Считывает глобальное свойство сущности в рантайме.
 * Свойство в определении сущности может быть константой ИЛИ функцией —
 * функция вызывается каждый раз, что позволяет свойству быть динамическим
 * (например шар может "тяжелеть" по игровой логике).
 *
 * @param {object} instance - инстанс сущности { type, id, state, ... }
 * @param {import('./EntityRegistry').EntityDefinition} definition
 * @param {string} propKey - один из PROP.*
 * @param {object} [world] - контекст мира, прокидывается в геттер при необходимости
 */
export function readProperty(instance, definition, propKey, world) {
  const raw = definition?.properties?.[propKey]
  if (typeof raw === 'function') {
    return raw(instance.state, instance, world)
  }
  if (raw !== undefined) return raw
  return DEFAULTS[propKey]
}
