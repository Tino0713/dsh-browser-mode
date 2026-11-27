window.__ModuleLoader__.load({
  // The loader keys this module by the package name; keep it identical to package.json.
  id: 'dsh-browser-mode',
  factory(require) {
    /**
     * The application's own document language wins: it is what the surrounding menus speak.
     * A shell that has not synced `lang` yet is read from the browser's own order instead.
     */
    const detectZh = (documentLanguage, browserLanguage) => {
      const tag = typeof documentLanguage === 'string' ? documentLanguage : '';
      if (/^zh(-|$)/i.test(tag)) return true;
      if (tag !== '' && !/^en(-|$)/i.test(tag)) return false;
      const first = Array.isArray(browserLanguage) ? browserLanguage[0] : browserLanguage;
      return typeof first === 'string' && /^zh(-|$)/i.test(first);
    };

    const COPY = (zh) => zh
      ? {
          label: '浏览器模式',
          hint: '用默认浏览器打开网页版（登录失效时会自动重新签入）',
          title: '浏览器模式',
          ready: '正在准备浏览器模式…',
          opened: '已在默认浏览器中打开网页版。',
          notOpened: '没能自动启动浏览器，可以用下面的地址手动打开：',
          copy: '复制地址',
          copied: '已复制',
          failed: (detail) => `打开失败：${detail}`,
          note: (days) => `这个登录状态会在浏览器里保留 ${days} 天。`,
          close: '关闭',
        }
      : {
          label: 'Browser mode',
          hint: 'Open the web GUI in your default browser; it re-signs in when the sign-in expired',
          title: 'Browser mode',
          ready: 'Preparing browser mode…',
          opened: 'Opened the web GUI in your default browser.',
          notOpened: 'The browser could not be started automatically. Open this address yourself:',
          copy: 'Copy address',
          copied: 'Copied',
          failed: (detail) => `Could not open: ${detail}`,
          note: (days) => `The browser keeps this sign-in for ${days} days.`,
          close: 'Close',
        };

    // The caption menubar only exists in the Windows desktop shell; a browser tab has no
    // titlebar row to extend, and the sign-in it would reuse is that same shell's.
    const desktop = /Electron\//.test(navigator.userAgent || '');
    const HOST_BASE = '/dsh-browser-mode'; // ui-copy-ignore
    const BUTTON_ATTR = 'data-dsh-browser-mode'; // ui-copy-ignore
    const DIALOG_ATTR = 'data-dsh-browser-mode-dialog'; // ui-copy-ignore
    const MENUBAR_HOST = '[data-windows-menu]'; // ui-copy-ignore
    const RESTART_BUTTON = '[data-dsh-restart]'; // ui-copy-ignore
    const ATTACH_TIMEOUT_MS = 20000; // ui-copy-ignore
    const AUTO_CLOSE_MS = 2600; // ui-copy-ignore
    const DEFAULT_DAYS = 7; // ui-copy-ignore

    const language = () => (detectZh(document.documentElement?.lang, navigator.languages || navigator.language) ? 'zh' : 'en');

    /** The caption menubar the desktop preload installs in this document, when it is there yet. */
    function captionBar() {
      const host = document.querySelector(MENUBAR_HOST);
      if (host === null || host.shadowRoot === null) return null;
      const bar = host.shadowRoot.querySelector('[role="menubar"]');
      return bar !== null && bar.isConnected ? bar : null;
    }

    /**
     * One control in the shell's own menubar row, placing itself right after the restart button
     * when that plugin is present, and last otherwise.
     */
    function mount() {
      let button = null;
      let attachTimer = 0;
      let languageObserver = null;
      const startedAt = Date.now();
      let copy = COPY(language() === 'zh');
      let dialog = null;

      /** A quiet one-line status card, so a press never becomes a silent no-op. */
      function createDialog() {
        const host = document.createElement('div');
        host.setAttribute(DIALOG_ATTR, '');
        host.style.cssText = [
          'position:fixed',
          'inset:0',
          'z-index:1200',
          'display:none',
          'font-family:var(--dsw-font-family, system-ui, -apple-system, "Segoe UI", sans-serif)',
        ].join(';');
        const shadow = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = `
          .overlay { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
            background: rgba(0, 0, 0, 0.34); }
          .card { box-sizing: border-box; width: min(440px, calc(100vw - 48px)); padding: 20px 20px 16px;
            border-radius: 12px; background: var(--dsw-alias-bg-overlay, #ffffff);
            border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.10));
            box-shadow: 0 18px 48px rgba(0, 0, 0, 0.24); color: var(--dsw-alias-label-primary, #111111);
            font-size: 13px; line-height: 1.6; }
          h2 { margin: 0 0 8px; font-size: 15px; font-weight: 600; }
          p { margin: 0; color: var(--dsw-alias-label-secondary, #666666); }
          .status[data-tone='error'] { color: var(--dsw-alias-state-error-primary, #c0392b); }
          .note { margin-top: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary, #666666); }
          code { display: block; margin-top: 8px; padding: 8px 10px; border-radius: 8px; font-size: 12px;
            word-break: break-all; user-select: all; background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.05));
            border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.10)); color: var(--dsw-alias-label-primary, #111111); }
          .row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
          button { height: 32px; padding: 0 14px; border-radius: 8px; font: inherit; font-size: 13px;
            cursor: pointer; border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.16));
            background: transparent; color: var(--dsw-alias-label-primary, #111111); }
          button:hover { background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.05)); }
          button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #1d6fd8); outline-offset: 1px; }
          [hidden] { display: none !important; }
        `;
        const overlay = document.createElement('div');
        overlay.className = 'overlay';
        const card = document.createElement('div');
        card.className = 'card';
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', 'true');
        card.setAttribute('aria-labelledby', 'dsh-browser-mode-title');
        const title = document.createElement('h2');
        title.id = 'dsh-browser-mode-title';
        const status = document.createElement('p');
        status.className = 'status';
        status.setAttribute('aria-live', 'polite');
        const note = document.createElement('p');
        note.className = 'note';
        note.hidden = true;
        const address = document.createElement('code');
        address.hidden = true;
        const row = document.createElement('div');
        row.className = 'row';
        const copyButton = document.createElement('button');
        copyButton.type = 'button';
        copyButton.hidden = true;
        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        row.append(copyButton, closeButton);
        card.append(title, status, note, address, row);
        overlay.append(card);
        shadow.append(style, overlay);
        document.body.append(host);

        let visible = false;
        let autoTimer = 0;

        const setStatus = (text, tone) => {
          status.textContent = text;
          if (tone === undefined) status.removeAttribute('data-tone');
          else status.setAttribute('data-tone', tone);
        };

        function close() {
          clearTimeout(autoTimer);
          if (!visible) return;
          visible = false;
          host.style.display = 'none';
          overlay.removeEventListener('click', onBackdrop);
          document.removeEventListener('keydown', onKey, true);
          try {
            button?.focus({ preventScroll: true });
          } catch {
            /* a shell that refuses focus costs nothing */
          }
        }

        function onBackdrop(event) {
          if (event.target === overlay) close();
        }

        function onKey(event) {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
          }
          if (event.key !== 'Tab') return;
          const stops = [copyButton, closeButton].filter((node) => !node.hidden);
          if (stops.length === 0) return;
          const active = shadow.activeElement;
          const index = stops.indexOf(active);
          const next = event.shiftKey ? stops[(index <= 0 ? stops.length : index) - 1] : stops[(index + 1) % stops.length];
          event.preventDefault();
          next.focus();
        }

        function show() {
          clearTimeout(autoTimer);
          copy = COPY(language() === 'zh');
          title.textContent = copy.title;
          closeButton.textContent = copy.close;
          copyButton.textContent = copy.copy;
          copyButton.hidden = true;
          address.hidden = true;
          address.textContent = '';
          note.hidden = true;
          note.textContent = '';
          setStatus(copy.ready, undefined);
          overlay.addEventListener('click', onBackdrop);
          document.addEventListener('keydown', onKey, true);
          visible = true;
          host.style.display = 'block';
          try {
            closeButton.focus({ preventScroll: true });
          } catch {
            /* focus is a courtesy here */
          }
        }

        /** The browser did not start on its own: hand the address over instead of failing. */
        function offerAddress(url) {
          copyButton.hidden = false;
          address.hidden = false;
          address.textContent = url;
          setStatus(copy.notOpened, 'error');
          copyButton.onclick = () => {
            try {
              void navigator.clipboard?.writeText(url).then(
                () => {
                  copyButton.textContent = copy.copied;
                },
                () => {
                  /* a browser that refuses the clipboard has left the address selectable */
                },
              );
            } catch {
              /* the address stays on screen either way */
            }
          };
        }

        async function run() {
          try {
            const response = await fetch(`${HOST_BASE}/open`, {
              method: 'POST', // ui-copy-ignore
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json', 'x-dsh-browser-mode': '1' }, // ui-copy-ignore
              body: '{}', // ui-copy-ignore
              cache: 'no-store', // ui-copy-ignore
            });
            const data = await response.json().catch(() => null);
            const detail = typeof data?.detail === 'string' && data.detail !== '' ? data.detail : `HTTP ${String(response.status)}`;
            if (!response.ok) {
              setStatus(copy.failed(detail), 'error');
              return;
            }
            const days = typeof data?.expiresAt === 'number'
              ? Math.max(1, Math.round((data.expiresAt - Date.now()) / 86400000))
              : DEFAULT_DAYS;
            setStatus(copy.opened, undefined);
            note.hidden = false;
            note.textContent = copy.note(days);
            if (data?.opened !== true && typeof data?.url === 'string') offerAddress(data.url);
            else autoTimer = setTimeout(close, AUTO_CLOSE_MS);
          } catch (error) {
            setStatus(copy.failed(String(error?.message ?? error)), 'error');
          }
        }

        closeButton.addEventListener('click', close);

        return {
          open() {
            show();
            void run();
          },
          destroy() {
            clearTimeout(autoTimer);
            overlay.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onKey, true);
            host.remove();
          },
        };
      }

      const attach = () => {
        const bar = captionBar();
        if (bar === null) return false;
        if (button !== null && button.isConnected && button.parentElement === bar) return true;
        button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('role', 'menuitem');
        button.setAttribute(BUTTON_ATTR, '');
        button.textContent = copy.label;
        button.title = copy.hint;
        button.addEventListener('click', () => {
          if (dialog === null) dialog = createDialog();
          dialog.open();
        });
        const restart = bar.querySelector(RESTART_BUTTON);
        if (restart !== null) restart.after(button);
        else bar.append(button);
        return true;
      };

      const waitForBar = () => {
        if (attach()) {
          // The shell rewrites this menubar row on a locale change; the row survives, so only the
          // words need to follow the document language.
          languageObserver = new MutationObserver(() => {
            copy = COPY(language() === 'zh');
            if (button === null) return;
            button.title = copy.hint;
            button.textContent = copy.label;
          });
          languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
          return;
        }
        if (Date.now() - startedAt > ATTACH_TIMEOUT_MS) return; // ui-copy-ignore
        attachTimer = setTimeout(waitForBar, 250); // ui-copy-ignore
      };

      if (desktop) waitForBar();

      return () => {
        clearTimeout(attachTimer);
        languageObserver?.disconnect();
        dialog?.destroy();
        dialog = null;
        if (button !== null) {
          button.remove();
          button = null;
        }
      };
    }

    return {
      apply(ctx) {
        if (typeof ctx?.effect === 'function') ctx.effect(() => mount());
        else mount();
      },
    };
  },
});
