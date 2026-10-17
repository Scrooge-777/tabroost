/**
 * Page indicator — optional, opt-in features injected into web pages:
 *  - a small workspace pill (top-left) that opens the switcher as a flyout
 *  - a thin accent border in the workspace color at the top of the page
 *
 * Registered dynamically by the service worker only when enabled in Settings.
 * Everything renders inside a closed shadow root so page CSS cannot interfere.
 */

(() => {
  if (window.top !== window.self) return;
  if (window.__workspacesIndicator) {
    window.__workspacesIndicator.refresh();
    return;
  }

  const HOST_ID = 'workspaces-ext-indicator';
  const COLORS = {
    blue: '#1a73e8', cyan: '#007b83', green: '#188038', yellow: '#e8a200', orange: '#e8710a',
    red: '#d93025', pink: '#d01884', purple: '#a142f4', grey: '#5f6368'
  };

  let host = null;
  let shadow = null;
  let flyout = null;
  let lastKey = '';

  const alive = () => {
    try {
      return Boolean(chrome?.runtime?.id);
    } catch {
      return false;
    }
  };

  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all: initial; position: fixed; inset: 0 auto auto 0; width: 0; height: 0; z-index: 2147483647;';
    shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .border { position: fixed; top: 0; left: 0; right: 0; height: 3px; pointer-events: none; display: none; }
        .pill {
          position: fixed; top: 8px; left: 8px; display: none; align-items: center; gap: 6px;
          height: 26px; max-width: 200px; padding: 0 10px 0 8px; box-sizing: border-box;
          border: 1px solid rgba(255,255,255,.14); border-radius: 13px;
          background: rgba(32,33,36,.92); color: #fff; cursor: pointer;
          font: 600 12px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
          box-shadow: 0 2px 10px rgba(0,0,0,.25); opacity: .55;
          transition: opacity .15s ease, transform .15s ease;
          backdrop-filter: blur(8px);
        }
        .pill:hover, .pill.open, .pill:focus-visible { opacity: 1; transform: translateY(-1px); outline: none; }
        .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
        .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .chev { flex: none; opacity: .7; transition: transform .15s ease; }
        .pill.open .chev { transform: rotate(180deg); }
        iframe {
          position: fixed; top: 40px; left: 8px; width: 360px; max-width: calc(100vw - 16px);
          height: min(560px, calc(100vh - 56px)); border: 0; border-radius: 12px;
          box-shadow: 0 12px 40px rgba(0,0,0,.35); background: transparent; color-scheme: normal;
          animation: pop .16s cubic-bezier(.2,.9,.3,1);
        }
        @keyframes pop { from { opacity: 0; transform: translateY(-6px) scale(.98); } }
        @media (prefers-reduced-motion: reduce) { .pill, .chev, iframe { transition: none; animation: none; } }
      </style>
      <div class="border"></div>
      <button class="pill" type="button" aria-haspopup="dialog" aria-expanded="false">
        <span class="dot"></span><span class="name"></span>
        <svg class="chev" width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    `;
    shadow.querySelector('.pill').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleFlyout();
    });
    (document.body || document.documentElement).appendChild(host);
  }

  function render(data) {
    const ws = data?.workspace || null;
    const key = JSON.stringify(data);
    if (key === lastKey && host?.isConnected) return;
    lastKey = key;

    if (!data || (!data.showPill && !(data.showBorder && ws))) {
      closeFlyout();
      host?.remove();
      host = null;
      return;
    }

    ensureHost();
    const color = COLORS[ws?.color] || '#9aa0a6';
    const border = shadow.querySelector('.border');
    border.style.display = data.showBorder && ws ? 'block' : 'none';
    border.style.background = color;

    const pill = shadow.querySelector('.pill');
    pill.style.display = data.showPill ? 'flex' : 'none';
    shadow.querySelector('.dot').style.background = color;
    shadow.querySelector('.name').textContent = ws ? `${ws.icon ? ws.icon + ' ' : ''}${ws.name}` : 'Workspaces';
    pill.title = ws ? `Workspace: ${ws.name}` : 'This window is not a workspace';
  }

  function toggleFlyout() {
    if (flyout) closeFlyout();
    else openFlyout();
  }

  function openFlyout() {
    if (!alive() || !shadow) return;
    flyout = document.createElement('iframe');
    flyout.src = chrome.runtime.getURL('src/sidepanel/panel.html?mode=flyout');
    flyout.title = 'Workspaces';
    shadow.appendChild(flyout);
    const pill = shadow.querySelector('.pill');
    pill.classList.add('open');
    pill.setAttribute('aria-expanded', 'true');
    setTimeout(() => document.addEventListener('pointerdown', onOutside, true), 0);
  }

  function closeFlyout() {
    document.removeEventListener('pointerdown', onOutside, true);
    if (flyout) {
      flyout.remove();
      flyout = null;
    }
    const pill = shadow?.querySelector('.pill');
    pill?.classList.remove('open');
    pill?.setAttribute('aria-expanded', 'false');
  }

  function onOutside(e) {
    if (e.composedPath().includes(host)) return;
    closeFlyout();
  }

  async function refresh() {
    if (!alive()) {
      closeFlyout();
      host?.remove();
      return;
    }
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_PAGE_INDICATOR' });
      if (res?.success) render(res.data);
    } catch {
      // Worker restarting or extension reloaded
    }
  }

  window.addEventListener('message', (e) => {
    if (flyout && e.source === flyout.contentWindow && e.data?.type === 'CLOSE_WORKSPACES_FLYOUT') {
      closeFlyout();
    }
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && flyout) closeFlyout();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'INDICATOR_REFRESH') refresh();
  });

  window.__workspacesIndicator = { refresh };
  refresh();
})();
