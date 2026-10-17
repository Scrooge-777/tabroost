/**
 * Common utilities for Brave Workspaces
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
 * Get favicon URL with Brave Shields fallback
 * Uses standard MV3 chrome-extension favicon URL if available
 */
export function getFaviconUrl(url, pageFavIconUrl = null) {
  if (pageFavIconUrl && !pageFavIconUrl.startsWith('chrome://')) {
    return pageFavIconUrl;
  }

  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    try {
      const runtimeId = chrome?.runtime?.id;
      if (runtimeId) {
        return `chrome-extension://${runtimeId}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`;
      }
    } catch {
      // Fallback if runtime id unavailable
    }
  }

  return null;
}

/**
 * Generate a letter or initial for fallback favicon tile
 */
export function getFallbackTileLetter(title, url) {
  if (title && title.trim()) {
    return title.trim().charAt(0).toUpperCase();
  }
  if (url) {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, '');
      return hostname.charAt(0).toUpperCase();
    } catch {
      // Ignore URL parse error
    }
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
    lower.startsWith('view-source:')
  );
}

/**
 * Sanitize URL for window/tab restoration
 */
export function sanitizeRestoreUrl(url) {
  if (!url) return 'chrome://newtab/';
  // Allowed safe internal pages
  if (url === 'chrome://newtab/' || url === 'brave://newtab/') {
    return 'chrome://newtab/';
  }
  // If restricted internal page that might crash or fail tab create, handle safely
  if (isRestrictedUrl(url)) {
    // Return url as is, but callers should catch errors and fallback to newtab
    return url;
  }
  return url;
}
