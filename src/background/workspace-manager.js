/**
 * Workspace Manager — handles CRUD, persistence, duplication, window adoption and
 * tab / tab-group operations on both open (live) and closed (stored) workspaces.
 *
 * Every write goes through mutate(), which serializes read-modify-write cycles so
 * concurrent saves (tab sync + UI actions) can never clobber each other.
 */

import { STORAGE_KEYS } from '../shared/constants.js';
import { storage } from '../shared/storage.js';
import {
  createWorkspaceModel,
  migrateStorageData,
  sanitizeTab,
  sanitizeGroup,
  sanitizeName,
  sanitizeIcon,
  sanitizeFavicon,
  sanitizeWindowInfo,
  sanitizeWorkspace,
  newTabEntry
} from '../shared/schema.js';
import { isValidColor, nextUnusedColor } from '../shared/colors.js';
import { windowRegistry } from './window-registry.js';
import { isNativeGrouped } from './group-sync.js';
// Circular with tab-sync.js; only used at call time. (Service workers forbid dynamic import().)
import { tabSync } from './tab-sync.js';
import { generateId, createLock, NEW_TAB_URL, sanitizeRestoreUrl } from '../shared/utils.js';

const withLock = createLock();
export const SKIP_SAVE = Symbol('skip-save');

function invert(map = {}) {
  const out = {};
  for (const [k, v] of Object.entries(map)) out[String(v)] = k;
  return out;
}

function isNumericId(value) {
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

export const workspaceManager = {
  SKIP_SAVE,

  /**
   * Load persisted state (workspaces, order, settings) without session info
   */
  async loadState() {
    const raw = await storage.getLocal([
      STORAGE_KEYS.WORKSPACES,
      STORAGE_KEYS.WORKSPACE_ORDER,
      STORAGE_KEYS.SETTINGS,
      STORAGE_KEYS.SCHEMA_VERSION
    ]);
    return migrateStorageData(raw);
  },

  /**
   * Load full workspaces state from storage, including window bindings
   */
  async getState() {
    const state = await this.loadState();
    const [bindings, activeWorkspaceId, previousWorkspaceId] = await Promise.all([
      windowRegistry.getAllBindings(),
      windowRegistry.getActiveWorkspaceId(),
      windowRegistry.getPreviousWorkspaceId()
    ]);

    return {
      ...state,
      bindings,
      activeWorkspaceId,
      previousWorkspaceId
    };
  },

  /**
   * Get single workspace by ID
   */
  async getWorkspace(id) {
    const state = await this.loadState();
    return state.workspaces[id] || null;
  },

  /**
   * Atomically read, modify and persist state. Return SKIP_SAVE from fn to avoid a write.
   */
  async mutate(fn) {
    return withLock(async () => {
      const state = await this.loadState();
      const result = await fn(state);
      if (result === SKIP_SAVE) return undefined;
      await storage.setLocal({
        [STORAGE_KEYS.SCHEMA_VERSION]: state.schemaVersion,
        [STORAGE_KEYS.WORKSPACES]: state.workspaces,
        [STORAGE_KEYS.WORKSPACE_ORDER]: state.workspaceOrder
      });
      return result;
    });
  },

  /**
   * Replace the workspaces dictionary (and optionally order) wholesale
   */
  async saveWorkspaces(workspaces, workspaceOrder = null) {
    return withLock(async () => {
      const update = { [STORAGE_KEYS.WORKSPACES]: workspaces };
      if (workspaceOrder) update[STORAGE_KEYS.WORKSPACE_ORDER] = workspaceOrder;
      await storage.setLocal(update);
    });
  },

  async updateSettings(partial = {}) {
    return withLock(async () => {
      const state = await this.loadState();
      const merged = migrateStorageData({ settings: { ...state.settings, ...partial } }).settings;
      await storage.setLocal({ [STORAGE_KEYS.SETTINGS]: merged });
      return merged;
    });
  },

  /**
   * Create a new workspace
   */
  async createWorkspace({ name, color, icon, tabs = [], groups = [], window: windowInfo = null } = {}) {
    return this.mutate((state) => {
      const chosenColor = isValidColor(color)
        ? color
        : nextUnusedColor(Object.values(state.workspaces).map((w) => w.color), state.workspaceOrder.length);
      const newWs = createWorkspaceModel({ name, color: chosenColor, icon, tabs, groups, window: windowInfo });
      state.workspaces[newWs.id] = newWs;
      state.workspaceOrder.push(newWs.id);
      return newWs;
    });
  },

  /**
   * Create a workspace from an existing browser window and bind it
   */
  async createFromCurrentWindow(windowId, name, color, icon = '') {
    const snap = await snapshotWindow(windowId);
    const ws = await this.createWorkspace({
      name: name || 'Window Workspace',
      color,
      icon,
      tabs: snap.tabs,
      groups: snap.groups,
      window: snap.window
    });

    await windowRegistry.bind(windowId, ws.id);
    await windowRegistry.setLiveMaps(ws.id, snap.liveMaps);
    return ws;
  },

  /**
   * Update name / color / icon in one go
   */
  async updateWorkspace(id, { name, color, icon } = {}) {
    return this.mutate((state) => {
      const ws = state.workspaces[id];
      if (!ws) throw new Error(`Workspace ${id} not found`);
      if (name !== undefined) ws.name = sanitizeName(name);
      if (color !== undefined && isValidColor(color)) ws.color = color;
      if (icon !== undefined) ws.icon = sanitizeIcon(icon);
      ws.updatedAt = Date.now();
      return ws;
    });
  },

  async renameWorkspace(id, newName) {
    return this.updateWorkspace(id, { name: newName });
  },

  async recolorWorkspace(id, newColor) {
    if (!isValidColor(newColor)) throw new Error(`Invalid color: ${newColor}`);
    return this.updateWorkspace(id, { color: newColor });
  },

  /**
   * Delete workspace. Its window (if open) stays open, unmanaged.
   * Returns the removed workspace and its position so the UI can offer undo.
   */
  async deleteWorkspace(id) {
    const removed = await this.mutate((state) => {
      const ws = state.workspaces[id];
      if (!ws) return SKIP_SAVE;
      const index = state.workspaceOrder.indexOf(id);
      delete state.workspaces[id];
      state.workspaceOrder = state.workspaceOrder.filter((wId) => wId !== id);
      return { workspace: ws, index };
    });

    if (!removed) return null;
    await windowRegistry.unbindWorkspace(id);
    return removed;
  },

  /**
   * Put a deleted workspace back (undo)
   */
  async restoreWorkspace(workspace, index = -1) {
    if (!workspace || !workspace.id) throw new Error('Nothing to restore');
    return this.mutate((state) => {
      const clean = sanitizeWorkspace(workspace, workspace.id);
      if (state.workspaces[clean.id]) clean.id = generateId('ws');
      state.workspaces[clean.id] = clean;
      const pos = index >= 0 && index <= state.workspaceOrder.length ? index : state.workspaceOrder.length;
      state.workspaceOrder.splice(pos, 0, clean.id);
      return clean;
    });
  },

  /**
   * Duplicate workspace
   */
  async duplicateWorkspace(id) {
    return this.mutate((state) => {
      const source = state.workspaces[id];
      if (!source) throw new Error(`Workspace ${id} not found`);

      const groupIdMap = new Map();
      const newGroups = (source.groups || []).map((g) => {
        const newGid = generateId('g');
        groupIdMap.set(g.id, newGid);
        return { ...g, id: newGid };
      });

      const newTabs = (source.tabs || []).map((t) => ({
        ...t,
        id: generateId('t'),
        groupId: t.groupId ? groupIdMap.get(t.groupId) || null : null
      }));

      const copy = createWorkspaceModel({
        name: `${source.name} (Copy)`,
        color: source.color,
        icon: source.icon,
        tabs: newTabs,
        groups: newGroups,
        window: source.window
      });

      state.workspaces[copy.id] = copy;
      const idx = state.workspaceOrder.indexOf(id);
      if (idx !== -1) state.workspaceOrder.splice(idx + 1, 0, copy.id);
      else state.workspaceOrder.push(copy.id);
      return copy;
    });
  },

  /**
   * Reorder workspaces
   */
  async reorderWorkspaces(newOrder = []) {
    return this.mutate((state) => {
      const validIds = [...new Set(newOrder)].filter((id) => Boolean(state.workspaces[id]));
      for (const id of state.workspaceOrder) {
        if (!validIds.includes(id)) validIds.push(id);
      }
      state.workspaceOrder = validIds;
      return validIds;
    });
  },

  /**
   * Adopt a window into an existing workspace (replacing its saved tabs)
   */
  async adoptWindow(windowId, workspaceId) {
    const existing = await this.getWorkspace(workspaceId);
    if (!existing) throw new Error(`Workspace ${workspaceId} not found`);

    const snap = await snapshotWindow(windowId, existing);
    const ws = await this.mutate((state) => {
      const target = state.workspaces[workspaceId];
      if (!target) throw new Error(`Workspace ${workspaceId} not found`);
      target.tabs = snap.tabs.length ? snap.tabs : [newTabEntry(0)];
      target.groups = snap.groups;
      target.window = snap.window;
      target.updatedAt = Date.now();
      target.lastOpenedAt = Date.now();
      return target;
    });

    await windowRegistry.bind(windowId, workspaceId);
    await windowRegistry.setLiveMaps(workspaceId, snap.liveMaps);
    return ws;
  },

  async touchLastOpened(workspaceId) {
    return this.mutate((state) => {
      const ws = state.workspaces[workspaceId];
      if (!ws) return SKIP_SAVE;
      ws.lastOpenedAt = Date.now();
      return ws;
    });
  },

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
