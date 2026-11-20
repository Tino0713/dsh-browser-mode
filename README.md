# Browser mode

A **浏览器模式** (Browser mode) button beside **重启** (Restart) in the Windows titlebar.

Opening the DeepSeek Harness web GUI in an ordinary browser normally ends at a plain-text
`dsh web authentication required; reopen the URL printed by dsh web.` page. The one-time
`?token=` URL that would sign the browser in is handed to the Electron window over IPC and is
never written to disk, so there is no address a person can type.

This plugin closes that gap from inside the Host, where the signing secret lives:

1. It reads the `client-connection/browser-session` grant through the Host's own credential
   service — the same record the connection service signs cookies with.
2. It checks whether the asking browser already holds a valid cookie for this origin. If it does,
   the press just opens the GUI.
3. If it does not, it mints a fresh cookie (7 days, `HttpOnly`, `SameSite=Strict`) and opens a
   one-time link that installs it and redirects to `/`. The link is kept in memory only, expires
   after two minutes, and works once.

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
- The Host must be reached over loopback HTTP. The cookie is signed for the authority the browser
  used (`127.0.0.1:<port>`), so a different host name needs its own press.
- The browser keeps the sign-in for 7 days. After that, press the button again.
- Signing in is one thing; the page is unchanged, and so are any limits on the remote connection
  the GUI itself enforces.

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
