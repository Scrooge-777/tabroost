/**
 * Cloud Sync Engine for Tabroost
 * End-to-End Encrypted (E2EE) multi-device synchronization using Web Crypto AES-GCM.
 * Provider: private GitHub Gist.
 */

import { workspaceManager, SKIP_SAVE } from './workspace-manager.js';
import { encryptPayload, decryptPayload } from '../shared/crypto.js';
import {
  STORAGE_KEYS,
  SYNC_ALARM,
  MESSAGE_TYPES,
  SYNC_TOMBSTONE_TTL_MS,
  SYNC_MIN_PASSPHRASE_LENGTH,
  SYNC_PAYLOAD_VERSION
} from '../shared/constants.js';
import { deepEqual } from '../shared/utils.js';
import { storage } from '../shared/storage.js';
import { sanitizeSyncPayload } from '../shared/schema.js';
import { getSyncSecrets } from '../shared/secrets.js';

const GIST_FILENAME = 'tabroost-workspaces.enc';
const REQUEST_TIMEOUT_MS = 20000;
const LOCK_STALE_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 60 * 1000;
const BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;

export class SyncHttpError extends Error {
  constructor(message, { status = 0, retryAfterMs = 0 } = {}) {
    super(message);
    this.name = 'SyncHttpError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function parseRetryAfter(res) {
  const header = res.headers?.get?.('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return seconds * 1000;
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  const reset = Number(res.headers?.get?.('x-ratelimit-reset'));
  if (res.status === 403 && Number.isFinite(reset) && reset > 0) {
    return Math.max(0, reset * 1000 - Date.now());
  }
  return 0;
}

export class GistAdapter {
  constructor(token, gistId = '', fetchImpl = (...args) => globalThis.fetch(...args)) {
    this.token = token;
    this.gistId = gistId;
    this.fetchImpl = fetchImpl;
  }

  getHeaders() {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    };
  }

  async request(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await this.fetchImpl(url, { ...options, headers: this.getHeaders(), signal: controller.signal });
    } catch (err) {
      if (err?.name === 'AbortError') throw new SyncHttpError('GitHub did not respond in time');
      throw new SyncHttpError(`Network error: ${err?.message || err}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const retryAfterMs = parseRetryAfter(res);
      let message = body.message || `GitHub API error: HTTP ${res.status}`;
      if (res.status === 401) message = 'GitHub rejected the token (401). Check or replace it in Settings.';
      if (res.status === 403 || res.status === 429) {
        message = `${message}${retryAfterMs ? ` Retrying in ${Math.ceil(retryAfterMs / 60000)} min.` : ''}`;
      }
      throw new SyncHttpError(message, { status: res.status, retryAfterMs });
    }
    return res;
  }

  /**
   * Returns { envelope, updatedAt } or { envelope: null, updatedAt: null } when nothing is stored yet
   */
  async fetchGist() {
    if (!this.gistId) return { envelope: null, updatedAt: null };
    let res;
    try {
      res = await this.request(`https://api.github.com/gists/${this.gistId}`, { method: 'GET' });
    } catch (err) {
      if (err.status === 404) throw new SyncHttpError(`Configured Gist ID ${this.gistId} was not found.`, { status: 404 });
      throw err;
    }

    const json = await res.json();
    const file = json.files && json.files[GIST_FILENAME];
    if (!file) return { envelope: null, updatedAt: json.updated_at || null };

    let content = file.content;
    if (file.truncated && file.raw_url) {
      const raw = await this.fetchImpl(file.raw_url, { headers: { Authorization: `Bearer ${this.token}` } });
      if (!raw.ok) throw new SyncHttpError(`Could not read the full Gist file: HTTP ${raw.status}`, { status: raw.status });
      content = await raw.text();
    }
    if (!content) return { envelope: null, updatedAt: json.updated_at || null };

    try {
      return { envelope: JSON.parse(content), updatedAt: json.updated_at || null };
    } catch {
      throw new Error('Remote Gist contains malformed payload');
    }
  }

  /**
   * Cheap check used to detect another device writing between our read and write
   */
  async fetchUpdatedAt() {
    if (!this.gistId) return null;
    const res = await this.request(`https://api.github.com/gists/${this.gistId}`, { method: 'GET' });
    const json = await res.json();
    return json.updated_at || null;
  }

  async saveGist(encryptedEnvelope) {
    const content = JSON.stringify(encryptedEnvelope, null, 2);

    if (!this.gistId) {
      const res = await this.request('https://api.github.com/gists', {
        method: 'POST',
        body: JSON.stringify({
          description: 'Tabroost End-to-End Encrypted Workspaces',
          public: false,
          files: { [GIST_FILENAME]: { content } }
        })
      });
      const json = await res.json();
      this.gistId = json.id;
      return json.id;
    }

    await this.request(`https://api.github.com/gists/${this.gistId}`, {
      method: 'PATCH',
      body: JSON.stringify({ files: { [GIST_FILENAME]: { content } } })
    });
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

/**
 * Merge full sync state (workspaces, order, deletion tombstones).
 * A tombstone wins over a workspace unless the workspace was edited after the deletion.
 */
export function mergeState(local = {}, remote = {}, now = Date.now()) {
  const tombstones = {};
  for (const source of [local.tombstones, remote.tombstones]) {
    for (const [id, at] of Object.entries(source || {})) {
      if (at > (tombstones[id] || 0)) tombstones[id] = at;
    }
  }

  const workspaces = mergeWorkspaces(local.workspaces || {}, remote.workspaces || {});
  for (const id of Object.keys(workspaces)) {
    const at = tombstones[id];
    const touched = workspaces[id].updatedAt || workspaces[id].createdAt || 0;
    if (at && at >= touched) delete workspaces[id];
  }
  for (const [id, at] of Object.entries(tombstones)) {
    if (workspaces[id] || now - at > SYNC_TOMBSTONE_TTL_MS) delete tombstones[id];
  }

  const seen = new Set();
  const workspaceOrder = [];
  for (const id of [...(local.workspaceOrder || []), ...(remote.workspaceOrder || [])]) {
    if (workspaces[id] && !seen.has(id)) {
      seen.add(id);
      workspaceOrder.push(id);
    }
  }
  for (const id of Object.keys(workspaces)) {
    if (!seen.has(id)) workspaceOrder.push(id);
  }

  return { workspaces, workspaceOrder, tombstones };
}

export class SyncEngine {
  constructor(fetchImpl) {
    this.fetchImpl = fetchImpl;
    this.lastError = null;
  }

  async getStatus() {
    const state = await workspaceManager.loadState();
    const settings = state.settings || {};
    const secrets = await getSyncSecrets();
    const lock = await this.readLock();
    const backoff = await this.readBackoff();
    return {
      enabled: Boolean(settings.syncEnabled),
      provider: settings.syncProvider || 'gist',
      hasPassphrase: Boolean(secrets.passphrase),
      hasToken: Boolean(secrets.token),
      remember: Boolean(settings.syncRememberSecrets),
      gistId: settings.syncGistId || '',
      lastSyncedAt: settings.lastSyncedAt || null,
      inProgress: Boolean(lock),
      retryAt: backoff.until > Date.now() ? backoff.until : null,
      lastError: this.lastError
    };
  }

  // The lock lives in session storage so it survives the MV3 worker being suspended
  async readLock() {
    const items = await storage.getSession(STORAGE_KEYS.SYNC_LOCK);
    const at = items[STORAGE_KEYS.SYNC_LOCK];
    return typeof at === 'number' && Date.now() - at < LOCK_STALE_MS ? at : null;
  }

  async readBackoff() {
    const items = await storage.getSession(STORAGE_KEYS.SYNC_BACKOFF);
    const value = items[STORAGE_KEYS.SYNC_BACKOFF];
    return { until: Number(value?.until) || 0, count: Number(value?.count) || 0 };
  }

  async recordFailure(err) {
    const { count } = await this.readBackoff();
    const next = count + 1;
    let delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(next - 1, 10));
    if (err?.retryAfterMs) delay = Math.min(BACKOFF_MAX_MS, Math.max(delay, err.retryAfterMs));
    await storage.setSession({ [STORAGE_KEYS.SYNC_BACKOFF]: { until: Date.now() + delay, count: next } });
  }

  async syncNow({ background = false } = {}) {
    if (await this.readLock()) {
      return { status: 'already-in-progress' };
    }

    const state = await workspaceManager.loadState();
    const settings = state.settings || {};

    if (!settings.syncEnabled) {
      return { status: 'disabled' };
    }

    if (background) {
      const { until } = await this.readBackoff();
      if (until > Date.now()) return { status: 'backing-off', retryAt: until };
    }

    const { token, passphrase } = await getSyncSecrets();
    if (!passphrase) {
      throw new Error('Sync is locked: enter your passphrase in Settings.');
    }
    if (passphrase.length < SYNC_MIN_PASSPHRASE_LENGTH) {
      throw new Error(`Sync passphrase must be at least ${SYNC_MIN_PASSPHRASE_LENGTH} characters`);
    }
    if (!token) {
      throw new Error('GitHub Personal Access Token is required');
    }

    await storage.setSession({ [STORAGE_KEYS.SYNC_LOCK]: Date.now() });
    this.lastError = null;

    try {
      const adapter = new GistAdapter(token, settings.syncGistId, this.fetchImpl);
      let result = null;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !result; attempt++) {
        const { envelope, updatedAt } = await adapter.fetchGist();

        let remoteData = { workspaces: {}, workspaceOrder: [], tombstones: {} };
        if (envelope) {
          remoteData = sanitizeSyncPayload(await decryptPayload(envelope, passphrase));
        }

        // Merge inside the storage lock so edits made during the request are not lost
        let merged = null;
        await workspaceManager.mutate((current) => {
          merged = mergeState(current, remoteData);
          const changed =
            !deepEqual(current.workspaces, merged.workspaces) ||
            !deepEqual(current.workspaceOrder, merged.workspaceOrder) ||
            !deepEqual(current.tombstones, merged.tombstones);
          if (!changed) return SKIP_SAVE;
          current.workspaces = merged.workspaces;
          current.workspaceOrder = merged.workspaceOrder;
          current.tombstones = merged.tombstones;
          return true;
        });

        // Another device wrote since we read: merge again instead of overwriting it
        if (adapter.gistId && attempt < MAX_ATTEMPTS) {
          const latest = await adapter.fetchUpdatedAt();
          if (latest !== updatedAt) continue;
        }

        const payload = {
          schemaVersion: SYNC_PAYLOAD_VERSION,
          workspaces: merged.workspaces,
          workspaceOrder: merged.workspaceOrder,
          tombstones: merged.tombstones,
          timestamp: Date.now()
        };
        const savedGistId = await adapter.saveGist(await encryptPayload(payload, passphrase));
        result = { gistId: savedGistId, workspaceCount: Object.keys(merged.workspaces).length };
      }

      if (!result) throw new Error('Sync kept conflicting with another device. Try again in a moment.');

      const now = Date.now();
      await workspaceManager.updateSettings({ syncGistId: result.gistId, lastSyncedAt: now });
      await storage.removeSession(STORAGE_KEYS.SYNC_BACKOFF);

      chrome.runtime?.sendMessage?.({
        type: MESSAGE_TYPES.STATE_CHANGED,
        lastSyncedAt: now
      })?.catch?.(() => {});

      return {
        status: 'success',
        gistId: result.gistId,
        lastSyncedAt: now,
        workspaceCount: result.workspaceCount
      };
    } catch (err) {
      this.lastError = err.message || String(err);
      console.error('SyncEngine error:', err);
      if (background || err instanceof SyncHttpError) await this.recordFailure(err).catch(() => {});
      throw err;
    } finally {
      await storage.removeSession(STORAGE_KEYS.SYNC_LOCK).catch(() => {});
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
        this.syncNow({ background: true }).catch((err) => console.warn('Background sync alarm error:', err));
      }
    });
  }
}

export const syncEngine = new SyncEngine();
