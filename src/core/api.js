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

/*
 * Кто узнаёт о 401.
 *
 * Сессия перестала спрашивать сервер «кто я» на каждом открытии меню — она
 * помнит ответ. У памяти есть цена: она может устареть, и единственный, кто об
 * этом узнаёт первым, — очередной запрос, получивший 401. Поэтому отказ
 * объявляется отсюда, а не проверяется заранее.
 *
 * Подписка, а не прямой вызов session.js: api.js лежит ниже сессии, и импорт
 * вверх завёл бы цикл ради одной строчки.
 */
const unauthorized = new Set()

export function onUnauthorized(fn) {
  unauthorized.add(fn)

  return () => unauthorized.delete(fn)
}

function announceUnauthorized() {
  for (const fn of unauthorized) fn()
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
    if (res.status === 401) announceUnauthorized()
    const err = data?.error || {}
    throw new ApiError(res.status, err.code || 'error', err.message || `HTTP ${res.status}`, data)
  }

  return data
}

// Загрузка файла. Отдельно от request(), потому что тело здесь FormData:
// Content-Type для неё выставляет сам браузер вместе с границей multipart, и
// задать его вручную значит отправить запрос, который сервер не разберёт.
async function upload(path, file) {
  await ensureCsrf()
  const token = cookie('XSRF-TOKEN')
  const form = new FormData()
  form.append('file', file)

  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(token ? { 'X-XSRF-TOKEN': decodeURIComponent(token) } : {}),
    },
    body: form,
  })

  const text = await res.text()
  const data = text ? JSON.parse(text) : null

  if (!res.ok) {
    if (res.status === 401) announceUnauthorized()
    const err = data?.error || {}
    throw new ApiError(res.status, err.code || 'error', err.message || `HTTP ${res.status}`, data)
  }

  return data
}

export const api = {
  upload,
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  put: (path, body) => request('PUT', path, body),
  del: (path, body) => request('DELETE', path, body),
}
