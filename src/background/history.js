/**
 * Workspace history — timestamped versions of each workspace's tabs and groups.
 * Versions are taken automatically (at most one per interval while a workspace changes,
 * and when its window closes), manually, and before a restore. Kept in storage.local
 * under its own key; they are not synced or exported.
 */

import { STORAGE_KEYS } from '../shared/constants.js';
import { storage } from '../shared/storage.js';
import { sanitizeGroup, sanitizeTab } from '../shared/schema.js';
import { generateId, createLock } from '../shared/utils.js';
import { workspaceManager } from './workspace-manager.js';

export const MAX_VERSIONS_PER_WORKSPACE = 20;
export const AUTO_INTERVAL_MS = 10 * 60 * 1000;

const withLock = createLock();

async function readAll() {
  const items = await storage.getLocal(STORAGE_KEYS.HISTORY);
  const value = items[STORAGE_KEYS.HISTORY];
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** What makes two versions "the same": tab urls, pinning, grouping and group names */
function signature(tabs, groups) {
  return JSON.stringify([
    tabs.map((t) => [t.url, Boolean(t.pinned), t.groupId || null]),
    groups.map((g) => [g.id, g.title, g.color])
  ]);
}

function summarize(version, older) {
  const urls = new Set(version.tabs.map((t) => t.url));
  const olderUrls = new Set((older?.tabs || []).map((t) => t.url));
  return {
    id: version.id,
    at: version.at,
    reason: version.reason,
    tabCount: version.tabs.length,
    groupCount: version.groups.length,
    added: older ? [...urls].filter((u) => !olderUrls.has(u)).length : 0,
    removed: older ? [...olderUrls].filter((u) => !urls.has(u)).length : 0,
    first: !older
  };
}

export const history = {
  /**
   * Store a version of the workspace unless it matches the newest one. Automatic
   * versions are rate limited; pass force for manual and structural events.
   */
  async record(workspaceId, reason = 'auto', { force = false } = {}) {
    return withLock(async () => {
      const state = await workspaceManager.loadState();
      const ws = state.workspaces[workspaceId];
      if (!ws) return null;

      const all = await readAll();
      const versions = all[workspaceId] || [];
      const newest = versions[0];
      const sig = signature(ws.tabs, ws.groups);
      if (newest && newest.sig === sig) return null;
      if (!force && newest && Date.now() - newest.at < AUTO_INTERVAL_MS) return null;

      const version = {
        id: generateId('v'),
        at: Date.now(),
        reason,
        sig,
        tabs: ws.tabs.map(({ id, url, title, pinned, index, groupId, active }) => ({ id, url, title, pinned, index, groupId, active })),
        groups: ws.groups.map((g) => ({ ...g }))
      };
      all[workspaceId] = [version, ...versions].slice(0, MAX_VERSIONS_PER_WORKSPACE);

      // Drop history of workspaces that are gone for good (deleted workspaces keep theirs for undo)
      for (const id of Object.keys(all)) {
        if (!state.workspaces[id] && !state.tombstones[id]) delete all[id];
      }
      await storage.setLocal({ [STORAGE_KEYS.HISTORY]: all });
      return version.id;
    });
  },

  async list(workspaceId) {
    const all = await readAll();
    const versions = all[workspaceId] || [];
    return versions.map((v, i) => summarize(v, versions[i + 1]));
  },

  /**
   * Put a version back. The current state is saved as a version first, so a restore can be undone.
   * Returns the ids it needs the caller to reopen if the workspace window was open.
   */
  async restore(workspaceId, versionId) {
    const all = await readAll();
    const version = (all[workspaceId] || []).find((v) => v.id === versionId);
    if (!version) throw new Error('That version no longer exists');

    await this.record(workspaceId, 'before-restore', { force: true });

    const groups = version.groups.map(sanitizeGroup);
    const groupIds = new Set(groups.map((g) => g.id));
    const tabs = version.tabs.map((t, i) => sanitizeTab(t, i, groupIds));
    if (tabs.length === 0) throw new Error('That version has no tabs');

    await workspaceManager.mutate((state) => {
      const ws = state.workspaces[workspaceId];
      if (!ws) throw new Error('Workspace not found');
      ws.tabs = tabs;
      ws.groups = groups;
      ws.updatedAt = Date.now();
      return true;
    });
    return { restored: true, tabCount: tabs.length };
  }
};
