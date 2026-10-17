/**
 * Group Sync — Handles chrome.tabGroups mapping, serialization, and deserialization
 * Native group IDs are per-window integers; we map them to persistent string IDs.
 */

export const TAB_GROUP_ID_NONE = -1;

export function isNativeGrouped(tab) {
  return typeof tab?.groupId === 'number' && tab.groupId !== TAB_GROUP_ID_NONE;
}

export const groupSync = {
  /**
   * Restore tab groups in a window using saved group definitions and created tabs
   * @param {number} windowId - The target window ID
   * @param {Array} savedGroups - List of saved group objects { id, title, color, collapsed }
   * @param {Array} createdTabs - List of { id, savedGroupId, active }
   * @returns {Object} map of persistent group ID -> native group ID
   */
  async restoreGroups(windowId, savedGroups = [], createdTabs = []) {
    const groupMap = {};
    if (!chrome.tabGroups || !savedGroups.length || !createdTabs.length) return groupMap;

    const tabsByGroupId = new Map();
    for (const tab of createdTabs) {
      if (tab.savedGroupId) {
        if (!tabsByGroupId.has(tab.savedGroupId)) {
          tabsByGroupId.set(tab.savedGroupId, []);
        }
        tabsByGroupId.get(tab.savedGroupId).push(tab);
      }
    }

    for (const group of savedGroups) {
      const members = tabsByGroupId.get(group.id);
      if (!members || members.length === 0) continue;
      try {
        const nativeGroupId = await chrome.tabs.group({
          tabIds: members.map((t) => t.id),
          createProperties: { windowId }
        });
        groupMap[group.id] = nativeGroupId;

        // A group holding the active tab cannot be collapsed
        const holdsActiveTab = members.some((t) => t.active);
        await chrome.tabGroups.update(nativeGroupId, {
          title: group.title || '',
          color: group.color || 'grey',
          collapsed: Boolean(group.collapsed) && !holdsActiveTab
        });
      } catch (err) {
        console.warn(`groupSync: Failed to restore group "${group.title}"`, err);
      }
    }
    return groupMap;
  }
};
