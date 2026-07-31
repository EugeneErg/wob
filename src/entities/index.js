// entities/index.js
//
// ЕДИНСТВЕННОЕ место в проекте, которое перечисляет конкретные сущности.
// Игра и редактор его не импортируют — они работают через EntityRegistry.
// Чтобы добавить сущность: создать entities/<name>/index.js по образцу
// существующих и добавить одну строку registerEntity(...) ниже.

import { registerEntity } from '../core/EntityRegistry.js'

import rock from './rock/index.js'
import ball from './ball/index.js'
import pipe from './pipe/index.js'
import anchor from './anchor/index.js'

registerEntity(rock)
registerEntity(ball)
registerEntity(pipe)
registerEntity(anchor)
