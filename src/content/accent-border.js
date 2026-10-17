/**
 * Content Script: Renders Edge-style Top Accent Bar and Top-Left Workspaces Button on web pages
 */

(async function () {
  // Only run in top frame of web pages
  if (window.top !== window.self) return;

  const BORDER_ID = 'brave-workspaces-accent-border';
  const PILL_ID = 'brave-workspaces-edge-pill';
  const FLYOUT_ID = 'brave-workspaces-edge-flyout';
  const BACKDROP_ID = 'brave-workspaces-edge-backdrop';

  const COLOR_MAP = {
    blue: '#2080F0',
    cyan: '#12B886',
    green: '#2FB344',
    yellow: '#F59F00',
    orange: '#F76707',
    red: '#FA5252',
    pink: '#E64980',
    purple: '#AE3EC9',
    grey: '#868E96'
  };

  let flyoutOpen = false;

  // Clean up any stale borders, backdrops, or flyouts
  try {
    const bar = document.getElementById(BORDER_ID);
    if (bar) bar.remove();
    document.querySelectorAll(`[id^="${BACKDROP_ID}"]`).forEach((el) => el.remove());
  } catch {}

  function applyBorder() {
    const bar = document.getElementById(BORDER_ID);
    if (bar) bar.remove();
  }

  function ensureKeyframes() {
    if (!document.getElementById('brave-ws-keyframes')) {
      const style = document.createElement('style');
      style.id = 'brave-ws-keyframes';
      style.textContent = `
        @keyframes braveWsFlyoutIn {
          from {
            opacity: 0;
            transform: translateY(-8px) scale(0.97);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `;
      const headOrDoc = document.head || document.documentElement;
      if (headOrDoc) headOrDoc.appendChild(style);
    }
  }

  function applyTopLeftPill(wsName, colorHex) {
    ensureKeyframes();
    let pill = document.getElementById(PILL_ID);

    if (!pill) {
      pill = document.createElement('div');
      pill.id = PILL_ID;
      pill.style.cssText = `
        position: fixed !important;
        top: 6px !important;
        left: 10px !important;
        height: 28px !important;
        padding: 0 11px !important;
        display: flex !important;
        align-items: center !important;
        gap: 7px !important;
        background: #202020 !important;
        border: 1px solid rgba(255, 255, 255, 0.14) !important;
        border-radius: 14px !important;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
        cursor: pointer !important;
        z-index: 2147483647 !important;
        user-select: none !important;
        font-family: "Segoe UI Variable Text", "Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, sans-serif !important;
        font-size: 12px !important;
        font-weight: 600 !important;
        color: #ffffff !important;
        opacity: 0.96 !important;
        transition: background-color 0.15s ease, transform 0.15s cubic-bezier(0.16, 1, 0.3, 1) !important;
      `;

      pill.addEventListener('mouseenter', () => {
        pill.style.background = '#2d2d2d';
        pill.style.transform = 'translateY(-1px)';
      });

      pill.addEventListener('mouseleave', () => {
        if (!flyoutOpen) {
          pill.style.background = '#202020';
          pill.style.transform = 'translateY(0)';
        }
      });

      pill.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
      });

      pill.addEventListener('mousedown', (e) => {
        e.stopPropagation();
      });

      pill.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        try {
          toggleFlyout();
        } catch (err) {
          console.warn('Brave Workspaces: Could not toggle flyout:', err);
        }
      });

      const root = document.body || document.documentElement;
      if (root) root.appendChild(pill);
    } else {
      if (document.body && pill.parentElement !== document.body) {
        document.body.appendChild(pill);
      }
      pill.style.display = 'flex';
      pill.style.visibility = 'visible';
    }

    const dotColor = colorHex || '#0078D4';
    const title = wsName || 'Workspaces';

    pill.innerHTML = `
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background-color:${dotColor};flex-shrink:0;pointer-events:none;"></span>
      <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;color:#ffffff;pointer-events:none;font-weight:600;">${escapeHtml(title)}</span>
      <svg viewBox="0 0 12 12" width="10" height="10" fill="rgba(255,255,255,0.7)" style="flex-shrink:0;margin-left:1px;pointer-events:none;">
        <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
  }

  let outsidePointerListener = null;

  function attachOutsideDismissListener() {
    detachOutsideDismissListener();
    outsidePointerListener = (e) => {
      const pill = document.getElementById(PILL_ID);
      const iframe = document.getElementById(FLYOUT_ID);
      if (pill && (pill === e.target || pill.contains(e.target))) {
        return;
      }
      if (iframe && (iframe === e.target || iframe.contains(e.target))) {
        return;
      }
      closeFlyout();
    };

    // Attach to document after the opening click completes
    setTimeout(() => {
      if (flyoutOpen && outsidePointerListener) {
        document.addEventListener('pointerdown', outsidePointerListener);
      }
    }, 150);
  }

  function detachOutsideDismissListener() {
    if (outsidePointerListener) {
      document.removeEventListener('pointerdown', outsidePointerListener);
      outsidePointerListener = null;
    }
  }

  function toggleFlyout() {
    try {
      if (flyoutOpen) {
        closeFlyout();
      } else {
        openFlyout();
      }
    } catch (err) {
      console.warn('Brave Workspaces: Error toggling flyout:', err);
    }
  }

  function openFlyout() {
    try {
      if (!isExtensionValid()) return;
      closeFlyout();
      ensureKeyframes();

      flyoutOpen = true;
      const pill = document.getElementById(PILL_ID);
      if (pill) {
        pill.style.background = '#323232';
        pill.style.zIndex = '2147483647';
        const chevron = pill.querySelector('svg');
        if (chevron) chevron.style.transform = 'rotate(180deg)';
      }

      const root = document.body || document.documentElement;
      if (!root) return;

      // Clean up any stale backdrops if they exist
      document.querySelectorAll(`[id^="${BACKDROP_ID}"]`).forEach((el) => el.remove());

      // Precisely align the flyout directly beneath the pill button
      let topPos = 38;
      let leftPos = 10;
      if (pill) {
        const rect = pill.getBoundingClientRect();
        topPos = Math.round(rect.bottom + 4);
        leftPos = Math.round(rect.left);
      }

      // Consistent, dependable height with internal scrolling
      const maxAvailableHeight = Math.max(300, window.innerHeight - topPos - 16);
      const flyoutHeight = Math.min(580, maxAvailableHeight);

      const iframe = document.createElement('iframe');
      iframe.id = FLYOUT_ID;
      iframe.src = chrome.runtime.getURL('src/sidepanel/panel.html');
      iframe.style.cssText = `
        position: fixed !important;
        top: ${topPos}px !important;
        left: ${leftPos}px !important;
        width: 340px !important;
        height: ${flyoutHeight}px !important;
        min-width: 320px !important;
        max-width: calc(100vw - 20px) !important;
        max-height: ${maxAvailableHeight}px !important;
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
        box-sizing: border-box !important;
        border: 1px solid rgba(255, 255, 255, 0.12) !important;
        border-radius: 12px !important;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45) !important;
        background: #202020 !important;
        z-index: 2147483647 !important;
        color-scheme: dark !important;
        animation: braveWsFlyoutIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
      `;

      root.appendChild(iframe);
      attachOutsideDismissListener();
    } catch (err) {
      console.warn('Brave Workspaces: Error in openFlyout:', err);
      closeFlyout();
    }
  }

  function closeFlyout() {
    try {
      flyoutOpen = false;
      detachOutsideDismissListener();

      document.querySelectorAll(`[id^="${BACKDROP_ID}"]`).forEach((el) => el.remove());

      const iframe = document.getElementById(FLYOUT_ID);
      if (iframe) iframe.remove();

      const pill = document.getElementById(PILL_ID);
      if (pill) {
        pill.style.opacity = '0.9';
        pill.style.background = 'rgba(28, 33, 46, 0.90)';
        pill.style.transform = 'translateY(0)';
        const chevron = pill.querySelector('svg');
        if (chevron) chevron.style.transform = 'rotate(0deg)';
      }
    } catch {}
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isExtensionValid() {
    try {
      return typeof chrome !== 'undefined' && Boolean(chrome?.runtime?.id);
    } catch {
      return false;
    }
  }

  async function updateUI() {
    if (!isExtensionValid()) {
      const p = document.getElementById(PILL_ID);
      if (p) p.remove();
      const b = document.getElementById(BORDER_ID);
      if (b) b.remove();
      return;
    }

    // Immediate optimistic render so button is instantly visible
    try {
      applyTopLeftPill(null, null);
    } catch {}

    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_CURRENT_STATUS' }).catch(() => null);
      if (!isExtensionValid()) return;

      const currentWsId = res?.data?.currentWorkspaceId || null;

      const stateRes = await chrome.runtime.sendMessage({ type: 'LIST_WORKSPACES' }).catch(() => null);
      if (!isExtensionValid()) return;

      const settings = stateRes?.data?.settings || {};
      const ws = currentWsId ? stateRes?.data?.workspaces?.[currentWsId] : null;
      const colorHex = ws?.color ? (COLOR_MAP[ws.color] || '#2080F0') : null;

      // 1. Accent border (removed)
      applyBorder();

      // 2. Top-Left Pill Button
      if (settings.showTopLeftButton !== false) {
        applyTopLeftPill(ws ? ws.name : null, colorHex);
      } else {
        const pill = document.getElementById(PILL_ID);
        if (pill) pill.remove();
      }
    } catch {
      // Gracefully ignore if context is invalidated
    }
  }

  // Listen for messages from iframe
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'CLOSE_WORKSPACES_FLYOUT') {
      closeFlyout();
    }
  });

  // Close flyout on Escape key
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && flyoutOpen) {
      closeFlyout();
    }
  });

  // Run on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateUI);
  } else {
    updateUI();
  }
  window.addEventListener('load', updateUI);

  // Listen for state changes from background
  if (isExtensionValid() && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!isExtensionValid()) return;
      if (msg?.type === 'STATE_CHANGED' || msg?.type === 'WORKSPACE_UPDATED') {
        updateUI();
      }
    });
  }
})();
