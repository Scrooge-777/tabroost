/**
 * Group Sync — Handles chrome.tabGroups mapping, serialization, and deserialization
 * Native group IDs are per-window integers; we map them to persistent string IDs.
 */

import { generateId } from '../shared/utils.js';

export const groupSync = {
  /**
   * Serialize native tab groups for a window
   */
  async serializeWindowGroups(windowId) {
    if (!chrome.tabGroups) return { groups: [], nativeToPersistentMap: new Map() };

    try {
      const nativeGroups = await chrome.tabGroups.query({ windowId });
      const nativeToPersistentMap = new Map();
      const groups = [];

      for (const ng of nativeGroups) {
        const persistentId = generateId('g');
        nativeToPersistentMap.set(ng.id, persistentId);
        groups.push({
          id: persistentId,
          title: ng.title || '',
          color: ng.color || 'grey',
          collapsed: false
        });
      }

      return { groups, nativeToPersistentMap };
    } catch (err) {
      console.warn('groupSync: serializeWindowGroups failed', err);
      return { groups: [], nativeToPersistentMap: new Map() };
    }
  },

  /**
   * Restore tab groups in a window using saved group definitions and created tabs
   * @param {number} windowId - The target window ID
   * @param {Array} savedGroups - List of saved group objects { id, title, color, collapsed }
   * @param {Array} createdTabs - List of newly created tab objects with { id, groupId }
   */
  async restoreGroups(windowId, savedGroups = [], createdTabs = []) {
    if (!chrome.tabGroups || !savedGroups.length || !createdTabs.length) return;

    // Group created tab IDs by persistent groupId
    const tabsByGroupId = new Map();
    for (const tab of createdTabs) {
      if (tab.savedGroupId) {
        if (!tabsByGroupId.has(tab.savedGroupId)) {
          tabsByGroupId.set(tab.savedGroupId, []);
        }
        tabsByGroupId.get(tab.savedGroupId).push(tab.id);
      }
    }

    // For each saved group that has tabs, recreate it natively
    for (const group of savedGroups) {
      const tabIds = tabsByGroupId.get(group.id);
      if (tabIds && tabIds.length > 0) {
        try {
          const newNativeGroupId = await chrome.tabs.group({
            tabIds,
            createProperties: { windowId }
          });

          await chrome.tabGroups.update(newNativeGroupId, {
            title: group.title || '',
            color: group.color || 'grey',
            collapsed: false
          });
        } catch (err) {
          console.warn(`groupSync: Failed to restore group "${group.title}"`, err);
        }
      }
    }
  }
};
