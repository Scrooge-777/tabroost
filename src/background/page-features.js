/**
 * Optional on-page features (workspace pill button + accent border).
 *
 * The page script is registered dynamically, only after the user enables a feature
 * and grants site access, so the extension needs no host permissions by default.
 */

import { PAGE_SCRIPT_ID, MESSAGE_TYPES } from '../shared/constants.js';
import { workspaceManager } from './workspace-manager.js';
import { windowRegistry } from './window-registry.js';

export const PAGE_ORIGINS = ['http://*/*', 'https://*/*'];

async function hasHostAccess() {
  if (!chrome.permissions?.contains) return false;
  return chrome.permissions.contains({ origins: PAGE_ORIGINS });
}

export const pageFeatures = {
  /**
   * Register or unregister the page script to match current settings and permissions
   */
  async sync() {
    if (!chrome.scripting?.getRegisteredContentScripts) return { registered: false };

    const { settings } = await workspaceManager.loadState();
    const wanted = (settings.showPagePill || settings.accentBorder) && (await hasHostAccess());
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [PAGE_SCRIPT_ID] }).catch(() => []);

    if (wanted && existing.length === 0) {
      await chrome.scripting.registerContentScripts([{
        id: PAGE_SCRIPT_ID,
        js: ['src/content/page-indicator.js'],
        matches: PAGE_ORIGINS,
        runAt: 'document_idle',
        allFrames: false,
        persistAcrossSessions: true
      }]);
      await this.injectIntoOpenTabs();
    } else if (!wanted && existing.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [PAGE_SCRIPT_ID] });
    }
    await this.refreshAll();
    return { registered: Boolean(wanted) };
  },

  /**
   * Registered scripts only apply to new navigations; inject into already open tabs
   */
  async injectIntoOpenTabs() {
    const tabs = await chrome.tabs.query({ url: PAGE_ORIGINS }).catch(() => []);
    await Promise.all(tabs.map((tab) =>
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/page-indicator.js'] }).catch(() => {})
    ));
  },

  /**
   * Indicator data for the window a page lives in
   */
  async getIndicator(windowId) {
    const state = await workspaceManager.loadState();
    const wsId = windowId ? await windowRegistry.getWorkspaceForWindow(windowId) : null;
    const ws = wsId ? state.workspaces[wsId] : null;
    return {
      showPill: Boolean(state.settings.showPagePill),
      showBorder: Boolean(state.settings.accentBorder),
      workspace: ws ? { id: ws.id, name: ws.name, color: ws.color, icon: ws.icon } : null
    };
  },

  /**
   * Ask the active tab of every window to refresh its indicator
   */
  async refreshAll() {
    const tabs = await chrome.tabs.query({ active: true, url: PAGE_ORIGINS }).catch(() => []);
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: MESSAGE_TYPES.INDICATOR_REFRESH }).catch(() => {});
    }
  }
};
