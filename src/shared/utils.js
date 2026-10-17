/**
 * Common utilities for Workspaces
 */

/**
 * Generate a unique ID with an optional prefix
 */
export function generateId(prefix = 'id') {
  const rand = Math.random().toString(36).substring(2, 8);
  const time = Date.now().toString(36).substring(3);
  return `${prefix}_${rand}${time}`;
}

/**
 * Simple debounce helper
 */
export function debounce(fn, delayMs) {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, delayMs);
  };
}

/**
 * Serialize async tasks: each task starts only after the previous one settled.
 * Used to make read-modify-write cycles on storage atomic within the worker.
 */
export function createLock() {
  let tail = Promise.resolve();
  return function withLock(task) {
    const run = tail.then(task, task);
    tail = run.catch(() => {});
    return run;
  };
}

/**
 * Deep equality check for tab/workspace data comparison
 */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }

  return true;
}

/**
 * Get a favicon URL, falling back to Chromium's _favicon API (needs the "favicon"
 * permission) when the page favicon is missing or was stripped by Brave Shields.
 */
export function getFaviconUrl(url, pageFavIconUrl = null) {
  if (pageFavIconUrl && !pageFavIconUrl.startsWith('chrome://') && !pageFavIconUrl.startsWith('brave://')) {
    return pageFavIconUrl;
  }

  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    try {
      const base = chrome?.runtime?.getURL?.('/_favicon/');
      if (base) {
        return `${base}?pageUrl=${encodeURIComponent(url)}&size=32`;
      }
    } catch {
      // Runtime unavailable (e.g. tests)
    }
  }

  return null;
}

/**
 * Generate a letter or initial for fallback favicon tile
 */
export function getFallbackTileLetter(title, url) {
  if (url) {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, '');
      if (hostname) return hostname.charAt(0).toUpperCase();
    } catch {
      // Ignore URL parse error
    }
  }
  if (title && title.trim()) {
    return title.trim().charAt(0).toUpperCase();
  }
  return 'W';
}

/**
 * Normalize URL for comparison (strips query, hash, protocol, www, trailing slashes)
 */
export function normalizeUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '').toLowerCase();
    return `${host}${path}`;
  } catch {
    return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase();
  }
}

/**
 * Compute Jaccard similarity between two Sets of normalized URLs
 */
export function jaccardSimilarity(setA, setB) {
  if (!setA || !setB || setA.size === 0 || setB.size === 0) return 0;

  let intersectionSize = 0;
  for (const item of setA) {
    if (setB.has(item)) {
      intersectionSize++;
    }
  }

  const unionSize = setA.size + setB.size - intersectionSize;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

/**
 * Check whether a URL is a restricted internal scheme (brave://, chrome://, etc.)
 */
export function isRestrictedUrl(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  return (
    lower.startsWith('chrome://') ||
    lower.startsWith('brave://') ||
    lower.startsWith('chrome-extension://') ||
    lower.startsWith('edge://') ||
    lower.startsWith('about:') ||
    lower.startsWith('view-source:') ||
    lower.startsWith('file://') ||
    lower.startsWith('javascript:') ||
    lower.startsWith('data:')
  );
}

export function isNewTabUrl(url = '') {
  const u = (url || '').toLowerCase();
  return (
    !u ||
    u.startsWith('chrome://newtab') ||
    u.startsWith('brave://newtab') ||
    u.startsWith('edge://newtab') ||
    u.startsWith('chrome://new-tab-page') ||
    u === 'about:blank'
  );
}

export const NEW_TAB_URL = 'chrome://newtab/';

/**
 * Sanitize URL for window/tab restoration.
 * brave:// pages are aliases of chrome:// pages; tabs.create only accepts the latter.
 * Schemes extensions can never open are replaced with the new tab page.
 */
export function sanitizeRestoreUrl(url) {
  if (!url || isNewTabUrl(url)) return NEW_TAB_URL;
  const lower = url.toLowerCase();
  if (lower.startsWith('brave://')) return 'chrome://' + url.slice('brave://'.length);
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('view-source:')) {
    return NEW_TAB_URL;
  }
  return url;
}

/**
 * Human friendly "time ago" string
 */
export function timeAgo(timestamp, now = Date.now()) {
  if (!timestamp) return '';
  const diff = Math.max(0, now - timestamp);
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return 'just now';
  if (diff < hour) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 30 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
