// Signing in with Google.
//
// Google Identity Services hands the browser a signed ID token. The client
// neither parses nor trusts it — it passes it to the backend, which checks the
// signature against Google's keys and, crucially, that the token was issued to
// this application. All the client decides is which account the person picked.

import { reactive } from 'vue'
import { api, ApiError } from './api.js'
import { setSignedIn } from './sync.js'

const GSI = 'https://accounts.google.com/gsi/client'

export const session = reactive({
  user: null,
  status: 'unknown', // unknown | loading | anonymous | signed-in | unconfigured
  error: null,
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

/** Who we are right now. Called once on start. */
export async function refresh() {
  if (!clientId) {
    session.status = 'unconfigured'
    return null
  }

  session.status = 'loading'

  try {
    const { user } = await api.get('/api/auth/me')
    session.user = user
    session.status = user ? 'signed-in' : 'anonymous'
    setSignedIn(!!user)

    return user
  } catch (e) {
    // A 401 is not a failure, it is "not signed in yet".
    if (e instanceof ApiError && e.status === 401) {
      session.user = null
      session.status = 'anonymous'
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

export async function signOut() {
  try {
    await api.post('/api/auth/logout')
  } finally {
    session.user = null
    session.status = 'anonymous'
    setSignedIn(false)
    window.google?.accounts?.id?.disableAutoSelect?.()
  }
}
