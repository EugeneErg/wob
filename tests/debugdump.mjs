// Выгрузка состояния: сохранил у себя — загрузил у другого, случай тот же.
const store = new Map()
globalThis.localStorage = {
  get length() { return store.size },
  key: (i) => [...store.keys()][i],
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}
// Object.keys(localStorage) в loadState обходит собственные ключи объекта,
// поэтому для проверки подменяем его настоящим перечислением
Object.defineProperty(globalThis.localStorage, Symbol.iterator, { value: () => store.keys() })

const { check } = await import('./assert.mjs')
const { dumpState, loadState } = await import('../src/core/debug.js')
const lib = await import('../src/core/library.js')
const { saveRun, runsFor, KIND } = await import('../src/core/replays.js')

lib.resetLibrary()
const st = lib.stories()[0]
const ch = lib.chaptersOf(st.id)[0]
const lvl = ch.nodes[0].levelId
lib.markDone(lvl)
await saveRun(
  { levelId: lvl, seed: 7, rate: 60, ticks: 300, finished: true, input: [0, 0, 1, 2], camera: [], checks: [] },
  { kind: KIND.LEVEL, targetId: lvl },
)

const dump = dumpState({ tick: 123, seed: 7 })
console.log('в выгрузке ключей:', Object.keys(dump.storage).length, '—', Object.keys(dump.storage).join(', '))
check('выгрузка несёт библиотеку', !!dump.storage['goo.library.v1'] || Object.keys(dump.storage).some((k) => k.includes('lib')))
check('выгрузка несёт записи попыток', Object.keys(dump.storage).some((k) => k.includes('runs')))
check('выгрузка несёт момент (тик и сид)', dump.now.tick === 123 && dump.now.seed === 7)

// Стираем всё и восстанавливаем из выгрузки
store.clear()
loadState(dump)

const back = await runsFor(lvl, { kind: KIND.LEVEL })
check('записи попыток восстановились', back.length === 1 && back[0].ticks === 300)
check('прогресс восстановился', lib.isDone(lvl))
const st2 = lib.stories()[0]
check('библиотека восстановилась', !!st2 && st2.title === st.title, st2?.title)

const twice = dumpState({ tick: 123, seed: 7 })
check('выгрузка после загрузки совпадает с исходной',
  JSON.stringify(twice.storage) === JSON.stringify(dump.storage))


// --- главное: из выгрузки восстанавливается момент, а не картинка -----------
// Выгрузка несёт сид и ввод, а не частицы. Проверяем, что этого достаточно:
// проигрываем записанное и сверяем мир с тем, что был в момент выгрузки.
await import('../src/entities/index.js')
const { Run, replayOf, PLAY } = await import('../src/core/run.js')
const { level: getLevel } = lib

const hash = (r) => {
  let h = 2166136261
  for (const p of r.world.physics.points) {
    const s = `${Math.round(p.x * 100)},${Math.round(p.y * 100)},${Math.round(p.vx)},${Math.round(p.vy)}`
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  }
  return (h >>> 0).toString(16)
}

// играем по-настоящему и «жмём F10» посреди попытки
const lvlObj = getLevel(lvl)
const live = new Run(lvlObj, { mode: PLAY, seed: 4242 })
const f = (n) => { for (let i = 0; i < n; i++) live.frame(1 / 60) }
f(60)
const ball = live.world.instances.filter((x) => x.type === 'game-ball' && x.rt.state === 'free')[0]
if (ball) {
  live.down({ x: ball.rt.p.x, y: ball.rt.p.y })
  for (let k = 0; k < 20; k++) { live.move({ x: 745, y: 700 }); f(1) }
  live.up({ x: 745, y: 700 })
}
f(40)

const moment = dumpState({ levelId: lvl, tick: live.tick, run: live.snapshot() })
const size = JSON.stringify(moment.now).length
console.log(`\nвыгрузка момента: ${size} байт на попытку в ${live.tick} тиков`)
check('в выгрузке есть сид и ввод', !!moment.now.run?.seed && moment.now.run.input.length > 0)
check('в выгрузке НЕТ частиц и физики',
  !JSON.stringify(moment.now).includes('"points"') && !JSON.stringify(moment.now).includes('"vx"'))

const restored = replayOf(lvlObj, moment.now.run)
while (restored.tick < moment.now.tick) restored.frame(1 / 60)
check('момент восстановлен из выгрузки точно', hash(restored) === hash(live),
  `тик ${restored.tick}, отпечаток ${hash(restored)}`)
check('встали ровно на тот же тик', restored.tick === live.tick)
