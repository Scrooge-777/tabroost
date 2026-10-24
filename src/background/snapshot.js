/**
 * Capture a live browser window as persistent tabs and groups.
 */

import { sanitizeFavicon, sanitizeGroup, sanitizeWindowInfo } from '../shared/schema.js';
import { isNativeGrouped } from './group-sync.js';
import { generateId, NEW_TAB_URL } from '../shared/utils.js';

export function invert(map = {}) {
  const out = {};
  for (const [k, v] of Object.entries(map)) out[String(v)] = k;
  return out;
}

export function isNumericId(value) {
  return typeof value === 'number' || /^\d+$/.test(String(value ?? ''));
}

/**
 * Capture a live window as persistent tabs/groups. Existing persistent IDs are kept
 * stable via the live maps (native ID -> persistent ID), falling back to matching
 * group title+color and tab URL against the stored workspace.
 */
export async function snapshotWindow(windowId, existingWs = null, liveMaps = { tabs: {}, groups: {} }) {
  const [tabs, nativeGroups, win] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabGroups ? chrome.tabGroups.query({ windowId }).catch(() => []) : Promise.resolve([]),
    chrome.windows.get(windowId).catch(() => null)
  ]);

  const revGroups = invert(liveMaps.groups);
  const revTabs = invert(liveMaps.tabs);
  const existingGroups = existingWs?.groups || [];
  const usedGroupIds = new Set();
  const groupMap = {};
  const nativeToPersistent = new Map();

  const groups = nativeGroups.map((ng) => {
    let pid = revGroups[String(ng.id)];
    if (!pid || usedGroupIds.has(pid)) {
      const match = existingGroups.find(
        (g) => !usedGroupIds.has(g.id) && g.title === (ng.title || '') && g.color === ng.color
      );
      pid = match ? match.id : generateId('g');
    }
    usedGroupIds.add(pid);
    groupMap[pid] = ng.id;
    nativeToPersistent.set(ng.id, pid);
    return sanitizeGroup({ id: pid, title: ng.title || '', color: ng.color, collapsed: ng.collapsed });
  });

  // Unclaimed stored tab IDs by URL, consumed in order (handles duplicate URLs)
  const claimedTabIds = new Set(Object.keys(liveMaps.tabs).filter((pid) => tabs.some((t) => String(t.id) === String(liveMaps.tabs[pid]))));
  const byUrl = new Map();
  for (const st of existingWs?.tabs || []) {
    if (claimedTabIds.has(st.id)) continue;
    if (!byUrl.has(st.url)) byUrl.set(st.url, []);
    byUrl.get(st.url).push(st.id);
  }

  const usedTabIds = new Set();
  const tabMap = {};
  const savedTabs = tabs.map((t, idx) => {
    const url = t.url || t.pendingUrl || NEW_TAB_URL;
    let pid = revTabs[String(t.id)];
    if (!pid || usedTabIds.has(pid)) {
      const candidates = byUrl.get(url);
      pid = candidates && candidates.length ? candidates.shift() : generateId('t');
    }
    usedTabIds.add(pid);
    tabMap[pid] = t.id;
    return {
      id: pid,
      url,
      title: t.title || url,
      favIconUrl: sanitizeFavicon(t.favIconUrl),
      pinned: Boolean(t.pinned),
      index: idx,
      groupId: isNativeGrouped(t) ? nativeToPersistent.get(t.groupId) || null : null,
      active: Boolean(t.active)
    };
  });

  let windowInfo = existingWs?.window || null;
  if (win && win.state !== 'minimized') {
    windowInfo = sanitizeWindowInfo(win);
  }

  return {
    tabs: savedTabs,
    groups,
    window: windowInfo,
    liveMaps: { tabs: tabMap, groups: groupMap }
  };
}

