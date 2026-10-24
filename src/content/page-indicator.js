/**
 * Page indicator — workspace pill button & accent border on web pages:
 *  - circular dot / expandable pill to instantly identify and switch workspaces
 *  - dashed circular dot for unsaved windows to prompt saving as a workspace
 *  - customizable screen positioning and size scale from Settings
 *  - thin accent border in workspace color across the top of page
 *
 * Runs inside a closed shadow root so web page CSS cannot interfere.
 */

(() => {
  if (window.top !== window.self) return;
  if (window.__tabroostIndicator) {
    window.__tabroostIndicator.refresh();
    return;
  }

  const HOST_ID = 'tabroost-ext-indicator';
  const COLORS = {
    blue: '#1a73e8', cyan: '#007b83', green: '#188038', yellow: '#e8a200', orange: '#e8710a',
    red: '#d93025', pink: '#d01884', purple: '#a142f4', grey: '#5f6368'
  };

  let host = null;
  let shadow = null;
  let flyout = null;
  let lastKey = '';
  let currentPosition = 'top-left';
  let currentSize = 'medium';
  let currentStyle = 'handle';
  let currentOffsetY = null;
  let hoverTimer = null;
  let justDragged = false;
  let hoverOpen = false;

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
    host.style.cssText = 'all: initial; position: fixed; inset: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none;';
    shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .border { position: fixed; top: 0; left: 0; right: 0; height: 3px; pointer-events: none; display: none; z-index: 2147483647; }

        /* Base pill styling */
        .pill {
          position: fixed; display: none; align-items: center; gap: 0; pointer-events: auto;
          box-sizing: border-box; overflow: hidden;
          border: 1px solid rgba(255,255,255,.22);
          background: rgb(32,33,36); color: #fff; cursor: pointer;
          font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
          font-weight: 600;
          box-shadow: 0 4px 14px rgba(0,0,0,.4);
          transition: max-width .22s cubic-bezier(.2,.9,.3,1), gap .2s ease, padding .2s ease, border-color .2s, box-shadow .2s;
          user-select: none;
          z-index: 2147483647;
        }
        .pill:hover, .pill.open, .pill:focus-visible { outline: none; }
        .pill.unsaved { border: 1.5px dashed rgba(255,255,255,.55); }
        .pill.unsaved:hover { border-color: rgba(255,255,255,.95); box-shadow: 0 4px 18px rgba(0,0,0,.6); }

        .dot { border-radius: 50%; flex: none; box-sizing: border-box; transition: background .2s, border .2s, transform .2s; }
        .name, .chev { opacity: 0; transition: opacity .15s ease; }
        .pill:hover .name, .pill:hover .chev, .pill.open .name, .pill.open .chev,
        .pill:focus-visible .name, .pill:focus-visible .chev { opacity: 1; }
        .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .chev { flex: none; transition: transform .15s ease, opacity .15s ease; }
        .pill.open .chev { transform: rotate(180deg); }

        /* Screen Positions */
        .pill.pos-top-left { top: 14px; left: 14px; right: auto; bottom: auto; }
        .pill.pos-top-right { top: 14px; right: 14px; left: auto; bottom: auto; flex-direction: row-reverse; }
        .pill.pos-bottom-left { bottom: 14px; left: 14px; top: auto; right: auto; }
        .pill.pos-bottom-right { bottom: 14px; right: 14px; top: auto; left: auto; flex-direction: row-reverse; }
        .pill.pos-center-left { top: 50%; left: 14px; transform: translateY(-50%); bottom: auto; right: auto; }
        .pill.pos-center-right { top: 50%; right: 14px; transform: translateY(-50%); bottom: auto; left: auto; flex-direction: row-reverse; }

        /* Size 1: Compact (26px) */
        .pill.size-compact { height: 26px; max-width: 26px; padding: 0 7px; border-radius: 13px; font-size: 11px; }
        .pill.size-compact:hover, .pill.size-compact.open, .pill.size-compact:focus-visible { max-width: 220px; gap: 6px; padding: 0 10px 0 8px; }
        .pill.size-compact.pos-top-right:hover, .pill.size-compact.pos-bottom-right:hover, .pill.size-compact.pos-center-right:hover,
        .pill.size-compact.pos-top-right.open, .pill.size-compact.pos-bottom-right.open, .pill.size-compact.pos-center-right.open { padding: 0 8px 0 10px; }
        .pill.size-compact .dot { width: 10px; height: 10px; }
        .pill.size-compact .dot.unsaved { border: 1.5px dashed #e8eaed; background: rgba(255,255,255,.08); }

        /* Size 2: Medium / Default (34px) */
        .pill.size-medium { height: 34px; max-width: 34px; padding: 0 9px; border-radius: 17px; font-size: 13px; }
        .pill.size-medium:hover, .pill.size-medium.open, .pill.size-medium:focus-visible { max-width: 260px; gap: 8px; padding: 0 14px 0 10px; }
        .pill.size-medium.pos-top-right:hover, .pill.size-medium.pos-bottom-right:hover, .pill.size-medium.pos-center-right:hover,
        .pill.size-medium.pos-top-right.open, .pill.size-medium.pos-bottom-right.open, .pill.size-medium.pos-center-right.open { padding: 0 10px 0 14px; }
        .pill.size-medium .dot { width: 14px; height: 14px; }
        .pill.size-medium .dot.unsaved { border: 2px dashed #e8eaed; background: rgba(255,255,255,.1); }

        /* Size 3: Large (42px) */
        .pill.size-large { height: 42px; max-width: 42px; padding: 0 11px; border-radius: 21px; font-size: 14px; }
        .pill.size-large:hover, .pill.size-large.open, .pill.size-large:focus-visible { max-width: 300px; gap: 9px; padding: 0 16px 0 12px; }
        .pill.size-large.pos-top-right:hover, .pill.size-large.pos-bottom-right:hover, .pill.size-large.pos-center-right:hover,
        .pill.size-large.pos-top-right.open, .pill.size-large.pos-bottom-right.open, .pill.size-large.pos-center-right.open { padding: 0 12px 0 16px; }
        .pill.size-large .dot { width: 18px; height: 18px; }
        .pill.size-large .dot.unsaved { border: 2.5px dashed #e8eaed; background: rgba(255,255,255,.12); }

        /* Size 4: Extra Large (50px) */
        .pill.size-xlarge { height: 50px; max-width: 50px; padding: 0 13px; border-radius: 25px; font-size: 16px; }
        .pill.size-xlarge:hover, .pill.size-xlarge.open, .pill.size-xlarge:focus-visible { max-width: 340px; gap: 10px; padding: 0 18px 0 14px; }
        .pill.size-xlarge.pos-top-right:hover, .pill.size-xlarge.pos-bottom-right:hover, .pill.size-xlarge.pos-center-right:hover,
        .pill.size-xlarge.pos-top-right.open, .pill.size-xlarge.pos-bottom-right.open, .pill.size-xlarge.pos-center-right.open { padding: 0 14px 0 18px; }
        .pill.size-xlarge .dot { width: 22px; height: 22px; }
        .pill.size-xlarge .dot.unsaved { border: 3px dashed #e8eaed; background: rgba(255,255,255,.15); }

        /* Edge handle: a thin strip hugging the screen edge; the panel slides out from it */
        .handle {
          position: fixed; display: none; pointer-events: auto; border: 0; padding: 0; cursor: pointer;
          background: var(--c, #9aa0a6); opacity: .4; z-index: 2147483647;
          transition: opacity .15s ease, width .15s ease, box-shadow .15s ease;
        }
        .handle:hover, .handle:focus-visible, .handle.open { opacity: 1; outline: none; box-shadow: 0 0 10px var(--c, #9aa0a6); }
        .handle.unsaved {
          background: repeating-linear-gradient(180deg, #9aa0a6 0 5px, transparent 5px 9px);
        }
        .handle.side-left { left: 0; border-radius: 0 6px 6px 0; }
        .handle.side-right { right: 0; border-radius: 6px 0 0 6px; }
        .handle.v-top { top: 14px; }
        .handle.v-bottom { bottom: 14px; }
        .handle.v-free { margin-top: calc(var(--h) / -2); }
        .handle { touch-action: none; }
        .handle.v-center { top: 50%; margin-top: calc(var(--h) / -2); }
        .handle.size-compact { --h: 36px; width: 4px; height: var(--h); }
        .handle.size-medium { --h: 56px; width: 5px; height: var(--h); }
        .handle.size-large { --h: 76px; width: 6px; height: var(--h); }
        .handle.size-xlarge { --h: 100px; width: 8px; height: var(--h); }
        .handle:hover, .handle:focus-visible, .handle.open { width: 10px; }

        /* Flyout iframe positioning */
        /* Popup card that opens beside the handle, not a full-height sidebar */
        iframe.edge.side-left { left: 18px; right: auto; transform-origin: left center; animation: pop-left .16s cubic-bezier(.2,.9,.3,1); }
        iframe.edge.side-right { right: 18px; left: auto; transform-origin: right center; animation: pop-right .16s cubic-bezier(.2,.9,.3,1); }
        iframe.edge.v-top { top: 14px; bottom: auto; }
        iframe.edge.v-bottom { bottom: 14px; top: auto; }
        iframe.edge.v-center { top: 50%; bottom: auto; transform: translateY(-50%); }
        @keyframes pop-left { from { opacity: 0; translate: -12px 0; scale: .97; } }
        @keyframes pop-right { from { opacity: 0; translate: 12px 0; scale: .97; } }
        @media (prefers-reduced-motion: reduce) { iframe.edge { animation: none; } }

        iframe {
          position: fixed; width: 360px; max-width: calc(100vw - 28px);
          height: min(560px, calc(100vh - 72px)); border: 0; border-radius: 12px;
          box-shadow: 0 12px 42px rgba(0,0,0,.45); background: transparent; color-scheme: normal;
          pointer-events: auto; z-index: 2147483647;
          animation: pop .16s cubic-bezier(.2,.9,.3,1);
        }
        iframe.pos-top-left { top: 58px; left: 14px; }
        iframe.pos-top-right { top: 58px; right: 14px; }
        iframe.pos-bottom-left { bottom: 58px; left: 14px; }
        iframe.pos-bottom-right { bottom: 58px; right: 14px; }
        iframe.pos-center-left { top: 50%; left: 14px; transform: translateY(-50%); }
        iframe.pos-center-right { top: 50%; right: 14px; transform: translateY(-50%); }

        @keyframes pop { from { opacity: 0; transform: translateY(-6px) scale(.98); } }
        @media (prefers-reduced-motion: reduce) { .pill, .chev, iframe { transition: none; animation: none; } }
      </style>
      <div class="border"></div>
      <button class="handle side-left v-top size-medium" type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="Tabroost workspaces"></button>
      <button class="pill size-medium pos-top-left" type="button" aria-haspopup="dialog" aria-expanded="false">
        <span class="dot"></span><span class="name"></span>
        <svg class="chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    `;
    for (const el of shadow.querySelectorAll('.pill, .handle')) {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (justDragged) {
          justDragged = false;
          return;
        }
        toggleFlyout();
      });
    }

    // Handle: drag up and down to reposition, optionally open when hovered
    const handleEl = shadow.querySelector('.handle');
    let drag = null;
    handleEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag = { startY: e.clientY, moved: false };
      handleEl.setPointerCapture(e.pointerId);
    });
    handleEl.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (!drag.moved && Math.abs(e.clientY - drag.startY) < 5) return;
      drag.moved = true;
      clearTimeout(hoverTimer);
      const pct = Math.min(95, Math.max(5, (e.clientY / window.innerHeight) * 100));
      handleEl.classList.remove('v-top', 'v-center', 'v-bottom');
      handleEl.classList.add('v-free');
      handleEl.style.top = `${pct}%`;
      drag.pct = pct;
    });
    const endDrag = () => {
      if (drag?.moved && alive()) {
        justDragged = true;
        setTimeout(() => { justDragged = false; }, 300);
        chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings: { pillOffsetY: Math.round(drag.pct) } }).catch(() => {});
      }
      drag = null;
    };
    handleEl.addEventListener('pointerup', endDrag);
    handleEl.addEventListener('pointercancel', endDrag);
    handleEl.addEventListener('mouseenter', () => {
      if (!hoverOpen || flyout || drag) return;
      hoverTimer = setTimeout(() => { if (!flyout && !drag) openFlyout(); }, 250);
    });
    handleEl.addEventListener('mouseleave', () => clearTimeout(hoverTimer));
    (document.body || document.documentElement).appendChild(host);
  }

  /** True when this site is on the user's "never show here" list */
  function siteHidden(data) {
    const host = location.hostname.toLowerCase().replace(/^www\./, '');
    return (data?.hiddenSites || []).some((s) => host === s || host.endsWith('.' + s));
  }

  function render(data) {
    const ws = data?.workspace || null;
    const isWorkspace = Boolean(ws);
    const pos = data?.pillPosition || 'top-left';
    const size = data?.pillSize || 'medium';
    currentPosition = pos;
    currentSize = size;

    const style = data?.pillStyle === 'dot' ? 'dot' : 'handle';
    if (style !== currentStyle) closeFlyout();
    currentStyle = style;
    hoverOpen = Boolean(data?.openOnHover);

    const key = JSON.stringify({ data, pos, size });
    if (key === lastKey && host?.isConnected) return;
    lastKey = key;

    if (siteHidden(data) || (!data?.showPill && !data?.showBorder)) {
      closeFlyout();
      host?.remove();
      host = null;
      shadow = null;
      return;
    }

    ensureHost();
    const color = isWorkspace ? (COLORS[ws?.color] || '#9aa0a6') : '#9aa0a6';
    const border = shadow.querySelector('.border');
    border.style.display = data?.showBorder && isWorkspace ? 'block' : 'none';
    border.style.background = color;

    const pill = shadow.querySelector('.pill');
    pill.style.display = data?.showPill && style === 'dot' ? 'flex' : 'none';
    if (!data?.showPill) closeFlyout();

    // Edge handle (default): side + vertical anchor come from the position setting
    const handle = shadow.querySelector('.handle');
    const side = pos.endsWith('right') ? 'right' : 'left';
    const vertical = pos.startsWith('bottom') ? 'bottom' : pos.startsWith('center') ? 'center' : 'top';
    handle.style.display = data?.showPill && style === 'handle' ? 'block' : 'none';
    handle.className = `handle side-${side} v-${vertical} size-${size}${isWorkspace ? '' : ' unsaved'}${flyout ? ' open' : ''}`;
    currentOffsetY = typeof data?.offsetY === 'number' ? data.offsetY : null;
    if (currentOffsetY !== null) {
      handle.classList.remove('v-top', 'v-center', 'v-bottom');
      handle.classList.add('v-free');
      handle.style.top = `${currentOffsetY}%`;
    } else {
      handle.style.top = '';
    }
    handle.style.setProperty('--c', color);
    handle.title = isWorkspace
      ? `Workspace: ${ws.name} (click to open the panel)`
      : 'Unsaved window (click to save as a workspace)';
    handle.setAttribute('aria-label', handle.title);

    // Apply positioning and size classes
    pill.className = `pill pos-${pos} size-${size}${isWorkspace ? '' : ' unsaved'}${flyout ? ' open' : ''}`;

    const dot = shadow.querySelector('.dot');
    if (isWorkspace) {
      dot.className = 'dot';
      dot.style.background = color;
      dot.style.border = 'none';
      dot.style.boxShadow = `0 0 8px ${color}bb`;
    } else {
      dot.className = 'dot unsaved';
      dot.style.background = 'rgba(255,255,255,0.1)';
      dot.style.boxShadow = 'none';
    }

    const nameEl = shadow.querySelector('.name');
    nameEl.textContent = isWorkspace
      ? `${ws.icon ? ws.icon + ' ' : ''}${ws.name}`
      : '+ Save as workspace';

    pill.title = isWorkspace
      ? `Workspace: ${ws.name} (Click to switch)`
      : 'Unsaved Window (Click to save as workspace)';
  }

  function toggleFlyout() {
    if (flyout) closeFlyout();
    else openFlyout();
  }

  function openFlyout() {
    if (!alive() || !shadow) return;
    flyout = document.createElement('iframe');
    const edgeSide = currentPosition.endsWith('right') ? 'right' : 'left';
    const edgeV = currentOffsetY !== null ? 'free' : currentPosition.startsWith('bottom') ? 'bottom' : currentPosition.startsWith('center') ? 'center' : 'top';
    flyout.className = currentStyle === 'handle' ? `edge side-${edgeSide} v-${edgeV}` : `pos-${currentPosition}`;
    if (currentStyle === 'handle' && currentOffsetY !== null) {
      // Line the popup up with the dragged handle, kept fully on screen
      const height = Math.min(560, window.innerHeight - 72);
      const top = Math.max(14, Math.min(window.innerHeight - height - 14, (currentOffsetY / 100) * window.innerHeight - 28));
      flyout.style.top = `${top}px`;
    }
    flyout.src = chrome.runtime.getURL('src/sidepanel/panel.html?mode=flyout');
    flyout.title = 'Tabroost';
    shadow.appendChild(flyout);
    for (const el of shadow.querySelectorAll('.pill, .handle')) {
      el.classList.add('open');
      el.setAttribute('aria-expanded', 'true');
    }
    setTimeout(() => document.addEventListener('pointerdown', onOutside, true), 0);
  }

  function closeFlyout() {
    document.removeEventListener('pointerdown', onOutside, true);
    if (flyout) {
      flyout.remove();
      flyout = null;
    }
    for (const el of shadow?.querySelectorAll('.pill, .handle') || []) {
      el.classList.remove('open');
      el.setAttribute('aria-expanded', 'false');
    }
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
    if (flyout && e.source === flyout.contentWindow && e.data?.type === 'CLOSE_TABROOST_FLYOUT') {
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

  window.__tabroostIndicator = { refresh };
  refresh();
})();
