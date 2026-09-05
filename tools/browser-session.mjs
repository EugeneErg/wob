// Держится ли сессия при переходах между разделами.
//
// На одном из прогонов экран редактора показал «Sign in to make stories», хотя
// вход был выполнен минутой раньше. Сессия помнится в localStorage и отменяется
// только по 401 — значит либо где-то приходит 401, либо память теряется.

import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({
  executablePath: '/tmp/chromium', headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 900 })

const unauthorized = []
page.on('response', (r) => {
  if (r.status() === 401) unauthorized.push(r.request().method() + ' ' + new URL(r.url()).pathname)
})

const wait = (ms = 1000) => new Promise((r) => setTimeout(r, ms))
const say = (s) => console.log('  ' + s)
const click = async (t) => {
  const ok = await page.evaluate((txt) => {
    const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim().includes(txt))
    if (!b) return false
    b.click(); return true
  }, t)
  await wait()
  return ok
}
const state = () => page.evaluate(() => ({
  cached: !!localStorage.getItem('goo.me.v1'),
  signInShown: /Sign in to (create|make)/.test(document.body.textContent),
}))

await page.goto('http://localhost:5173', { waitUntil: 'networkidle2' })
await click('Войти как разработчик')
say('после входа: ' + JSON.stringify(await state()))

// Ходим кругами: именно на переходах вход и терялся.
for (const round of [1, 2, 3]) {
  await click('Create')
  const inEditor = await state()
  await click('Menu')
  await click('Play')
  await click('Menu')

  say(`круг ${round}: в редакторе ${JSON.stringify(inEditor)}`)

  if (inEditor.signInShown) {
    await page.screenshot({ path: '/tmp/session-lost.png' })
    say('  ← воспроизвелось, снимок /tmp/session-lost.png')
    break
  }
}

say('ответов 401: ' + (unauthorized.length ? [...new Set(unauthorized)].join(', ') : 'ни одного'))
await browser.close()
