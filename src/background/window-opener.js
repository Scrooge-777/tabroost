/**
 * Window Opener — Opens, focuses, restores tabs & tab groups, and closes workspace windows
 */

import { windowRegistry } from './window-registry.js';
import { workspaceManager } from './workspace-manager.js';
import { groupSync } from './group-sync.js';
import { tabSync } from './tab-sync.js';
import { history } from './history.js';
import { sanitizeRestoreUrl, NEW_TAB_URL } from '../shared/utils.js';

async function createWindowFor(ws, firstUrl) {
  const props = { url: firstUrl, focused: true };
  const info = ws.window;
  if (info?.state === 'maximized' || info?.state === 'fullscreen') {
    props.state = info.state;
  } else if (info && info.width && info.height) {
    Object.assign(props, { width: info.width, height: info.height });
    if (info.left !== null && info.top !== null) Object.assign(props, { left: info.left, top: info.top });
  }

  try {
    return await chrome.windows.create(props);
  } catch (err) {
    // Off-screen bounds or a URL the browser refuses: fall back to a plain window
    console.warn('windowOpener: window create failed, retrying plain', err);
    return chrome.windows.create({ url: firstUrl === NEW_TAB_URL ? NEW_TAB_URL : firstUrl, focused: true })
      .catch(() => chrome.windows.create({ url: NEW_TAB_URL, focused: true }));
  }
}

async function createTabSafely(props) {
  try {
    return await chrome.tabs.create(props);
  } catch (err) {
    console.warn(`windowOpener: could not open ${props.url}, using new tab`, err);
    try {
      return await chrome.tabs.create({ ...props, url: NEW_TAB_URL });
    } catch {
      return null;
    }
  }
}

export const windowOpener = {
  /**
   * Open or focus a workspace in a window
   */
  async openWorkspace(workspaceId, targetTabIdentifier = null) {
    if (!workspaceId) return null;

    // 1. Already open: focus it
    const existingWinId = await windowRegistry.getWindowForWorkspace(workspaceId);
    if (existingWinId !== null) {
      try {
        await chrome.windows.update(existingWinId, { focused: true });
        await windowRegistry.setActiveWorkspaceId(workspaceId);
        await workspaceManager.touchLastOpened(workspaceId);

        if (targetTabIdentifier != null) {
          const ctx = await workspaceManager.liveContext(workspaceId);
          const target = await workspaceManager.resolveLiveTab(ctx, targetTabIdentifier);
          if (target) await chrome.tabs.update(target.id, { active: true });
        }
        return existingWinId;
      } catch (err) {
        console.warn(`Window ${existingWinId} was closed externally, reopening`, err);
        await windowRegistry.unbind(existingWinId);
      }
    }

    // 2. Load workspace data
    const ws = await workspaceManager.getWorkspace(workspaceId);
    if (!ws) throw new Error(`Workspace ${workspaceId} not found`);

    const state = await workspaceManager.loadState();
    const previousWsId = await windowRegistry.getActiveWorkspaceId();

    // 3. Suppress sync during restore to avoid thrashing
    await windowRegistry.setSuppressSync(true);
    let winId = null;

    try {
      const tabs = ws.tabs.length > 0 ? ws.tabs : [{ id: null, url: NEW_TAB_URL, pinned: false, active: true }];
      const wantedActive = targetTabIdentifier != null
        ? tabs.find((t) => t.id === targetTabIdentifier) || tabs.find((t) => t.active)
        : tabs.find((t) => t.active);

      const win = await createWindowFor(ws, sanitizeRestoreUrl(tabs[0].url));
      winId = win.id;
      await windowRegistry.bind(win.id, workspaceId);

      const createdTabs = [];
      const lazyTabs = [];
      const firstLive = (win.tabs && win.tabs[0]) || (await chrome.tabs.query({ windowId: win.id }))[0];
      const isFirstActive = (tabs[0] === wantedActive);

      if (firstLive) {
        if (tabs[0].pinned) {
          await chrome.tabs.update(firstLive.id, { pinned: true }).catch(() => {});
        }
        const entry = { id: firstLive.id, savedTabId: tabs[0].id, savedGroupId: tabs[0].groupId, active: isFirstActive };
        createdTabs.push(entry);
        if (state.settings?.lazyRestoreTabs !== false && !isFirstActive && !tabs[0].pinned) lazyTabs.push(entry);
      }

      for (let i = 1; i < tabs.length; i++) {
        const t = tabs[i];
        const isTargetActive = (t === wantedActive);
        const created = await createTabSafely({
          windowId: win.id,
          url: sanitizeRestoreUrl(t.url),
          pinned: Boolean(t.pinned),
          index: i,
          active: false
        });
        if (created) {
          const entry = { id: created.id, savedTabId: t.id, savedGroupId: t.groupId, active: isTargetActive };
          createdTabs.push(entry);
          if (state.settings?.lazyRestoreTabs !== false && !isTargetActive && !t.pinned) lazyTabs.push(entry);
        }
      }

      const activeCreated = createdTabs.find((c) => c.active);
      if (activeCreated) {
        await chrome.tabs.update(activeCreated.id, { active: true }).catch(() => {});
      }

      // Groups last: collapsed state can only apply to groups without the active tab
      const groupMap = await groupSync.restoreGroups(win.id, ws.groups || [], createdTabs);

      // Lazy tab restoration: discard background tabs to keep RAM low. Done after grouping
      // because discarding can replace a tab, giving it a new id.
      if (chrome.tabs?.discard) {
        for (const entry of lazyTabs) {
          const replaced = await chrome.tabs.discard(entry.id).catch(() => null);
          if (replaced && typeof replaced.id === 'number') entry.id = replaced.id;
        }
      }

      const tabMap = {};
      for (const c of createdTabs) {
        if (c.savedTabId) tabMap[c.savedTabId] = c.id;
      }
      await windowRegistry.setLiveMaps(workspaceId, { tabs: tabMap, groups: groupMap });
      await workspaceManager.touchLastOpened(workspaceId);
      await windowRegistry.setActiveWorkspaceId(workspaceId);
    } finally {
      await windowRegistry.setSuppressSync(false);
    }

    // 4. Optionally close the window of the workspace we switched away from.
    // Done only after the new window exists, so the browser never runs out of windows.
    if (state.settings?.closeWindowOnWorkspaceSwitch && previousWsId && previousWsId !== workspaceId) {
      await this.closeWorkspace(previousWsId);
    }

    try {
      await tabSync.saveWorkspaceFromWindow(workspaceId);
    } catch {
      // Snapshot is best-effort; events will sync later
    }
    return winId;
  },

  /**
   * Focus a tab of a workspace, opening the workspace if needed
   */
  async openTabInWorkspace(workspaceId, tabId, url) {
    const ctx = await workspaceManager.liveContext(workspaceId);
    if (ctx) {
      await chrome.windows.update(ctx.winId, { focused: true });
      const live = await workspaceManager.resolveLiveTab(ctx, tabId);
      if (live) {
        await chrome.tabs.update(live.id, { active: true });
      } else if (url) {
        await chrome.tabs.create({ windowId: ctx.winId, url: sanitizeRestoreUrl(url), active: true });
      }
      await windowRegistry.setActiveWorkspaceId(workspaceId);
      return ctx.winId;
    }
    return this.openWorkspace(workspaceId, tabId);
  },

  /**
   * Close a workspace's window, saving its latest state first
   */
  async closeWorkspace(workspaceId) {
    const winId = await windowRegistry.getWindowForWorkspace(workspaceId);
    if (winId === null) return false;

    try {
      await tabSync.flush(workspaceId);
      await history.record(workspaceId, 'closed', { force: true });
    } catch {
      // Best effort
    }
    await windowRegistry.unbind(winId);
    try {
      await chrome.windows.remove(winId);
    } catch (err) {
      console.warn(`Could not close window ${winId}`, err);
    }
    return true;
  }
};
