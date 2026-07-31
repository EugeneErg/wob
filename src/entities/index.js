// entities/index.js
//
// ЕДИНСТВЕННОЕ место в проекте, которое перечисляет конкретные сущности.
// Игра и редактор его не импортируют — они работают через EntityRegistry.
// Чтобы добавить сущность: создать entities/<name>/index.js по образцу
// существующих и добавить одну строку registerEntity(...) ниже.
//
// В будущем это же место можно заменить на асинхронную загрузку описаний
// сущностей с сервера (тогда registerEntity будет вызываться в цикле по
// ответу API, а не статическими импортами).

import { registerEntity } from '../core/EntityRegistry.js'

import rock from './rock/index.js'
import ball from './ball/index.js'
import pipe from './pipe/index.js'

registerEntity(rock)
registerEntity(ball)
registerEntity(pipe)
