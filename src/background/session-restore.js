/**
 * Session restore — remembers which workspaces had a window open and, after the browser
 * restarts, offers to reopen the ones that did not come back on their own.
 *
 * The open set is saved a moment after window bindings change. When the browser quits the
 * worker dies before that timer fires, so the set still describes the last live session.
 */

import { STORAGE_KEYS } from '../shared/constants.js';
import { storage } from '../shared/storage.js';
import { workspaceManager } from './workspace-manager.js';
import { windowRegistry } from './window-registry.js';
import { windowOpener } from './window-opener.js';

export const REMEMBER_DELAY_MS = 2500;

let rememberTimer = null;

async function boundWorkspaceIds() {
  const bindings = await windowRegistry.getAllBindings();
  return [...new Set(Object.values(bindings))];
}

export const sessionRestore = {
  async remember() {
    const ids = await boundWorkspaceIds();
    await storage.setLocal({ [STORAGE_KEYS.LAST_SESSION]: { ids, at: Date.now() } });
  },

  rememberSoon() {
    clearTimeout(rememberTimer);
    rememberTimer = setTimeout(() => {
      rememberTimer = null;
      this.remember().catch((err) => console.warn('sessionRestore: remember failed', err));
    }, REMEMBER_DELAY_MS);
  },

  /**
   * Run once per browser start, after startup recovery: workspaces that were open last
   * time and have no window now become the pending offer.
   */
  async prepareOnStartup() {
    const items = await storage.getLocal(STORAGE_KEYS.LAST_SESSION);
    const last = items[STORAGE_KEYS.LAST_SESSION];
    const bound = new Set(await boundWorkspaceIds());
    const state = await workspaceManager.loadState();
    const ids = (last?.ids || []).filter((id) => state.workspaces[id] && !bound.has(id));
    await storage.setSession({ [STORAGE_KEYS.PENDING_RESTORE]: ids });
    await this.remember();
    return ids;
  },

  /** Pending ids that still exist and are not open now */
  async getPending() {
    const items = await storage.getSession(STORAGE_KEYS.PENDING_RESTORE);
    const ids = items[STORAGE_KEYS.PENDING_RESTORE];
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const bound = new Set(await boundWorkspaceIds());
    const state = await workspaceManager.loadState();
    return ids.filter((id) => state.workspaces[id] && !bound.has(id));
  },

  async dismiss() {
    await storage.setSession({ [STORAGE_KEYS.PENDING_RESTORE]: [] });
  },

  /** Reopen every pending workspace, one window each. Returns how many opened. */
  async restoreAll() {
    const ids = await this.getPending();
    await this.dismiss();
    let opened = 0;
    for (const id of ids) {
      try {
        await windowOpener.openWorkspace(id);
        opened++;
      } catch (err) {
        console.warn(`sessionRestore: could not reopen ${id}`, err);
      }
    }
    return { opened, requested: ids.length };
  }
};
