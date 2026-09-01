// Talking to the backend.
//
// The session lives in an http-only cookie, so every request needs
// credentials: 'include', and there is no token in JavaScript at all — what a
// script on the page cannot read, an injected script cannot steal either.
//
// The price of a cookie is CSRF. Laravel puts a token in the XSRF-TOKEN cookie
// (readable on purpose — that is the whole mechanism) and expects it back in a
// header. The cookie is fetched once from /sanctum/csrf-cookie and lasts the
// session.

const cookie = (name) =>
  document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1)

let csrfReady = null

async function ensureCsrf() {
  if (cookie('XSRF-TOKEN')) return

  // One shared promise for every caller: otherwise the first page to fire two
  // requests at once would go and fetch the cookie twice.
  csrfReady ||= fetch('/sanctum/csrf-cookie', { credentials: 'include' }).finally(() => {
    csrfReady = null
  })

  await csrfReady
}

export class ApiError extends Error {
  constructor(status, code, message, payload) {
    super(message)
    this.status = status
    this.code = code
    this.payload = payload
  }
}

async function request(method, path, body) {
  if (method !== 'GET') await ensureCsrf()

  const token = cookie('XSRF-TOKEN')
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      // The cookie arrives url-encoded and is compared against the decoded value.
      ...(token ? { 'X-XSRF-TOKEN': decodeURIComponent(token) } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  if (res.status === 204) return null

  const text = await res.text()
  const data = text ? JSON.parse(text) : null

  if (!res.ok) {
    const err = data?.error || {}
    throw new ApiError(res.status, err.code || 'error', err.message || `HTTP ${res.status}`, data)
  }

  return data
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  put: (path, body) => request('PUT', path, body),
  del: (path, body) => request('DELETE', path, body),
}
