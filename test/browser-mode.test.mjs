/**
 * Route-level tests for the Host half.
 *
 * The bug these lock down: the press used to inspect the cookie of the asking request, which is
 * the desktop shell's own jar, and skip the login link whenever that cookie was valid. After the
 * GUI moved to another port the browser still had no cookie for the new origin, so the press
 * opened the GUI at `authentication required`. The press now always issues a link, and the
 * browser's own cookie decides at the login route.
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { after, before, test } from 'node:test'

// The module resolves its log path at import time; keep that evidence out of the real ~/.dsh.
const home = mkdtempSync(join(tmpdir(), 'dsh-browser-mode-test-'))
process.env.HOME = home
process.env.USERPROFILE = home

const { apply } = await import('../index.js')

const OPEN = '/dsh-browser-mode/open'
const LOGIN = '/dsh-browser-mode/login'
const STATE = '/dsh-browser-mode/state'
const BUTTON_HEADER = 'x-dsh-browser-mode'
const SECRET = randomBytes(32)

const routes = new Map()
const effects = []
const server = {
  port: 6001,
  register({ path, handler }) {
    routes.set(path, handler)
    return () => routes.delete(path)
  },
}
const ctx = {
  get(name) {
    if (name === 'webServer') return server
    if (name === 'credentials') {
      return {
        async readRecord() {
          return { kind: 'grant', payload: { version: 1, secret: SECRET.toString('base64url') } }
        },
      }
    }
    return undefined
  },
  effect(fn) {
    const dispose = fn()
    effects.push(dispose)
    return dispose
  },
}

before(() => {
  apply(ctx)
})

after(() => {
  for (const dispose of effects.reverse()) dispose?.()
})

function request({ method = 'GET', url = '/', host = '127.0.0.1:6001', cookie, headers = {} } = {}) {
  const all = { host, ...headers }
  if (cookie !== undefined) all.cookie = cookie
  return { method, url, headers: all }
}

function response() {
  const res = { headersSent: false, writableEnded: false, destroyed: false, status: 0, headers: {}, body: '' }
  res.writeHead = (status, headers) => {
    res.status = status
    res.headers = headers
    res.headersSent = true
    return res
  }
  res.end = (body) => {
    if (typeof body === 'string') res.body += body
    res.writableEnded = true
  }
  return res
}

async function call(path, req) {
  const handler = routes.get(path)
  assert.equal(typeof handler, 'function', `route ${path} is registered`)
  const res = response()
  handler(req, res)
  const deadline = Date.now() + 1000
  while (!res.writableEnded && Date.now() < deadline) await new Promise((resolve) => setImmediate(resolve))
  return res
}

function json(res) {
  return JSON.parse(res.body)
}

/** `name=value` out of a Set-Cookie header, the part a browser would send back. */
function cookiePair(setCookie) {
  return String(setCookie).split(';')[0]
}

async function open(host) {
  const res = await call(OPEN, request({ method: 'POST', host, headers: { [BUTTON_HEADER]: '1' } }))
  assert.equal(res.status, 200)
  return json(res)
}

async function followLogin(url, { cookie, host } = {}) {
  const parsed = new URL(url)
  return call(LOGIN, request({ url: `${parsed.pathname}${parsed.search}`, host: host ?? parsed.host, cookie }))
}

async function state(host, cookie) {
  const res = await call(STATE, request({ host, cookie }))
  return json(res)
}

test('state reports the current authority', async () => {
  const body = await state('127.0.0.1:6001')
  assert.equal(body.status, 'ok')
  assert.equal(body.authority, '127.0.0.1:6001')
  assert.equal(body.credential, 'present')
})

test('a non-loopback origin is refused and mints nothing', async () => {
  const res = await call(OPEN, request({ method: 'POST', host: 'example.com', headers: { [BUTTON_HEADER]: '1' } }))
  assert.equal(res.status, 403)
  assert.equal(json(res).status, 'unsupported')
  assert.equal((await state('127.0.0.1:6001')).pendingLinks, 0)
})

test('the press issues a link even when the asking shell already has a valid cookie', async () => {
  // A first press, followed through, gives this test a cookie the shell could have held.
  const boot = await open('127.0.0.1:6001')
  const login = await followLogin(boot.url)
  const shellCookie = cookiePair(login.headers['set-cookie'])
  assert.equal((await state('127.0.0.1:6001', shellCookie)).cookie, 'valid')

  const press = await call(OPEN, request({
    method: 'POST',
    host: '127.0.0.1:6001',
    cookie: shellCookie,
    headers: { [BUTTON_HEADER]: '1' },
  }))
  assert.equal(press.status, 200)
  const body = json(press)
  assert.equal(body.status, 'minted')
  assert.match(body.url, /^http:\/\/127\.0\.0\.1:6001\/dsh-browser-mode\/login\?n=/u)
})

test('a browser without the cookie is signed in at the link', async () => {
  const body = await open('127.0.0.1:6001')
  const login = await followLogin(body.url)
  assert.equal(login.status, 303)
  assert.equal(login.headers.location, '/')
  assert.equal(login.headers['cache-control'], 'no-store')
  const cookie = cookiePair(login.headers['set-cookie'])
  assert.match(cookie, /^dsh-auth-[\w-]+=v1\./u)
  assert.match(login.headers['set-cookie'], /HttpOnly/u)
  assert.match(login.headers['set-cookie'], /SameSite=Strict/u)
  assert.equal((await state('127.0.0.1:6001', cookie)).cookie, 'valid')
})

test('a browser that already holds a valid cookie is not asked to install another', async () => {
  const first = await followLogin((await open('127.0.0.1:6001')).url)
  const cookie = cookiePair(first.headers['set-cookie'])
  const second = await followLogin((await open('127.0.0.1:6001')).url, { cookie })
  assert.equal(second.status, 303)
  assert.equal(second.headers.location, '/')
  assert.equal(second.headers['set-cookie'], undefined)
})

test('after the GUI moves to a new port the browser is signed in again', async () => {
  // What the browser keeps from the old port: a valid cookie for 127.0.0.1:6001 and nothing else.
  const oldPort = await followLogin((await open('127.0.0.1:6001')).url)
  const oldCookie = cookiePair(oldPort.headers['set-cookie'])

  const press = await open('127.0.0.1:7002')
  assert.match(press.url, /^http:\/\/127\.0\.0\.1:7002\/dsh-browser-mode\/login\?n=/u)

  const login = await followLogin(press.url, { cookie: oldCookie })
  assert.equal(login.status, 303)
  assert.ok(login.headers['set-cookie'], 'the browser gets a cookie for the new port')
  const newCookie = cookiePair(login.headers['set-cookie'])
  assert.equal((await state('127.0.0.1:7002', newCookie)).cookie, 'valid')
  assert.equal((await state('127.0.0.1:7002', oldCookie)).cookie, 'absent')
})

test('a link is single use and belongs to the origin that minted it', async () => {
  const body = await open('127.0.0.1:6001')
  const other = await followLogin(body.url, { host: '127.0.0.1:7002' })
  assert.equal(other.status, 409)
  const again = await followLogin(body.url)
  assert.equal(again.status, 410)
})

test('the press requires its method and its header', async () => {
  const get = await call(OPEN, request({ host: '127.0.0.1:6001' }))
  assert.equal(get.status, 405)
  const bare = await call(OPEN, request({ method: 'POST', host: '127.0.0.1:6001' }))
  assert.equal(bare.status, 403)
})
