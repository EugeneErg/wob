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

/**
 * Start signing in from our own button.
 *
 * Google's rendered button is the usual way in, and it is the one control on
 * the page we cannot restyle — which makes it the odd one out in a menu where
 * everything else looks alike. One Tap is the other supported entry point: our
 * button, Google's dialog. Same flow, same token, same checks on the server.
 *
 * It can decline to appear — a browser blocking third-party frames, or someone
 * who dismissed it too often — and it says so through the notification rather
 * than by throwing. When that happens the caller is told to fall back to the
 * official button, because a sign-in that silently does nothing is worse than
 * an out-of-place button.
 *
 * @returns {Promise<boolean>} whether the dialog actually came up
 */
export async function promptSignIn() {
  await initialise()

  return new Promise((resolve) => {
    let settled = false
    const done = (ok) => {
      if (!settled) {
        settled = true
        resolve(ok)
      }
    }

    window.google.accounts.id.prompt((notification) => {
      // The API has renamed these over the years; treat anything that is not a
      // clear "it is showing" as a reason to fall back.
      const shown = typeof notification?.isDisplayed === 'function'
        ? notification.isDisplayed()
        : notification?.getMomentType?.() === 'display'

      if (!shown) done(false)
    })

    // Signing in through the dialog resolves this too — the callback above
    // flips the session, and there is nothing left to fall back to.
    const watchdog = setInterval(() => {
      if (session.status === 'signed-in') {
        clearInterval(watchdog)
        done(true)
      }
    }, 300)

    setTimeout(() => {
      clearInterval(watchdog)
      done(true)   // it came up and is waiting for the person; leave it alone
    }, 4000)
  })
}

/**
 * The official Google button, for when One Tap will not show.
 *
 * Google draws it themselves, so it does not match the rest of the menu — but
 * a button that looks slightly foreign is better than no way to sign in.
 */
export async function renderSignInButton(el) {
  await initialise()

  window.google.accounts.id.renderButton(el, {
    theme: 'filled_black',
    size: 'large',
    text: 'signin_with',
    shape: 'pill',
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
