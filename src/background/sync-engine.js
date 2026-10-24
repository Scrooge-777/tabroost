/**
 * Cloud Sync Engine for Tabroost
 * End-to-End Encrypted (E2EE) multi-device synchronization using Web Crypto AES-GCM
 * Supported Providers: GitHub Gist (Private) / REST Endpoint
 */

import { workspaceManager } from './workspace-manager.js';
import { encryptPayload, decryptPayload } from '../shared/crypto.js';
import { STORAGE_KEYS, SYNC_ALARM, MESSAGE_TYPES } from '../shared/constants.js';
import { deepEqual } from '../shared/utils.js';

const GIST_FILENAME = 'tabroost-workspaces.enc';
const USER_AGENT = 'Tabroost-Sync-Client';

export class GistAdapter {
  constructor(token, gistId = '') {
    this.token = token;
    this.gistId = gistId;
  }

  getHeaders() {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    };
  }

  async fetchGist() {
    if (!this.gistId) return null;
    const res = await fetch(`https://api.github.com/gists/${this.gistId}`, {
      method: 'GET',
      headers: this.getHeaders()
    });

    if (res.status === 404) {
      throw new Error(`Configured Gist ID ${this.gistId} was not found.`);
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `GitHub API error: HTTP ${res.status}`);
    }

    const json = await res.json();
    const file = json.files && json.files[GIST_FILENAME];
    if (!file || !file.content) return null;

    try {
      return JSON.parse(file.content);
    } catch {
      throw new Error('Remote Gist contains malformed payload');
    }
  }

  async saveGist(encryptedEnvelope) {
    const content = JSON.stringify(encryptedEnvelope, null, 2);

    if (!this.gistId) {
      // Create new secret gist
      const res = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          description: 'Tabroost End-to-End Encrypted Workspaces',
          public: false,
          files: {
            [GIST_FILENAME]: { content }
          }
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Failed to create secret Gist: HTTP ${res.status}`);
      }

      const json = await res.json();
      this.gistId = json.id;
      return json.id;
    }

    // Update existing gist
    const res = await fetch(`https://api.github.com/gists/${this.gistId}`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify({
        files: {
          [GIST_FILENAME]: { content }
        }
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Failed to update Gist: HTTP ${res.status}`);
    }

    return this.gistId;
  }
}

/**
 * Merge two workspace sets using Last-Write-Wins (LWW) with tombstone deletion support
 */
export function mergeWorkspaces(localWorkspaces = {}, remoteWorkspaces = {}) {
  const merged = {};
  const allIds = new Set([...Object.keys(localWorkspaces), ...Object.keys(remoteWorkspaces)]);

  for (const id of allIds) {
    const loc = localWorkspaces[id];
    const rem = remoteWorkspaces[id];

    if (loc && !rem) {
      merged[id] = loc;
    } else if (!loc && rem) {
      // If remote has a tombstone, don't resurrect
      if (!rem.deletedAt) {
        merged[id] = rem;
      }
    } else {
      // Both exist: check tombstone deletions first
      if (loc.deletedAt && !rem.deletedAt) {
        if (loc.deletedAt > (rem.updatedAt || 0)) {
          // Deletion happened after remote update: delete wins
          continue;
        } else {
          merged[id] = rem;
        }
      } else if (!loc.deletedAt && rem.deletedAt) {
        if (rem.deletedAt > (loc.updatedAt || 0)) {
          // Remote deletion wins
          continue;
        } else {
          merged[id] = loc;
        }
      } else if (loc.deletedAt && rem.deletedAt) {
        // Both deleted: omit
        continue;
      } else {
        // Both active: Last-Write-Wins
        const locTime = loc.updatedAt || loc.createdAt || 0;
        const remTime = rem.updatedAt || rem.createdAt || 0;
        merged[id] = locTime >= remTime ? loc : rem;
      }
    }
  }

  return merged;
}

export class SyncEngine {
  constructor() {
    this.inProgress = false;
    this.lastError = null;
  }

  async getStatus() {
    const state = await workspaceManager.loadState();
    const settings = state.settings || {};
    return {
      enabled: Boolean(settings.syncEnabled),
      provider: settings.syncProvider || 'gist',
      hasPassphrase: Boolean(settings.syncPassphrase),
      hasToken: Boolean(settings.syncGistToken),
      gistId: settings.syncGistId || '',
      lastSyncedAt: settings.lastSyncedAt || null,
      inProgress: this.inProgress,
      lastError: this.lastError
    };
  }

  async syncNow() {
    if (this.inProgress) {
      return { status: 'already-in-progress' };
    }

    const state = await workspaceManager.loadState();
    const settings = state.settings || {};

    if (!settings.syncEnabled) {
      return { status: 'disabled' };
    }
    if (!settings.syncPassphrase) {
      throw new Error('Sync passphrase is required');
    }
    if (!settings.syncGistToken) {
      throw new Error('GitHub Personal Access Token is required');
    }

    this.inProgress = true;
    this.lastError = null;

    try {
      const adapter = new GistAdapter(settings.syncGistToken, settings.syncGistId);
      const remoteEnvelope = await adapter.fetchGist();

      let remoteData = null;
      if (remoteEnvelope) {
        remoteData = await decryptPayload(remoteEnvelope, settings.syncPassphrase);
      }

      const localWorkspaces = state.workspaces || {};
      const remoteWorkspaces = remoteData?.workspaces || {};

      // Merge workspaces
      const mergedWorkspaces = mergeWorkspaces(localWorkspaces, remoteWorkspaces);

      // Reconstruct order
      const localOrder = state.workspaceOrder || [];
      const remoteOrder = remoteData?.workspaceOrder || [];
      const orderSet = new Set([...localOrder, ...remoteOrder]);
      const mergedOrder = Array.from(orderSet).filter((id) => Boolean(mergedWorkspaces[id]));

      // Determine if local state changed
      const localChanged = !deepEqual(localWorkspaces, mergedWorkspaces) || !deepEqual(localOrder, mergedOrder);

      if (localChanged) {
        await workspaceManager.saveState({
          ...state,
          workspaces: mergedWorkspaces,
          workspaceOrder: mergedOrder
        });
      }

      // Encrypt and push merged payload to remote
      const payloadToSync = {
        workspaces: mergedWorkspaces,
        workspaceOrder: mergedOrder,
        timestamp: Date.now()
      };

      const encryptedEnvelope = await encryptPayload(payloadToSync, settings.syncPassphrase);
      const savedGistId = await adapter.saveGist(encryptedEnvelope);

      // Update local settings with Gist ID and sync timestamp
      const now = Date.now();
      const updatedSettings = {
        ...settings,
        syncGistId: savedGistId,
        lastSyncedAt: now
      };
      await workspaceManager.saveSettings(updatedSettings);

      // Broadcast update to open UI tabs
      chrome.runtime?.sendMessage?.({
        type: MESSAGE_TYPES.STATE_CHANGED,
        lastSyncedAt: now
      })?.catch?.(() => {});

      return {
        status: 'success',
        gistId: savedGistId,
        lastSyncedAt: now,
        workspaceCount: Object.keys(mergedWorkspaces).length
      };
    } catch (err) {
      this.lastError = err.message || String(err);
      console.error('SyncEngine error:', err);
      throw err;
    } finally {
      this.inProgress = false;
    }
  }

  async ensureAlarm() {
    if (!chrome.alarms) return;
    const state = await workspaceManager.loadState();
    const settings = state.settings || {};

    if (!settings.syncEnabled) {
      await chrome.alarms.clear(SYNC_ALARM).catch(() => {});
      return;
    }

    const interval = Math.max(5, settings.syncIntervalMinutes || 30);
    const existing = await chrome.alarms.get(SYNC_ALARM).catch(() => null);
    if (!existing || existing.periodInMinutes !== interval) {
      await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: interval });
    }
  }

  registerAlarmHandler() {
    if (!chrome.alarms) return;
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === SYNC_ALARM) {
        this.syncNow().catch((err) => console.warn('Background sync alarm error:', err));
      }
    });
  }
}

export const syncEngine = new SyncEngine();
