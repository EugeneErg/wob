// Путь автора настоящим браузером: нажатия, перетаскивания, экраны.
//
// До этого всё проверялось либо запросами, либо jsdom, который не раскладывает
// страницу и не реализует часть событий. Обе проверки не раз проходили на
// сломанном приложении — jsdom, например, не сказал ни слова о том, что связь
// между точками не рисуется вовсе.

import puppeteer from 'puppeteer-core'

const APP = process.env.APP_URL || 'http://localhost:5173'
const shots = []
const say = (s) => console.log('  ' + s)

const browser = await puppeteer.launch({
  executablePath: '/tmp/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
})

const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 900 })

const problems = []
page.on('console', (m) => { if (m.type() === 'error') problems.push('консоль: ' + m.text().slice(0, 160)) })
page.on('pageerror', (e) => problems.push('исключение: ' + String(e).slice(0, 160)))
page.on('response', (r) => {
  if (r.status() >= 400) problems.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`)
})

// Нажатие ищется в пределах области, а не по всей странице: первое поле ввода
// на экране принадлежит карточке истории, и «напечатать в диалог» без этого
// уточнения печатает в чужое название.
const click = async (text, scope = 'body') => {
  const node = (await page.evaluateHandle((t, sc) => {
    const root = document.querySelector(sc) || document.body
    return [...root.querySelectorAll('button')].find((e) => e.textContent.trim().includes(t)) || null
  }, text, scope)).asElement()

  if (!node) throw new Error(`нет кнопки «${text}» в ${scope}`)
  await node.click()
  await new Promise((r) => setTimeout(r, 500))
}

const typeIn = async (scope, value) => {
  const input = await page.waitForSelector(`${scope} input`, { timeout: 4000 })
  await input.click()
  await input.type(value)
}

const shot = async (name) => {
  const p = `/tmp/shot-${name}.png`
  await page.screenshot({ path: p })
  shots.push(p)
}

await page.goto(APP, { waitUntil: 'networkidle2' })
say('меню открыто')
await shot('menu')

await click('Войти как разработчик')
say('вошли как разработчик')

await click('Create')
await new Promise((r) => setTimeout(r, 900))
say('экран создания открыт')
await shot('picker')

await click('New story')
await typeIn('.sheet', 'Браузерная проверка')
await click('Create', '.sheet')
await new Promise((r) => setTimeout(r, 1200))
await new Promise((r) => setTimeout(r, 1200))
say('история создана')
await shot('created')

// Открываем её: карточка новой истории — последняя в списке.
await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.card')]
  const mine = cards.find((c) => c.querySelector('input')?.value === 'Браузерная проверка')
  mine?.querySelector('button')?.click()
})
await new Promise((r) => setTimeout(r, 1500))
say('доска открыта')
await shot('canvas')

const counts = await page.evaluate(() => ({
  areas: document.querySelectorAll('.area').length,
  tiles: document.querySelectorAll('.tiles .tile').length,
  points: document.querySelectorAll('.pt').length,
}))
say(`на доске: глав ${counts.areas}, плиток уровней ${counts.tiles}, точек ${counts.points}`)

// Уровень кнопкой «+» рядом с LEVELS.
// Кнопка «+» рядом с заголовком LEVELS. Ищем по заголовку, а не по порядку:
// таких кнопок на панели две, и вторая заводит главу.
const opened = await page.evaluate(() => {
  const head = [...document.querySelectorAll('.panel-head')]
    .find((h) => h.textContent.trim().startsWith('Levels'))
  const b = head?.querySelector('button.mini')
  if (!b) return false
  b.click()
  return true
})
if (!opened) throw new Error('не нашёл «+» у LEVELS')
await new Promise((r) => setTimeout(r, 500))
await typeIn('.sheet', 'Первый уровень')
await click('Create', '.sheet')
await new Promise((r) => setTimeout(r, 1500))
say('уровень создан — открылся редактор уровня')
await shot('editor')

await click('Levels')
await new Promise((r) => setTimeout(r, 1200))
const back = await page.evaluate(() => ({
  tiles: document.querySelectorAll('.tiles .tile').length,
  areas: document.querySelectorAll('.area').length,
}))
say(`вернулись на доску: плиток ${back.tiles}, глав ${back.areas}`)

// Перетаскиваем плитку уровня в главу — указателем, как человек.
const spots = await page.evaluate(() => {
  const t = document.querySelector('.tiles .tile')?.getBoundingClientRect()
  const a = document.querySelector('.area')?.getBoundingClientRect()
  return t && a ? { t: { x: t.x + t.width / 2, y: t.y + t.height / 2 }, a: { x: a.x + a.width / 2, y: a.y + a.height / 2 } } : null
})

if (spots) {
  await page.mouse.move(spots.t.x, spots.t.y)
  await page.mouse.down()
  await page.mouse.move(spots.a.x - 60, spots.a.y - 40, { steps: 12 })
  await page.mouse.move(spots.a.x, spots.a.y, { steps: 8 })
  await page.mouse.up()
  await new Promise((r) => setTimeout(r, 700))
  const sheetUp = await page.$('.sheet')
  say(`бросок уровня в главу: ${sheetUp ? 'форма открылась' : 'НИЧЕГО НЕ ПРОИЗОШЛО'}`)
  await shot('dropped')

  if (sheetUp) {
    await typeIn('.sheet', 'Точка входа')
    await click('Create', '.sheet')
    await new Promise((r) => setTimeout(r, 900))
    say(`точек на доске: ${await page.evaluate(() => document.querySelectorAll('.pt').length)}`)
    await shot('withpoint')
  }
}

await click('Release')
await new Promise((r) => setTimeout(r, 1200))
const released = await page.evaluate(() => document.querySelector('.good, .bad')?.textContent?.trim().slice(0, 90) || 'молчание')
say('релиз: ' + released)
await shot('released')

console.log(problems.length ? '\n  ЗАМЕЧАНИЯ:' : '\n  замечаний нет')
for (const p of [...new Set(problems)]) console.log('   - ' + p)
console.log('\n  снимки: ' + shots.join(', '))

await browser.close()

if (problems.length) process.exitCode = 1
