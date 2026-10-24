/**
 * On-page features (workspace pill button + accent border).
 * The content script is declared statically in manifest.json for permanent operation.
 */

import { PAGE_SCRIPT_ID, MESSAGE_TYPES } from '../shared/constants.js';
import { workspaceManager } from './workspace-manager.js';
import { windowRegistry } from './window-registry.js';

export const PAGE_ORIGINS = ['http://*/*', 'https://*/*'];

export const pageFeatures = {
  /**
   * Sync page features and unregister any legacy dynamic content scripts
   */
  async sync() {
    if (chrome.scripting?.unregisterContentScripts) {
      await chrome.scripting.unregisterContentScripts({ ids: [PAGE_SCRIPT_ID] }).catch(() => {});
    }
    await this.injectIntoOpenTabs().catch(() => {});
    await this.refreshAll();
    return { registered: true };
  },

  /**
   * Inject into already open tabs upon install or reload
   */
  async injectIntoOpenTabs() {
    if (!chrome.tabs?.query || !chrome.scripting?.executeScript) return;
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
      showPill: true,
      pillPosition: state.settings?.pillPosition || 'top-left',
      pillSize: state.settings?.pillSize || 'medium',
      showBorder: Boolean(state.settings?.accentBorder),
      workspace: ws ? { id: ws.id, name: ws.name, color: ws.color, icon: ws.icon } : null
    };
  },

  /**
   * Ask the active tab of every window to refresh its indicator
   */
  async refreshAll() {
    if (!chrome.tabs?.query) return;
    const tabs = await chrome.tabs.query({ active: true, url: PAGE_ORIGINS }).catch(() => []);
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: MESSAGE_TYPES.INDICATOR_REFRESH }).catch(() => {});
    }
  }
};
