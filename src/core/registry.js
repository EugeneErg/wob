// Реестр сущностей. Игра и редактор работают только с этим списком
// и с контрактом сущности — конкретных типов они не знают.
//
// Контракт (все поля опциональны, кроме type/defaults/shapes):
//
// {
//   type, title, icon, z,
//   defaults(): data                       // данные новой сущности
//   spawn(ctx, data): rt                   // создать тела в мире, вернуть рантайм
//   update(rt, ctx, dt, data)              // логика кадра
//   shapes(data, rt): Shape[]              // отрисовка (rt === null в редакторе)
//   pointer: { hit, down, move, up }       // ввод игрока
//   editor: {
//     create: { start, click, move, shapes, finish }
//     bounds(data), hit(data, pt), move(data, dx, dy)
//     handles(data), moveHandles(data, ids, dx, dy),
//     deleteHandles(data, ids) -> boolean  // false => удалить сущность целиком
//     addHandle(data, pt)
//     props(): Field[]
//   }
// }

const byType = new Map()
const order = []

export function defineEntity(def) {
  const e = {
    z: 0,
    title: def.type,
    icon: '',
    defaults: () => ({}),
    shapes: () => [],
    ...def,
    editor: def.editor || {},
  }
  if (byType.has(e.type)) throw new Error(`Сущность "${e.type}" уже зарегистрирована`)
  byType.set(e.type, e)
  order.push(e)
  return e
}

export const getEntity = (type) => byType.get(type)
export const allEntities = () => order.slice()
