// Signing in with Google.
//
// Google Identity Services hands the browser a signed ID token. The client
// neither parses nor trusts it — it passes it to the backend, which checks the
// signature against Google's keys and, crucially, that the token was issued to
// this application. All the client decides is which account the person picked.

import { reactive } from 'vue'
import { api, ApiError, onUnauthorized } from './api.js'
import { setSignedIn } from './sync.js'
import { forgetQueue } from './queue.js'
import { dropRemote } from './library.js'
import { forgetCatalog } from './catalog.js'

const GSI = 'https://accounts.google.com/gsi/client'

/*
 * Кто мы — помним, а не переспрашиваем.
 *
 * Раньше каждое открытие меню начиналось с /api/auth/me, то есть с круга по
 * сети ради ответа, который не менялся неделями. Хуже того, до ответа экран не
 * знал, вошли мы или нет, и успевал нарисовать кнопку входа вошедшему человеку.
 *
 * Здесь лежит только то, что и так видно на экране: имя, почта, аватар. Это не
 * ключ и не пропуск — пропуском остаётся кука, которую JavaScript не читает.
 * Подделать эту запись значит нарисовать себе чужое имя в углу меню и получить
 * 401 на первом же запросе.
 *
 * Устаревает она ровно одним способом — этим самым 401, и тогда стирается
 * сама.
 */
const CACHE = 'goo.me.v1'

function cachedUser() {
  try {
    return JSON.parse(localStorage.getItem(CACHE)) || null
  } catch {
    return null
  }
}

function rememberUser(user) {
  try {
    if (user) localStorage.setItem(CACHE, JSON.stringify(user))
    else localStorage.removeItem(CACHE)
  } catch {
    // Переполненное хранилище — не повод падать: без записи станет на один
    // запрос больше, и только.
  }
}

const known = cachedUser()

export const session = reactive({
  user: known,
  status: known ? 'signed-in' : 'unknown', // unknown | loading | anonymous | signed-in | unconfigured
  error: null,
})

if (known) setSignedIn(true)

/*
 * Единственное, что отменяет память о входе.
 *
 * Сервер отвечает 401 не только на /api/auth/me: кука могла протухнуть между
 * двумя сохранениями уровня. Поэтому слушаем любой запрос, а не один особенный,
 * иначе редактор остался бы «вошедшим» с корзиной неотправленных правок.
 */
onUnauthorized(() => {
  if (session.status !== 'signed-in') return

  session.user = null
  session.status = 'anonymous'
  rememberUser(null)
  setSignedIn(false)
})

export const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

let gsiLoaded = null

function loadGsi() {
  if (window.google?.accounts?.id) return Promise.resolve()

  gsiLoaded ||= new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = GSI
    el.async = true
    el.onload = resolve
    el.onerror = () => {
      // The promise is cleared so a later attempt can retry rather than
      // inheriting this failure forever — a blocked script on one page load is
      // often a network hiccup, not a permanent state.
      gsiLoaded = null
      reject(new Error('Could not reach Google to sign in'))
    }
    document.head.appendChild(el)
  })

  return gsiLoaded
}

/**
 * Кто мы сейчас.
 *
 * Вызывается на каждом открытии меню и в норме не делает ничего: ответ уже
 * лежит в session, а протухнет он не по времени, а по 401 — и об этом нам
 * скажут. force нужен ровно одному месту — самой проверке после входа.
 */
export async function refresh({ force = false } = {}) {
  // Сначала «мы уже знаем, кто мы», и только потом «а есть ли чем входить».
  //
  // Порядок был обратный, и из-за этого настроенность Google отменяла
  // выполненный вход: вошедший через отладочный вход человек на втором заходе в
  // редактор видел «Sign in to create», хотя сессия жива и ни одного 401 не
  // приходило. Вход и способ войти — разные вещи, и знание о первом не должно
  // зависеть от наличия второго.
  if (!force && session.status === 'signed-in') return session.user

  if (!clientId) {
    session.status = 'unconfigured'

    return null
  }

  session.status = 'loading'

  try {
    const { user } = await api.get('/api/auth/me')
    session.user = user
    session.status = user ? 'signed-in' : 'anonymous'
    rememberUser(user)
    setSignedIn(!!user)

    return user
  } catch (e) {
    // A 401 is not a failure, it is "not signed in yet".
    if (e instanceof ApiError && e.status === 401) {
      session.user = null
      session.status = 'anonymous'
      rememberUser(null)
      setSignedIn(false)

      return null
    }

    session.error = e.message
    session.status = 'anonymous'
    return null
  }
}

async function initialise() {
  if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID is not set — see .env.example')

  await loadGsi()

  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: async ({ credential }) => {
      session.error = null

      try {
        const { user } = await api.post('/api/auth/google', { credential })
        session.user = user
        session.status = 'signed-in'
        rememberUser(user)
        setSignedIn(true)
      } catch (e) {
        session.error = e.message
      }
    },
  })
}

/*
 * One Tap отсюда убран, и это стоит объяснить.
 *
 * Он был основным входом: наша кнопка вызывала google.accounts.id.prompt(), а
 * официальная кнопка Google лежала запасным путём. Не работало ни то, ни другое.
 *
 * One Tap глохнет — Google отключает его на часы после нескольких закрытий,
 * браузеры блокируют сами, и тогда его статус-эндпоинт отвечает 403. Узнать об
 * этом надёжно нельзя: API моментов (isDisplayed, getNotDisplayedReason)
 * объявлен устаревшим по дороге к FedCM, а в худшем случае коллбэк не вызывается
 * вовсе. То есть основной путь молча ничего не делал.
 *
 * А запасной, срабатывая, подставлял вторую кнопку «Sign in with Google» внутрь
 * карточки, уже так озаглавленной.
 *
 * Официальная кнопка не нуждается ни в том, ни в другом: она сама несёт «G» и
 * надпись, работает без разрешения на One Tap и не имеет состояния отказа.
 * Единственное, чем она хуже, — её нельзя перекрасить под остальные карточки.
 * Это дешевле, чем вход, который иногда не вход.
 */

export async function renderSignInButton(el) {
  await initialise()

  // Кнопка растягивается под карточку, поверх которой лежит: её саму не видно,
  // но нажимается именно она, поэтому попасть по ней надо из любой точки.
  window.google.accounts.id.renderButton(el, {
    theme: 'filled_black',
    size: 'large',
    text: 'signin_with',
    shape: 'rectangular',
    width: Math.round(el.getBoundingClientRect().width) || 400,
  })
}

/**
 * Вход без Google — для локальной разработки.
 *
 * Включается переменной VITE_DEV_LOGIN и работает, только если согласен и
 * сервер: он отвечает на этот запрос лишь в окружении local с явно
 * поставленным флагом. Без обеих половин здесь придёт отказ, и это правильно —
 * открытый в проде такой вход означает вход в любой аккаунт по имени почты.
 *
 * Нужен потому, что иначе локально нельзя открыть редактор вовсе: настоящий
 * вход требует обращения к серверам Google.
 */
export async function signInAsDeveloper(email = 'author@wob.local') {
  session.status = 'loading'
  session.error = null

  try {
    const { user } = await api.post('/api/auth/dev', { email })
    session.user = user
    session.status = 'signed-in'
    rememberUser(user)
    setSignedIn(true)

    return user
  } catch (e) {
    session.status = 'anonymous'
    session.error = e.message

    return null
  }
}

export const devLogin = !!import.meta.env.VITE_DEV_LOGIN

/**
 * Выход.
 *
 * Забыть надо больше, чем имя. В браузере остаются очередь неотправленных
 * правок с версиями чужих теперь историй, содержимое, скачанное под этим
 * аккаунтом, и витрина, которая у следующего человека будет другой. Оставить
 * это значит показать следующему вошедшему чужие черновики и отправить его
 * правки поверх чужой работы.
 */
export async function signOut() {
  try {
    await api.post('/api/auth/logout')
  } finally {
    session.user = null
    session.status = 'anonymous'
    session.error = null
    rememberUser(null)
    setSignedIn(false)
    forgetQueue()
    dropRemote()
    forgetCatalog()
    window.google?.accounts?.id?.disableAutoSelect?.()
  }
}
