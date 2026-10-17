/**
 * Window Opener — Opens, focuses, restores tabs & tab groups, and closes workspace windows
 */

import { windowRegistry } from './window-registry.js';
import { workspaceManager } from './workspace-manager.js';
import { groupSync } from './group-sync.js';
import { tabSync } from './tab-sync.js';
import { sanitizeRestoreUrl, isRestrictedUrl } from '../shared/utils.js';
import { getColor } from '../shared/colors.js';

export const windowOpener = {
  /**
   * Open or focus a workspace in a window
   */
  async openWorkspace(workspaceId, targetTabIdentifier = null) {
    if (!workspaceId) return null;

    // 1. Check if workspace is already open in a window
    const existingWinId = await windowRegistry.getWindowForWorkspace(workspaceId);
    if (existingWinId !== null) {
      try {
        await chrome.windows.update(existingWinId, { focused: true });
        await windowRegistry.setActiveWorkspaceId(workspaceId);
        await this.updateToolbarBadge(existingWinId, workspaceId);

        if (targetTabIdentifier) {
          const tabs = await chrome.tabs.query({ windowId: existingWinId });
          const target = tabs.find(
            (t) => t.id === targetTabIdentifier || String(t.id) === String(targetTabIdentifier)
          );
          if (target) {
            await chrome.tabs.update(target.id, { active: true });
          }
        }
        return existingWinId;
      } catch (err) {
        console.warn(`Window ${existingWinId} was closed externally, reopening`, err);
        await windowRegistry.unbind(existingWinId);
      }
    }

    // 2. Load workspace data
    const ws = await workspaceManager.getWorkspace(workspaceId);
    if (!ws) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }

    // Check settings for auto-closing previous workspace window
    const state = await workspaceManager.getState();
    if (state.settings?.closeWindowOnWorkspaceSwitch) {
      const activeWsId = await windowRegistry.getActiveWorkspaceId();
      if (activeWsId && activeWsId !== workspaceId) {
        const activeWinId = await windowRegistry.getWindowForWorkspace(activeWsId);
        if (activeWinId) {
          try {
            await chrome.windows.remove(activeWinId);
          } catch {
            // Ignore error if window already closing
          }
        }
      }
    }

    // 3. Suppress sync during restore to avoid thrashing
    await windowRegistry.setSuppressSync(true);

    try {
      const tabs = (ws.tabs && ws.tabs.length > 0) ? ws.tabs : [{
        url: 'chrome://newtab/',
        pinned: false,
        active: true
      }];

      const firstTab = tabs[0];
      const initialUrl = isRestrictedUrl(firstTab.url)
        ? sanitizeRestoreUrl(firstTab.url)
        : firstTab.url;

      // 4. Create the new browser window with the first tab
      const win = await chrome.windows.create({
        url: initialUrl,
        focused: true
      });

      // 5. Bind window immediately
      await windowRegistry.bind(win.id, workspaceId);

      const createdTabs = [];
      const winTabs = await chrome.tabs.query({ windowId: win.id });
      if (winTabs.length > 0) {
        const firstCreatedTab = winTabs[0];
        if (firstTab.pinned) {
          try {
            await chrome.tabs.update(firstCreatedTab.id, { pinned: true });
          } catch {
            // Non-critical
          }
        }
        createdTabs.push({
          id: firstCreatedTab.id,
          savedTabId: firstTab.id,
          savedGroupId: firstTab.groupId
        });
      }

      // 6. Create remaining tabs
      let activeTabIdToSet = (firstTab.active && createdTabs[0]) ? createdTabs[0].id : null;

      for (let i = 1; i < tabs.length; i++) {
        const t = tabs[i];
        let tabUrl = t.url;
        if (isRestrictedUrl(tabUrl)) {
          tabUrl = sanitizeRestoreUrl(tabUrl);
        }

        try {
          const created = await chrome.tabs.create({
            windowId: win.id,
            url: tabUrl,
            pinned: Boolean(t.pinned),
            index: i,
            active: false
          });

          createdTabs.push({
            id: created.id,
            savedTabId: t.id,
            savedGroupId: t.groupId
          });

          if (t.active) {
            activeTabIdToSet = created.id;
          }
        } catch (tabErr) {
          console.warn(`Failed to create tab with url: ${tabUrl}, falling back to newtab`, tabErr);
          try {
            const fallbackTab = await chrome.tabs.create({
              windowId: win.id,
              url: 'chrome://newtab/',
              pinned: Boolean(t.pinned),
              index: i,
              active: false
            });
            createdTabs.push({
              id: fallbackTab.id,
              savedTabId: t.id,
              savedGroupId: t.groupId
            });
          } catch {
            // Ignore fallback tab failure
          }
        }
      }

      // 7. Rebuild tab groups
      if (ws.groups && ws.groups.length > 0) {
        await groupSync.restoreGroups(win.id, ws.groups, createdTabs);
      }

      // 8. Activate the designated active tab (or targeted tab)
      if (targetTabIdentifier) {
        const matchedTab = createdTabs.find(
          (ct) => ct.savedTabId === targetTabIdentifier || ct.id === targetTabIdentifier
        );
        if (matchedTab) {
          activeTabIdToSet = matchedTab.id;
        }
      }

      if (activeTabIdToSet) {
        try {
          await chrome.tabs.update(activeTabIdToSet, { active: true });
        } catch {
          // Ignore
        }
      }

      // 9. Touch lastOpenedAt and update active workspace
      ws.lastOpenedAt = Date.now();
      await workspaceManager.saveWorkspaces(state.workspaces);
      await windowRegistry.setActiveWorkspaceId(workspaceId);

      // 10. Update badge on toolbar
      await this.updateToolbarBadge(win.id, workspaceId);

      return win.id;
    } finally {
      // Allow tab syncing again
      await windowRegistry.setSuppressSync(false);
      try {
        await tabSync.saveWorkspaceFromWindow(workspaceId);
      } catch {
        // Ignore snapshot error
      }
    }
  },

  /**
   * Close a workspace's window
   */
  async closeWorkspace(workspaceId) {
    const winId = await windowRegistry.getWindowForWorkspace(workspaceId);
    if (winId !== null) {
      try {
        await chrome.windows.remove(winId);
      } catch (err) {
        console.warn(`Could not close window ${winId}`, err);
      }
      await windowRegistry.unbind(winId);
    }
  },

  /**
   * Update action badge for window's workspace color/initial
   */
  async updateToolbarBadge(windowId, workspaceId) {
    if (!chrome.action) return;

    if (!workspaceId) {
      await chrome.action.setBadgeText({ text: '', windowId }).catch(() => {});
      return;
    }

    const ws = await workspaceManager.getWorkspace(workspaceId);
    if (!ws) {
      await chrome.action.setBadgeText({ text: '', windowId }).catch(() => {});
      return;
    }

    const colorDef = getColor(ws.color);
    try {
      await chrome.action.setBadgeText({ text: '●', windowId });
      await chrome.action.setBadgeBackgroundColor({ color: colorDef.hex, windowId });
    } catch {
      // Some versions of Chromium don't accept windowId on badge, fallback to global
      try {
        await chrome.action.setBadgeText({ text: '●' });
        await chrome.action.setBadgeBackgroundColor({ color: colorDef.hex });
      } catch {
        // Ignore
      }
    }
  }
};
