/**
 * Automatic local backups of all workspaces (kept in storage.local).
 * Taken on a timer and before destructive operations (import, reset, restore).
 */

import { STORAGE_KEYS, MAX_BACKUPS, BACKUP_ALARM, BACKUP_INTERVAL_MINUTES } from '../shared/constants.js';
import { storage } from '../shared/storage.js';
import { workspaceManager } from './workspace-manager.js';
import { generateId, deepEqual } from '../shared/utils.js';

async function readBackups() {
  const items = await storage.getLocal(STORAGE_KEYS.BACKUPS);
  return Array.isArray(items[STORAGE_KEYS.BACKUPS]) ? items[STORAGE_KEYS.BACKUPS] : [];
}

export const backups = {
  async list() {
    const all = await readBackups();
    return all.map(({ id, createdAt, reason, data }) => ({
      id,
      createdAt,
      reason,
      workspaceCount: Object.keys(data?.workspaces || {}).length,
      tabCount: Object.values(data?.workspaces || {}).reduce((sum, ws) => sum + (ws.tabs?.length || 0), 0)
    }));
  },

  /**
   * Store a backup unless it is identical to the newest one
   */
  async create(reason = 'auto') {
    const state = await workspaceManager.loadState();
    if (Object.keys(state.workspaces).length === 0) return null;

    const data = { workspaces: state.workspaces, workspaceOrder: state.workspaceOrder };
    const all = await readBackups();
    if (all[0] && deepEqual(all[0].data, data)) return all[0].id;

    const entry = { id: generateId('bk'), createdAt: Date.now(), reason, data };
    await storage.setLocal({ [STORAGE_KEYS.BACKUPS]: [entry, ...all].slice(0, MAX_BACKUPS) });
    return entry.id;
  },

  async restore(id) {
    const all = await readBackups();
    const entry = all.find((b) => b.id === id);
    if (!entry) throw new Error('Backup not found');

    await this.create('before-restore');
    await workspaceManager.mutate((state) => {
      state.workspaces = structuredClone(entry.data.workspaces || {});
      state.workspaceOrder = [...(entry.data.workspaceOrder || [])];
      return true;
    });
    return { restored: true, count: Object.keys(entry.data.workspaces || {}).length };
  },

  async ensureAlarm() {
    if (!chrome.alarms) return;
    const existing = await chrome.alarms.get(BACKUP_ALARM);
    if (!existing) {
      await chrome.alarms.create(BACKUP_ALARM, { delayInMinutes: 5, periodInMinutes: BACKUP_INTERVAL_MINUTES });
    }
  },

  registerAlarmHandler() {
    chrome.alarms?.onAlarm.addListener(async (alarm) => {
      if (alarm.name !== BACKUP_ALARM) return;
      const state = await workspaceManager.loadState();
      if (state.settings.autoBackup) await this.create('auto');
    });
  }
};
