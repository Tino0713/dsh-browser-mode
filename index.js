/**
 * Browser mode for DeepSeek Harness Desktop — Host half.
 *
 * Opening the Web GUI in an ordinary browser normally fails with
 * `dsh web authentication required`, because the one-time `?token=` URL is handed to the
 * Electron window over IPC and never written to disk. The browser session cookie that would
 * stand in for it is signed with a secret the Host keeps in its credential store, so a plugin
 * that runs inside the Host can mint an equivalent cookie itself.
 *
 * This half does exactly that: every press mints a fresh one-time link for the origin the GUI is
 * currently served on. When the browser follows the link, its own cookie decides whether the
 * sign-in can be reused or a new one has to be installed — so a new port, an expired cookie, or a
 * first visit all end the same way, signed in. Nothing is written to disk; the link lives in memory
 * for two minutes and is usable once.
 *
 * The secret never leaves this process: it is read through `ctx.credentials`, used for one
 * HMAC, and not logged, echoed, or returned in any response.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'dsh-browser-mode'
/** The GUI is served by the web server, and the cookie is only useful on that origin. */
export const inject = ['webServer']

/** The one route the button calls. */
const OPEN_PATH = '/dsh-browser-mode/open'
/** The one-time link the browser is sent to; it installs the cookie and redirects to the GUI. */
const LOGIN_PATH = '/dsh-browser-mode/login'
/** Diagnostics for the button and for anyone reading the log afterwards. */
const STATE_PATH = '/dsh-browser-mode/state'
/** A same-origin page sets this itself; a cross-site form post cannot, and fails the preflight. */
const BUTTON_HEADER = 'x-dsh-browser-mode'
/** Where the Host keeps the signing secret; the same record the connection service uses. */
const CREDENTIAL_KEY = 'client-connection/browser-session'
/** The connection service's own cookie grammar. */
const COOKIE_PREFIX = 'dsh-auth-'
const COOKIE_VERSION = 1
const SECRET_BYTES = 32
/** A one-time link is a gesture, not a bookmark: two minutes is generous for a browser start. */
const NONCE_TTL_MS = 2 * 60 * 1000
/** Shorter than the shell's 30-day maximum on purpose: a hand-opened browser can be re-minted. */
const DEFAULT_MAX_AGE_DAYS = 7
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000

function stateHome() {
  const fromEnv = process.env.HOME || process.env.USERPROFILE
  return typeof fromEnv === 'string' && fromEnv !== '' ? fromEnv : homedir()
}
const LOG_PATH = join(stateHome(), '.dsh', 'dsh-browser-mode.log')

/** One line per event, with control bytes folded so a value cannot forge or repaint a line. */
function log(value) {
  try {
    mkdirSync(join(stateHome(), '.dsh'), { recursive: true })
    const text = String(value ?? '')
      .replace(/[\r\n\u2028\u2029]+/gu, ' ')
      .replace(/[\u0000-\u001f\u007f-\u009f]+/gu, ' ')
      .slice(0, 2000)
    appendFileSync(LOG_PATH, `${new Date().toISOString()} ${text}\n`)
  } catch {
    /* evidence is worth less than the answer this file is part of */
  }
}

/** Answer with JSON, once, whatever state the response is already in. */
function sendJson(res, status, body) {
  try {
    if (res?.headersSent === true) {
      if (res?.writableEnded !== true && res?.destroyed !== true) res.end()
      return
    }
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  } catch {
    /* the socket is gone; there is nobody left to answer */
  }
}

/** Answer with plain text, once. */
function sendText(res, status, text) {
  try {
    if (res?.headersSent === true) {
      if (res?.writableEnded !== true && res?.destroyed !== true) res.end()
      return
    }
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    res.end(text)
  } catch {
    /* the socket is gone */
  }
}

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url')
}

/** The cookie name is a hash of the authority, so one browser can hold several Hosts apart. */
function cookieNameFor(authority) {
  return COOKIE_PREFIX + base64url(createHash('sha256').update(authority).digest())
}

/**
 * The authority the browser is talking to, exactly as the connection service computes it:
 * `new URL('http://' + host).host`. Falls back to the server's own loopback address.
 */
function authorityOf(req, server) {
  const host = req?.headers?.host
  if (typeof host === 'string' && host !== '') {
    try {
      const parsed = new URL(`http://${host}`)
      if (parsed.host !== '') return parsed.host
    } catch {
      /* a malformed host header is not a reason to fail the press */
    }
  }
  const port = server?.port
  return typeof port === 'number' && Number.isSafeInteger(port) ? `127.0.0.1:${String(port)}` : '127.0.0.1'
}

/**
 * The GUI is served by the desktop shell on loopback only. Anything else in the Host header is
 * refused rather than trusted, so a press can never mint a sign-in for an origin the shell would
 * not serve itself.
 */
function isLoopbackAuthority(authority) {
  try {
    const hostname = new URL(`http://${authority}`).hostname.toLowerCase()
    return hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/u.test(hostname)
  } catch {
    return false
  }
}

/** One cookie's value out of a Cookie header, or undefined. */
function readCookieValue(header, name) {
  if (typeof header !== 'string' || header === '') return undefined
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    if (part.slice(0, index).trim() !== name) continue
    return part.slice(index + 1).trim()
  }
  return undefined
}

/**
 * The payload of a cookie this Host signed, or null when it is absent, malformed, signed with
 * another secret, for another authority, or outside its own lifetime.
 */
function verifyCookie(value, secret, authority, now) {
  if (typeof value !== 'string' || value === '') return null
  const parts = value.split('.')
  if (parts.length !== 3) return null
  const [version, body, signature] = parts
  if (version !== `v${String(COOKIE_VERSION)}`) return null
  const expected = base64url(createHmac('sha256', secret).update(body).digest())
  const left = Buffer.from(signature, 'utf8')
  const right = Buffer.from(expected, 'utf8')
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null
  let payload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (payload === null || typeof payload !== 'object') return null
  if (payload.version !== COOKIE_VERSION) return null
  if (payload.authority !== authority) return null
  if (!Number.isFinite(payload.issuedAt) || !Number.isFinite(payload.expiresAt)) return null
  if (payload.issuedAt > now || payload.expiresAt <= now) return null
  return payload
}

/** Sign one cookie value in the connection service's format. */
function encodeCookie(payload, secret) {
  const body = base64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  const signature = base64url(createHmac('sha256', secret).update(body).digest())
  return `v${String(payload.version)}.${body}.${signature}`
}

/** The `Set-Cookie` a browser needs to be signed in; `HttpOnly` keeps it away from page scripts. */
function sessionCookie(name, value, maxAgeSeconds) {
  return [
    `${name}=${value}`,
    `Max-Age=${String(maxAgeSeconds)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
  ].join('; ')
}

/**
 * The signing secret, out of the Host's credential store — the only copy that matters.
 *
 * Reading it through `ctx.credentials` means this plugin never parses the store's file format,
 * works wherever that file lives, and sees the same secret the connection service signs with.
 */
async function readSecret(ctx) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined || credentials === null || typeof credentials.readRecord !== 'function') {
    throw new Error('the credentials service is not mounted, so the browser session cookie cannot be minted')
  }
  const record = await credentials.readRecord(CREDENTIAL_KEY)
  if (record === undefined || record === null) {
    throw new Error('this installation has no browser-session credential yet; open the desktop window once')
  }
  if (record.kind !== 'grant') throw new Error(`the stored ${CREDENTIAL_KEY} record is a ${String(record.kind)}, not a grant`)
  const secret = record.payload?.secret
  if (typeof secret !== 'string' || secret === '') throw new Error(`the stored ${CREDENTIAL_KEY} record has no secret`)
  const bytes = Buffer.from(secret, 'base64url')
  if (bytes.length !== SECRET_BYTES) throw new Error(`the stored ${CREDENTIAL_KEY} secret is ${String(bytes.length)} bytes, not ${String(SECRET_BYTES)}`)
  return bytes
}

/** Hand the URL to whatever this desktop's default browser is. */
function openBrowser(url) {
  try {
    const options = { detached: true, stdio: 'ignore', windowsHide: true }
    const child = process.platform === 'win32'
      // `start` is a shell builtin; its first quoted argument is the window title, not a URL.
      ? spawn('cmd.exe', ['/c', 'start', '""', url], options)
      : process.platform === 'darwin'
        ? spawn('open', [url], options)
        : spawn('xdg-open', [url], options)
    child.once('error', (error) => log(`cannot open a browser: ${error?.message ?? error}`))
    child.unref()
    log(`opened a browser at the browser-mode link (pid ${String(child.pid ?? 'unknown')})`)
    return true
  } catch (error) {
    log(`cannot open a browser: ${error?.message ?? error}`)
    return false
  }
}

/** Register one route, guarded so a refusal costs a status instead of the connection. */
function guarded(handler) {
  return (req, res) => {
    try {
      const answered = handler(req, res)
      if (answered !== null && typeof answered === 'object' && typeof answered.then === 'function') {
        answered.catch((error) => {
          log(`a route body failed: ${error?.message ?? error}`)
          sendJson(res, 503, { status: 'failed' })
        })
      }
      return undefined
    } catch (error) {
      log(`a route body threw: ${error?.message ?? error}`)
      sendJson(res, 503, { status: 'failed' })
      return undefined
    }
  }
}

/** One-time links, keyed by their nonce; gone after use, after two minutes, or on restart. */
const nonces = new Map()

function query(req) {
  try {
    return new URL(String(req?.url ?? '/'), 'http://127.0.0.1').searchParams
  } catch {
    return new URLSearchParams()
  }
}

function createHandlers(ctx, server) {
  const maxAgeDays = DEFAULT_MAX_AGE_DAYS

  const openHandler = async (req, res) => {
    if (req?.method !== 'POST') return sendJson(res, 405, { status: 'failed', detail: 'POST required' })
    if (req?.headers?.[BUTTON_HEADER] !== '1') return sendJson(res, 403, { status: 'failed', detail: 'missing client header' })
    const authority = authorityOf(req, server)
    // The GUI is a loopback desktop window, so that is the only origin this route signs in.
    if (!isLoopbackAuthority(authority)) {
      log(`refused browser mode for non-loopback authority ${authority}`)
      return sendJson(res, 403, { status: 'unsupported', detail: 'browser mode only signs in a loopback origin' })
    }
    const now = Date.now()
    let secret
    try {
      secret = await readSecret(ctx)
    } catch (error) {
      const detail = String(error?.message ?? error)
      log(`cannot mint a browser cookie: ${detail}`)
      return sendJson(res, 409, { status: 'unsupported', detail })
    }
    // The cookie on the asking request belongs to the desktop shell's own jar, not to the browser
    // that is about to be opened: the Host cannot see that browser's jar. So every press issues a
    // fresh one-time link and lets the browser's own cookie decide at the login route whether the
    // sign-in can be skipped. Deciding it here is what silently skipped the link after the GUI
    // moved to a new port, leaving the browser at `authentication required`.
    const name = cookieNameFor(authority)
    const shellSignedIn = verifyCookie(readCookieValue(req?.headers?.cookie, name), secret, authority, now) !== null
    if (shellSignedIn) log(`browser mode: the desktop shell holds a valid cookie for ${authority}; issuing a link for the browser anyway`)
    const payload = {
      version: COOKIE_VERSION,
      authority,
      issuedAt: now,
      expiresAt: now + maxAgeDays * DAY_MILLISECONDS,
    }
    const value = encodeCookie(payload, secret)
    // Drop the oldest links first so a page that is left open cannot grow this map.
    for (const [key, entry] of nonces) if (entry.expiresAt <= now) nonces.delete(key)
    while (nonces.size >= 32) {
      const oldest = nonces.keys().next()
      if (oldest.done === true) break
      nonces.delete(oldest.value)
    }
    const nonce = base64url(randomBytes(18))
    nonces.set(nonce, { cookie: sessionCookie(name, value, maxAgeDays * 86400), authority, expiresAt: now + NONCE_TTL_MS })
    const url = `http://${authority}${LOGIN_PATH}?n=${nonce}`
    const opened = openBrowser(url)
    log(`browser mode: minted a ${String(maxAgeDays)}-day cookie for ${authority} (browser ${opened ? 'opened' : 'not opened'})`)
    return sendJson(res, 200, { status: 'minted', opened, url, expiresAt: payload.expiresAt })
  }

  const loginHandler = async (req, res) => {
    if (req?.method !== 'GET' && req?.method !== 'HEAD') return sendText(res, 405, 'GET required')
    const nonce = query(req).get('n') ?? ''
    const entry = nonces.get(nonce)
    if (entry === undefined) return sendText(res, 410, 'This browser-mode link is no longer valid. Press 浏览器模式 / Browser mode again.')
    nonces.delete(nonce)
    const now = Date.now()
    if (entry.expiresAt <= now) return sendText(res, 410, 'This browser-mode link expired. Press 浏览器模式 / Browser mode again.')
    // The link was minted for the origin the press ran on; a browser arriving at another origin
    // must not be handed a cookie signed for the first one.
    if (authorityOf(req, server) !== entry.authority) {
      return sendText(res, 409, 'This browser-mode link belongs to another address. Press 浏览器模式 / Browser mode again.')
    }
    let alreadySignedIn = false
    try {
      const secret = await readSecret(ctx)
      const name = cookieNameFor(entry.authority)
      alreadySignedIn = verifyCookie(readCookieValue(req?.headers?.cookie, name), secret, entry.authority, now) !== null
    } catch (error) {
      // The link's own cookie is already signed, so it can still sign the browser in.
      log(`browser mode: could not re-read the secret to check the browser cookie: ${error?.message ?? error}`)
    }
    try {
      if (alreadySignedIn) {
        // This browser already holds a valid cookie for the origin it used to get here: skip the
        // Set-Cookie and land on the GUI as is.
        res.writeHead(303, { location: '/', 'cache-control': 'no-store' })
        res.end()
        log(`browser mode: the browser already holds a valid cookie for ${entry.authority}`)
      } else {
        res.writeHead(303, { location: '/', 'set-cookie': entry.cookie, 'cache-control': 'no-store' })
        res.end()
        log(`browser mode: handed a session cookie to the browser for ${entry.authority}`)
      }
    } catch (error) {
      log(`cannot answer the browser-mode link: ${error?.message ?? error}`)
      sendText(res, 503, 'The browser-mode link could not be answered.')
    }
    return undefined
  }

  const stateHandler = async (req, res) => {
    const authority = authorityOf(req, server)
    const now = Date.now()
    let credential = 'unknown'
    let cookie = 'unknown'
    let secret
    try {
      secret = await readSecret(ctx)
      credential = 'present'
    } catch (error) {
      credential = String(error?.message ?? error)
    }
    if (secret !== undefined) {
      const payload = verifyCookie(readCookieValue(req?.headers?.cookie, cookieNameFor(authority)), secret, authority, now)
      cookie = payload === null ? 'absent' : 'valid'
    }
    return sendJson(res, 200, {
      status: 'ok',
      desktop: process.env.ELECTRON_RUN_AS_NODE === '1',
      authority,
      credential,
      cookie,
      pendingLinks: nonces.size,
      log: LOG_PATH,
    })
  }

  return { openHandler, loginHandler, stateHandler }
}

export function apply(ctx) {
  const server = ctx.get('webServer')
  if (server === undefined || server === null || typeof server.register !== 'function') {
    log('no web server in this composition, so browser mode has nothing to answer it')
    return
  }
  const { openHandler, loginHandler, stateHandler } = createHandlers(ctx, server)
  ctx.effect(() => {
    const disposers = []
    for (const [path, handler] of [
      [OPEN_PATH, openHandler],
      [LOGIN_PATH, loginHandler],
      [STATE_PATH, stateHandler],
    ]) {
      try {
        const dispose = server.register({ kind: 'exact', path, handler: guarded(handler) })
        if (typeof dispose === 'function') disposers.push(dispose)
      } catch (error) {
        log(`cannot answer ${path}: ${error?.message ?? error}`)
      }
    }
    return () => {
      nonces.clear()
      for (const dispose of disposers.reverse()) {
        try {
          dispose()
        } catch {
          /* the route is already gone */
        }
      }
    }
  })
}
