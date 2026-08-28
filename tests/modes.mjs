// Наследование режима: спидран идёт вниз, обычное прохождение — нет.
import { shouldAsk, inheritsSpeedrun } from '../src/core/modes.js'
import { check } from './assert.mjs'

const yes = (b) => (b ? 'да' : 'нет')
const rows = [
  // спидран не начат — спрашиваем везде
  ['story', null], ['chapter', null], ['level', null],
  // спидран истории накрывает всё внутри
  ['story', 'story'], ['chapter', 'story'], ['level', 'story'],
  // спидран главы накрывает уровни, но не саму историю
  ['chapter', 'chapter'], ['level', 'chapter'],
  // спидран одного уровня ничего ниже не накрывает
  ['level', 'level'],
]

console.log('вход куда | спидран начат на | спрашиваем? | спидранит?')
for (const [scope, sr] of rows) {
  console.log(`  ${scope.padEnd(8)} | ${String(sr).padEnd(16)} | ${yes(shouldAsk(scope, sr)).padEnd(11)} | ${yes(inheritsSpeedrun(scope, sr))}`)
}

const ok = check
console.log('')
ok('без спидрана спрашиваем на каждом уровне',
  shouldAsk('story', null) && shouldAsk('chapter', null) && shouldAsk('level', null))
ok('спидран истории: главу и уровень не спрашиваем',
  !shouldAsk('chapter', 'story') && !shouldAsk('level', 'story'))
ok('спидран истории: внутри всё спидранится',
  inheritsSpeedrun('chapter', 'story') && inheritsSpeedrun('level', 'story'))
ok('спидран главы: уровень не спрашиваем',
  !shouldAsk('level', 'chapter'))
ok('спидран главы не делает спидраном историю',
  !inheritsSpeedrun('story', 'chapter'))
ok('спидран уровня не тянется на другие уровни главы',
  !inheritsSpeedrun('chapter', 'level'))
console.log('')
console.log('главное: обычное прохождение ничего не запрещает —')
ok('внутри обычного прохождения главу можно спидранить', shouldAsk('chapter', null))
ok('и отдельный уровень тоже', shouldAsk('level', null))
