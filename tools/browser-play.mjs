// Что видит игрок: от меню до уровня.
import puppeteer from 'puppeteer-core'

const APP = 'http://localhost:5173'
const browser = await puppeteer.launch({
  executablePath: '/tmp/chromium', headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 900 })

const problems = []
page.on('console', (m) => { if (m.type() === 'error') problems.push('консоль: ' + m.text().slice(0, 200)) })
page.on('pageerror', (e) => problems.push('исключение: ' + String(e).slice(0, 200)))
page.on('response', (r) => { if (r.status() >= 400) problems.push(`${r.status()} ${new URL(r.url()).pathname}`) })

const wait = (ms = 900) => new Promise((r) => setTimeout(r, ms))
const say = (s) => console.log('  ' + s)
const shot = async (n) => page.screenshot({ path: `/tmp/play-${n}.png` })
const clickText = async (t) => {
  const ok = await page.evaluate((txt) => {
    const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim().includes(txt))
    if (!b) return false
    b.click(); return true
  }, t)
  if (!ok) throw new Error(`нет кнопки «${t}»`)
  await wait()
}

await page.goto(APP, { waitUntil: 'networkidle2' })
await clickText('Войти как разработчик')
await clickText('Play')
await wait(1200)
say('витрина открыта')
await shot('shelf')

// Форк канона: кнопка должна быть на карточке и работать.
const forked = await page.evaluate(async () => {
  const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('Три двери'))
  const b = [...(card?.querySelectorAll('button') || [])].find((x) => x.textContent.includes('Взять себе'))
  if (!b) return 'кнопки нет'
  b.click()
  return 'нажата'
})
await wait(1800)
say('форк канона: ' + forked + ' — ' + await page.evaluate(() =>
  document.querySelector('.state.err, .bad')?.textContent?.trim().slice(0, 80) || 'без сообщения'))
await shot('forked')

// Копия должна открываться непустой: содержимое до первой правки берётся из
// базового релиза.
await clickText('Menu').catch(() => {})
await clickText('Create').catch(() => {})
await wait(1800)
say('в редакторе: ' + await page.evaluate(() => {
  const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('fork'))
  return card ? card.querySelector('.badge')?.textContent?.trim() || 'без счётчика' : 'копии не видно'
}))
await shot('forkshelf')

await clickText('Menu').catch(() => {})
await clickText('Play').catch(() => {})
await wait(1200)

const opened = await page.evaluate(() => {
  const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('Три двери'))
  const b = card?.querySelector('button')
  if (!b) return false
  b.click(); return true
})
say('история «Три двери»: ' + (opened ? 'открыта' : 'НЕ НАЙДЕНА'))
await wait(1500)
await shot('story')

say('экран: ' + await page.evaluate(() => {
  const bits = []
  for (const s of ['.slots', '.map', '.board', '.node', '.pt', 'canvas']) {
    const n = document.querySelectorAll(s).length
    if (n) bits.push(`${s}=${n}`)
  }
  return bits.join(' ') || 'ничего знакомого'
}))

// Слот берём чистый: старое сохранение может указывать на релиз, которого уже
// нет, и тогда нажатие молча ничего не делает.
if (await page.$('.slots')) {
  await page.evaluate(() => {
    const empty = [...document.querySelectorAll('.slot')].find((s) => s.textContent.includes('Start a new run'))
    ;(empty || document.querySelector('.slot')).querySelector('.body, button')?.click()
  })
  await wait(2500)
  say('после выбора слота: ' + await page.evaluate(() => {
    const bits = []
    for (const s of ['.map', '.node', 'canvas', '.hud', '.game']) {
      const n = document.querySelectorAll(s).length
      if (n) bits.push(`${s}=${n}`)
    }
    return bits.join(' ') || 'пусто'
  }))
  await shot('afterslot')
}

// Карта главы: открываем первую точку и смотрим, что уровень действительно
// рисуется. Проверка именно по пикселям: наличие <canvas> ничего не доказывает,
// пустой экран — это тоже canvas.
if (await page.$('.node')) {
  await page.evaluate(() => {
    const n = document.querySelector('.node')
    n.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    n.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
  })
  await wait(700)
  await shot('nodepicked')

  // Именно пункт меню точки, а не одноимённая кнопка в шапке: та задаёт режим
  // для всей главы и уровень не открывает.
  const started = await page.evaluate(() => {
    const menu = document.querySelector('.menu, .nodemenu, .popover')
    const b = [...(menu?.querySelectorAll('button') || [])]
      .find((x) => /Play through/i.test(x.textContent))
    if (!b) return 'пункта «Play through» в меню точки нет'
    b.click()
    return 'нажат пункт меню'
  })
  say('после выбора точки: ' + started)
  await wait(2500)

  say('уровень: ' + await page.evaluate(() => {
    // Уровень рисуется в SVG, а не в canvas: getContext там нет, и считать
    // пиксели нечем. Меряем тем, что есть, — сколько фигур на сцене.
    const c = document.querySelector('canvas')

    if (!c) {
      const svg = document.querySelector('svg')

      return svg ? `svg, фигур: ${svg.querySelectorAll('path, circle, polygon, rect').length}` : 'холста нет'
    }

    const ctx = c.getContext('2d')
    let lit = 0
    try {
      const px = ctx.getImageData(0, 0, c.width, c.height).data
      for (let i = 0; i < px.length; i += 4000) if (px[i] + px[i + 1] + px[i + 2] > 60) lit++
    } catch (e) { return 'canvas ' + c.width + 'x' + c.height + ', пиксели не прочитать' }
    return `canvas ${c.width}x${c.height}, нарисованных проб: ${lit}`
  }))
  await shot('level')
}

console.log(problems.length ? '\n  ЗАМЕЧАНИЯ:' : '\n  замечаний нет')
for (const p of [...new Set(problems)].slice(0, 8)) console.log('   - ' + p)
await browser.close()
