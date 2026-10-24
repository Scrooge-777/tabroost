/**
 * Tab and tab-group operations on workspaces, open (live window) or closed (stored).
 * Mixed into workspaceManager, so methods use `this.mutate` and friends.
 */

import { sanitizeTab, newTabEntry } from '../shared/schema.js';
import { isValidColor, nextUnusedColor } from '../shared/colors.js';
import { windowRegistry } from './window-registry.js';
import { isNativeGrouped } from './group-sync.js';
// Circular with tab-sync.js; only used at call time. (Service workers forbid dynamic import().)
import { tabSync } from './tab-sync.js';
import { SKIP_SAVE } from './skip-save.js';
import { invert, isNumericId } from './snapshot.js';
import { generateId, NEW_TAB_URL, sanitizeRestoreUrl } from '../shared/utils.js';

export const tabOperations = {
  // ---------------------------------------------------------------------------
  // Live resolution helpers
  // ---------------------------------------------------------------------------

  async liveContext(workspaceId) {
    if (!workspaceId) return null;
    const winId = await windowRegistry.getWindowForWorkspace(workspaceId);
    if (winId === null) return null;
    const maps = await windowRegistry.getLiveMaps(workspaceId);
    return { workspaceId, winId, maps };
  },

  /**
   * Resolve a persistent (or native numeric) tab ID to a live Chrome tab in ctx's window
   */
  async resolveLiveTab(ctx, tabRef) {
    if (!ctx || tabRef == null) return null;
    let chromeId = ctx.maps.tabs[String(tabRef)];
    if (chromeId == null && isNumericId(tabRef)) chromeId = Number(tabRef);
    if (chromeId == null) return null;
    try {
      const tab = await chrome.tabs.get(chromeId);
      return tab && tab.windowId === ctx.winId ? tab : null;
    } catch {
      return null;
    }
  },

  resolveNativeGroupId(ctx, groupRef) {
    if (!ctx || groupRef == null) return null;
    const mapped = ctx.maps.groups[String(groupRef)];
    if (mapped != null) return mapped;
    return isNumericId(groupRef) ? Number(groupRef) : null;
  },

  persistentGroupIdFor(maps, nativeGroupId) {
    return invert(maps.groups)[String(nativeGroupId)] || null;
  },

  /**
   * Make sure removing/moving a tab never closes its window (and loses the workspace)
   */
  async ensureNotLastTab(windowId) {
    const tabs = await chrome.tabs.query({ windowId });
    if (tabs.length <= 1) {
      await chrome.tabs.create({ windowId, url: NEW_TAB_URL, active: false });
    }
  },

  async flushSync(workspaceId) {
    await tabSync.flush(workspaceId);
  },

  // ---------------------------------------------------------------------------
  // Tab operations
  // ---------------------------------------------------------------------------

  /**
   * Move a tab to a target workspace.
   * tabRef: persistent tab ID (with sourceWorkspaceId) or native Chrome tab ID.
   */
  async moveTabToWorkspace(tabRef, targetWorkspaceId, sourceWorkspaceId = null) {
    const target = await this.getWorkspace(targetWorkspaceId);
    if (!target) throw new Error(`Target workspace ${targetWorkspaceId} not found`);

    let sourceWsId = sourceWorkspaceId;
    let liveTab = null;
    let persistentId = isNumericId(tabRef) ? null : String(tabRef);

    if (isNumericId(tabRef) && !sourceWsId) {
      try {
        liveTab = await chrome.tabs.get(Number(tabRef));
      } catch {
        throw new Error('That tab no longer exists');
      }
      sourceWsId = await windowRegistry.getWorkspaceForWindow(liveTab.windowId);
    }

    if (sourceWsId === targetWorkspaceId) return { moved: false };

    const sourceCtx = await this.liveContext(sourceWsId);
    if (!liveTab && sourceCtx) liveTab = await this.resolveLiveTab(sourceCtx, tabRef);
    if (!persistentId && sourceCtx && liveTab) {
      persistentId = invert(sourceCtx.maps.tabs)[String(liveTab.id)] || null;
    }
    persistentId = persistentId || generateId('t');

    const source = sourceWsId ? await this.getWorkspace(sourceWsId) : null;
    const storedEntry = source?.tabs.find((t) => t.id === persistentId) || null;
    const entry = sanitizeTab({
      ...(storedEntry || {}),
      ...(liveTab ? { url: liveTab.url || liveTab.pendingUrl, title: liveTab.title, favIconUrl: liveTab.favIconUrl, pinned: liveTab.pinned } : {}),
      id: persistentId,
      groupId: null,
      active: false
    });
    if (!liveTab && !storedEntry) throw new Error('Tab not found');

    const targetWinId = await windowRegistry.getWindowForWorkspace(targetWorkspaceId);

    if (liveTab) {
      await this.ensureNotLastTab(liveTab.windowId);
      if (targetWinId !== null) {
        await chrome.tabs.move(liveTab.id, { windowId: targetWinId, index: -1 });
        await windowRegistry.moveLiveTab(sourceWsId, targetWorkspaceId, persistentId, liveTab.id);
      } else {
        await this.mutate((state) => {
          const ws = state.workspaces[targetWorkspaceId];
          if (!ws) return SKIP_SAVE;
          ws.tabs.push({ ...entry, index: ws.tabs.length });
          ws.updatedAt = Date.now();
          return true;
        });
        // The source window's own sync records the removal
        await chrome.tabs.remove(liveTab.id);
      }
      return { moved: true, tabId: persistentId };
    }

    // Source workspace is closed: the tab only exists in storage
    if (targetWinId !== null) {
      const created = await chrome.tabs.create({ windowId: targetWinId, url: sanitizeRestoreUrl(entry.url), active: false });
      await windowRegistry.moveLiveTab(null, targetWorkspaceId, persistentId, created.id);
    }
    await this.mutate((state) => {
      const src = state.workspaces[sourceWsId];
      if (src) {
        src.tabs = src.tabs.filter((t) => t.id !== persistentId);
        if (src.tabs.length === 0) src.tabs.push(newTabEntry(0));
        pruneEmptyGroups(src);
        src.updatedAt = Date.now();
      }
      const ws = state.workspaces[targetWorkspaceId];
      if (ws && targetWinId === null) {
        ws.tabs.push({ ...entry, index: ws.tabs.length });
        ws.updatedAt = Date.now();
      }
      return true;
    });
    return { moved: true, tabId: persistentId };
  },

  /**
   * Close a specific tab in a workspace
   */
  async closeTabInWorkspace(workspaceId, tabId) {
    const ctx = await this.liveContext(workspaceId);
    const liveTab = await this.resolveLiveTab(ctx, tabId);
    if (liveTab) {
      await this.ensureNotLastTab(liveTab.windowId);
      await chrome.tabs.remove(liveTab.id);
      return { closed: true, live: true };
    }

    await this.mutate((state) => {
      const ws = state.workspaces[workspaceId];
      if (!ws) return SKIP_SAVE;
      ws.tabs = ws.tabs.filter((t) => String(t.id) !== String(tabId));
      if (ws.tabs.length === 0) ws.tabs.push(newTabEntry(0));
      ws.tabs.forEach((t, i) => { t.index = i; });
      pruneEmptyGroups(ws);
      ws.updatedAt = Date.now();
      return true;
    });
    return { closed: true, live: false };
  },

  // ---------------------------------------------------------------------------
  // Tab group operations
  // ---------------------------------------------------------------------------

  /**
   * Merge one tab into another tab's group (or create a new group with both)
   */
  async mergeTabsIntoGroup({ sourceWorkspaceId, sourceTabId, targetWorkspaceId, targetTabId }) {
    if (!sourceTabId || !targetTabId || String(sourceTabId) === String(targetTabId)) {
      return { success: false, reason: 'invalid_tabs' };
    }

    let movedSourceId = sourceTabId;
    if (sourceWorkspaceId && sourceWorkspaceId !== targetWorkspaceId) {
      const res = await this.moveTabToWorkspace(sourceTabId, targetWorkspaceId, sourceWorkspaceId);
      movedSourceId = res.tabId || sourceTabId;
    }

    const ctx = await this.liveContext(targetWorkspaceId);
    if (ctx) {
      const sourceLive = await this.resolveLiveTab(ctx, movedSourceId);
      const targetLive = await this.resolveLiveTab(ctx, targetTabId);
      if (sourceLive && targetLive) {
        let nativeGid;
        let isNew = false;
        if (isNativeGrouped(targetLive)) {
          nativeGid = targetLive.groupId;
          await chrome.tabs.group({ tabIds: [sourceLive.id], groupId: nativeGid });
        } else if (isNativeGrouped(sourceLive)) {
          nativeGid = sourceLive.groupId;
          await chrome.tabs.group({ tabIds: [targetLive.id], groupId: nativeGid });
        } else {
          // Without windowId Chrome creates the group in the *focused* window and moves the tabs there
          nativeGid = await chrome.tabs.group({ tabIds: [targetLive.id, sourceLive.id], createProperties: { windowId: ctx.winId } });
          isNew = true;
          if (chrome.tabGroups) {
            const ws = await this.getWorkspace(targetWorkspaceId);
            const color = nextUnusedColor((ws?.groups || []).map((g) => g.color));
            await chrome.tabGroups.update(nativeGid, { color }).catch(() => {});
          }
        }
        await this.flushSync(targetWorkspaceId);
        const maps = await windowRegistry.getLiveMaps(targetWorkspaceId);
        return { success: true, groupId: this.persistentGroupIdFor(maps, nativeGid) || nativeGid, isNew, live: true };
      }
    }

    // Closed workspace: update stored model directly
    return this.mutate((state) => {
      const ws = state.workspaces[targetWorkspaceId];
      if (!ws) return SKIP_SAVE;
      const targetTab = ws.tabs.find((t) => String(t.id) === String(targetTabId));
      const sourceTab = ws.tabs.find((t) => String(t.id) === String(movedSourceId));
      if (!targetTab || !sourceTab) return SKIP_SAVE;

      let gid = targetTab.groupId || sourceTab.groupId;
      let isNew = false;
      if (!gid) {
        gid = generateId('g');
        isNew = true;
        ws.groups.push({
          id: gid,
          title: '',
          color: nextUnusedColor(ws.groups.map((g) => g.color)),
          collapsed: false
        });
      }
      targetTab.groupId = gid;
      sourceTab.groupId = gid;
      keepGroupContiguous(ws, gid);
      pruneEmptyGroups(ws);
      ws.updatedAt = Date.now();
      return { success: true, groupId: gid, isNew, live: false };
    }).then((res) => res || { success: false, reason: 'tabs_not_found' });
  },

  /**
   * Update title and/or color (and optionally collapsed state) of a tab group
   */
  async updateTabGroup({ workspaceId, groupId, title, color, collapsed }) {
    const ctx = await this.liveContext(workspaceId);
    const nativeGid = this.resolveNativeGroupId(ctx, groupId);
    if (ctx && nativeGid != null && chrome.tabGroups) {
      try {
        const props = {};
        if (title !== undefined) props.title = title || '';
        if (color !== undefined && isValidColor(color)) props.color = color;
        if (collapsed !== undefined) props.collapsed = Boolean(collapsed);
        await chrome.tabGroups.update(nativeGid, props);
        await this.flushSync(workspaceId);
      } catch (err) {
        console.warn('Live updateTabGroup failed, updating model:', err);
      }
    }

    const result = await this.mutate((state) => {
      const ws = state.workspaces[workspaceId];
      if (!ws) return SKIP_SAVE;
      const persistentId = ctx && isNumericId(groupId) ? this.persistentGroupIdFor(ctx.maps, groupId) || String(groupId) : String(groupId);
      const group = ws.groups.find((g) => g.id === persistentId);
      if (!group) return SKIP_SAVE;
      if (title !== undefined) group.title = String(title || '').trim();
      if (color !== undefined && isValidColor(color)) group.color = color;
      if (collapsed !== undefined) group.collapsed = Boolean(collapsed);
      ws.updatedAt = Date.now();
      return { success: true, group };
    });
    return result || { success: false };
  },

  /**
   * Add a tab to an existing group in a workspace
   */
  async addTabToGroup({ workspaceId, tabId, groupId }) {
    if (!workspaceId || tabId == null || groupId == null) return { success: false };

    const ctx = await this.liveContext(workspaceId);
    const liveTab = await this.resolveLiveTab(ctx, tabId);
    const nativeGid = this.resolveNativeGroupId(ctx, groupId);
    if (liveTab && nativeGid != null) {
      await chrome.tabs.group({ tabIds: [liveTab.id], groupId: nativeGid });
      await this.flushSync(workspaceId);
      return { success: true, groupId, live: true };
    }

    const result = await this.mutate((state) => {
      const ws = state.workspaces[workspaceId];
      if (!ws) return SKIP_SAVE;
      const tab = ws.tabs.find((t) => String(t.id) === String(tabId));
      if (!tab || !ws.groups.some((g) => g.id === String(groupId))) return SKIP_SAVE;
      tab.groupId = String(groupId);
      keepGroupContiguous(ws, tab.groupId);
      pruneEmptyGroups(ws);
      ws.updatedAt = Date.now();
      return { success: true, groupId: tab.groupId, live: false };
    });
    return result || { success: false };
  },

  /**
   * Remove a single tab from its group in a workspace
   */
  async removeTabFromGroup({ workspaceId, tabId }) {
    if (!workspaceId || tabId == null) return { success: false };

    const ctx = await this.liveContext(workspaceId);
    const liveTab = await this.resolveLiveTab(ctx, tabId);
    if (liveTab) {
      if (isNativeGrouped(liveTab)) {
        await chrome.tabs.ungroup([liveTab.id]);
        await this.flushSync(workspaceId);
      }
      return { success: true, live: true };
    }

    const result = await this.mutate((state) => {
      const ws = state.workspaces[workspaceId];
      if (!ws) return SKIP_SAVE;
      const tab = ws.tabs.find((t) => String(t.id) === String(tabId));
      if (!tab || !tab.groupId) return SKIP_SAVE;
      const gid = tab.groupId;
      tab.groupId = null;
      // Ungrouped tab leaves the block: put it right after the group's last member
      const members = ws.tabs.filter((t) => t.groupId === gid);
      if (members.length) {
        ws.tabs = ws.tabs.filter((t) => t !== tab);
        const lastIdx = ws.tabs.lastIndexOf(members[members.length - 1]);
        ws.tabs.splice(lastIdx + 1, 0, tab);
        ws.tabs.forEach((t, i) => { t.index = i; });
      }
      pruneEmptyGroups(ws);
      ws.updatedAt = Date.now();
      return { success: true, live: false };
    });
    return result || { success: false };
  },

  /**
   * Ungroup all tabs belonging to a group within a workspace
   */
  async ungroupTabs({ workspaceId, groupId }) {
    if (!workspaceId || groupId == null) return { success: false };

    const ctx = await this.liveContext(workspaceId);
    const nativeGid = this.resolveNativeGroupId(ctx, groupId);
    if (ctx && nativeGid != null) {
      const liveTabs = await chrome.tabs.query({ windowId: ctx.winId });
      const ids = liveTabs.filter((t) => t.groupId === nativeGid).map((t) => t.id);
      if (ids.length) {
        await chrome.tabs.ungroup(ids);
        await this.flushSync(workspaceId);
        return { success: true, live: true };
      }
    }

    const result = await this.mutate((state) => {
      const ws = state.workspaces[workspaceId];
      if (!ws) return SKIP_SAVE;
      const gid = String(groupId);
      ws.groups = ws.groups.filter((g) => g.id !== gid);
      ws.tabs.forEach((t) => {
        if (t.groupId === gid) t.groupId = null;
      });
      ws.updatedAt = Date.now();
      return { success: true, live: false };
    });
    return result || { success: false };
  },

  /**
   * Cluster ungrouped tabs into color-coded groups by site category
   */
  async organizeTabs({ workspaceId, windowId } = {}) {
    let targetWinId = windowId || null;
    if (!targetWinId && workspaceId) {
      targetWinId = await windowRegistry.getWindowForWorkspace(workspaceId);
    }

    if (targetWinId && chrome.tabs) {
      const liveTabs = await chrome.tabs.query({ windowId: targetWinId });
      const clusters = new Map();
      for (const t of liveTabs) {
        if (t.pinned || isNativeGrouped(t)) continue;
        const url = t.url || t.pendingUrl || '';
        if (!/^https?:/i.test(url)) continue;
        const cat = categorizeUrl(url);
        if (!clusters.has(cat.title)) clusters.set(cat.title, { color: cat.color, tabIds: [] });
        clusters.get(cat.title).tabIds.push(t.id);
      }

      let groupsCreated = 0;
      for (const [title, info] of clusters.entries()) {
        if (info.tabIds.length < 2) continue;
        const gid = await chrome.tabs.group({ tabIds: info.tabIds, createProperties: { windowId: targetWinId } });
        if (chrome.tabGroups) {
          await chrome.tabGroups.update(gid, { title, color: info.color }).catch(() => {});
        }
        groupsCreated++;
      }
      return { success: true, live: true, groupsCreated };
    }

    if (!workspaceId) return { success: false, reason: 'no_target' };

    const result = await this.mutate((state) => {
      const ws = state.workspaces[workspaceId];
      if (!ws || ws.tabs.length < 2) return SKIP_SAVE;
      const clusters = new Map();
      for (const t of ws.tabs) {
        if (t.pinned || t.groupId || !/^https?:/i.test(t.url || '')) continue;
        const cat = categorizeUrl(t.url);
        if (!clusters.has(cat.title)) clusters.set(cat.title, { color: cat.color, tabs: [] });
        clusters.get(cat.title).tabs.push(t);
      }

      let groupsCreated = 0;
      for (const [title, info] of clusters.entries()) {
        if (info.tabs.length < 2) continue;
        const gid = generateId('g');
        ws.groups.push({ id: gid, title, color: info.color, collapsed: false });
        info.tabs.forEach((t) => { t.groupId = gid; });
        keepGroupContiguous(ws, gid);
        groupsCreated++;
      }
      if (!groupsCreated) return SKIP_SAVE;
      ws.updatedAt = Date.now();
      return { success: true, live: false, groupsCreated };
    });
    return result || { success: true, live: false, groupsCreated: 0 };
  }
};


/**
 * Chrome keeps a group's tabs adjacent; mirror that in stored order so restore and
 * display agree. Members are pulled together at the position of the first member.
 */
function keepGroupContiguous(ws, gid) {
  const members = ws.tabs.filter((t) => t.groupId === gid);
  if (members.length < 2) return;
  const firstIdx = ws.tabs.findIndex((t) => t.groupId === gid);
  const rest = ws.tabs.filter((t) => t.groupId !== gid);
  const before = rest.filter((t) => ws.tabs.indexOf(t) < firstIdx);
  const after = rest.filter((t) => ws.tabs.indexOf(t) > firstIdx);
  ws.tabs = [...before, ...members, ...after];
  ws.tabs.forEach((t, i) => { t.index = i; });
}

function pruneEmptyGroups(ws) {
  const used = new Set(ws.tabs.map((t) => t.groupId).filter(Boolean));
  ws.groups = (ws.groups || []).filter((g) => used.has(g.id));
}

const CATEGORY_RULES = [
  { title: 'Development', color: 'blue', test: /(^|\.)(github\.com|gitlab\.com|stackoverflow\.com|stackexchange\.com|developer\.mozilla\.org|npmjs\.com|vercel\.app|vercel\.com|bitbucket\.org|codepen\.io|replit\.com|localhost)$/ },
  { title: 'Media', color: 'red', test: /(^|\.)(youtube\.com|netflix\.com|spotify\.com|twitch\.tv|soundcloud\.com|vimeo\.com|disneyplus\.com|primevideo\.com|hulu\.com|hotstar\.com)$/ },
  { title: 'Social', color: 'purple', test: /(^|\.)(reddit\.com|twitter\.com|x\.com|instagram\.com|facebook\.com|linkedin\.com|threads\.net|tiktok\.com|discord\.com|whatsapp\.com)$/ },
  { title: 'Productivity', color: 'green', test: /(^|\.)(docs\.google\.com|drive\.google\.com|sheets\.google\.com|mail\.google\.com|calendar\.google\.com|notion\.so|slack\.com|trello\.com|atlassian\.net|figma\.com|canva\.com|office\.com|outlook\.com)$/ },
  { title: 'Shopping', color: 'yellow', test: /(^|\.)(amazon\.[a-z.]+|ebay\.[a-z.]+|walmart\.com|aliexpress\.com|etsy\.com|target\.com|bestbuy\.com|flipkart\.com)$/ },
  { title: 'Search & AI', color: 'cyan', test: /(^|\.)(bing\.com|chatgpt\.com|openai\.com|claude\.ai|gemini\.google\.com|perplexity\.ai|duckduckgo\.com|search\.brave\.com)$/ },
  { title: 'News & Reading', color: 'orange', test: /(^|\.)(wikipedia\.org|medium\.com|news\.ycombinator\.com|bbc\.com|bbc\.co\.uk|nytimes\.com|cnn\.com|theverge\.com|substack\.com)$/ }
];

export function categorizeUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (/(^|\.)google\.[a-z.]+$/.test(host) && u.pathname.startsWith('/search')) {
      return { title: 'Search & AI', color: 'cyan' };
    }
    for (const rule of CATEGORY_RULES) {
      if (rule.test.test(host)) return { title: rule.title, color: rule.color };
    }
    const parts = host.split('.');
    const namePart = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    return { title: namePart.charAt(0).toUpperCase() + namePart.slice(1), color: 'grey' };
  } catch {
    return { title: 'Other', color: 'grey' };
  }
}

