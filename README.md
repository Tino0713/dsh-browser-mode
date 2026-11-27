# Browser mode

A **浏览器模式** (Browser mode) button beside **重启** (Restart) in the Windows titlebar.

Opening the DeepSeek Harness web GUI in an ordinary browser normally ends at a plain-text
`dsh web authentication required; reopen the URL printed by dsh web.` page. The one-time
`?token=` URL that would sign the browser in is handed to the Electron window over IPC and is
never written to disk, so there is no address a person can type.

This plugin closes that gap from inside the Host, where the signing secret lives:

1. It reads the `client-connection/browser-session` grant through the Host's own credential
   service — the same record the connection service signs cookies with.
2. Every press resolves the origin the GUI is currently served on from that very request, so a
   changed port is picked up on the next press. It mints a fresh cookie (7 days, `HttpOnly`,
   `SameSite=Strict`) and opens a one-time link for that origin. The link is kept in memory only,
   expires after two minutes, and works once.
3. When the browser follows the link its own cookie is checked: a valid one for that origin is
   reused and the page opens directly, anything else is replaced by the freshly minted cookie —
   a new port, an expired sign-in, and a first visit all end on the signed-in page.

Only loopback origins are signed in: a request whose Host names anything else is refused, so a
press can never mint a sign-in for an address the desktop shell would not serve itself.

If the default browser cannot be started, the dialog shows the address so it can be opened by
hand.

## Install

From a checkout:

```text
Plugins → Add plugin → pick this directory
```

Or with the plugin manager, passing the directory:

```text
plugin_manager install_bundle  target = <path to this package>
```

No build step, no dependencies, no install scripts.

## Use

1. Open the desktop app.
2. Click **浏览器模式** in the titlebar, next to **重启**.
3. The default browser opens the web GUI, already signed in.

The button only appears in the desktop shell: a browser tab has no caption row, and the sign-in
it reuses belongs to the desktop app.

## Limitations

- Windows desktop titlebar only. The caption menubar is injected by the desktop preload; no other
  host draws it.
- Only loopback HTTP origins are signed in. The cookie is signed for the authority the browser
  used (`127.0.0.1:<port>`), so a press on another host name is refused rather than trusted.
- The browser keeps the sign-in for 7 days. After that, press the button again.
- Signing in is one thing; the page is unchanged, and so are any limits on the remote connection
  the GUI itself enforces.

## Changelog

### 0.1.3

- A press now follows the GUI's current port instead of trusting the desktop shell's own cookie.
  Before, after the app restarted on a new port, the press opened the GUI without signing the
  browser in and the page ended at `dsh web authentication required`.
- The browser's cookie is checked when it follows the one-time link, where its jar is visible, so
  an expired or port-mismatched sign-in is replaced instead of being reused.
- Non-loopback origins are refused when minting a cookie.
- Route-level tests added (`npm test`).

### 0.1.2

- Initial public release.

## Security

- The secret is read with `ctx.credentials.readRecord`, used for one HMAC, and never logged,
  echoed, or returned in a response.
- `POST /dsh-browser-mode/open` refuses requests without the `x-dsh-browser-mode: 1` header, which
  a cross-site form post cannot set.
- The login link carries a random 18-byte nonce, is single use, expires in two minutes, and only
  ever installs a cookie for this origin.
- Only a one-line event log is written, to `~/.dsh/dsh-browser-mode.log`. No secret and no cookie
  value appears in it.

## Uninstall

Remove the bundle in the plugin manager. The log file can be deleted; nothing else is left behind.
