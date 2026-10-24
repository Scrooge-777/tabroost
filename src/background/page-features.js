/**
 * On-page features (workspace pill button + accent border).
 * Opt-in: site access is an optional permission, and the content script is only
 * registered while a feature is on and the permission is granted.
 */

import { PAGE_SCRIPT_ID, MESSAGE_TYPES } from '../shared/constants.js';
import { workspaceManager } from './workspace-manager.js';
import { windowRegistry } from './window-registry.js';

export const PAGE_ORIGINS = ['http://*/*', 'https://*/*'];

/** "a.com, b.org" or one per line -> ['a.com', 'b.org'] (lowercase, no scheme or path) */
export function parseHiddenSites(raw = '') {
  return String(raw)
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0])
    .filter(Boolean);
}

export const pageFeatures = {
  async hasSiteAccess() {
    if (!chrome.permissions?.contains) return false;
    return chrome.permissions.contains({ origins: PAGE_ORIGINS }).catch(() => false);
  },

  /**
   * Register or remove the content script to match settings and granted permission
   */
  async sync() {
    const { settings } = await workspaceManager.loadState();
    const wanted = Boolean(settings.showPagePill || settings.accentBorder) && (await this.hasSiteAccess());

    if (chrome.scripting?.unregisterContentScripts) {
      await chrome.scripting.unregisterContentScripts({ ids: [PAGE_SCRIPT_ID] }).catch(() => {});
    }
    if (wanted && chrome.scripting?.registerContentScripts) {
      await chrome.scripting.registerContentScripts([{
        id: PAGE_SCRIPT_ID,
        matches: PAGE_ORIGINS,
        js: ['src/content/page-indicator.js'],
        runAt: 'document_idle',
        allFrames: false,
        persistAcrossSessions: true
      }]).catch((err) => console.warn('pageFeatures: could not register content script', err));
      await this.injectIntoOpenTabs().catch(() => {});
    }
    await this.refreshAll();
    return { registered: wanted };
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
      showPill: Boolean(state.settings?.showPagePill),
      pillPosition: state.settings?.pillPosition || 'top-left',
      pillSize: state.settings?.pillSize || 'medium',
      pillStyle: state.settings?.pillStyle === 'dot' ? 'dot' : 'handle',
      openOnHover: Boolean(state.settings?.pillOpenOnHover),
      offsetY: state.settings?.pillOffsetY ?? null,
      hiddenSites: parseHiddenSites(state.settings?.pillHiddenSites),
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
