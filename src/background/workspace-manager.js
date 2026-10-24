/**
 * Workspace Manager — handles CRUD, persistence, duplication and window adoption.
 * Tab / tab-group operations live in workspace-tab-ops.js and are mixed in below.
 *
 * Every write goes through mutate(), which serializes read-modify-write cycles so
 * concurrent saves (tab sync + UI actions) can never clobber each other.
 */

import { STORAGE_KEYS, SYNC_TOMBSTONE_TTL_MS } from '../shared/constants.js';
import { storage } from '../shared/storage.js';
import {
  createWorkspaceModel,
  migrateStorageData,
  sanitizeName,
  sanitizeIcon,
  sanitizeWorkspace,
  newTabEntry
} from '../shared/schema.js';
import { isValidColor, nextUnusedColor } from '../shared/colors.js';
import { windowRegistry } from './window-registry.js';
import { generateId, createLock } from '../shared/utils.js';

import { SKIP_SAVE } from './skip-save.js';
import { snapshotWindow } from './snapshot.js';
import { tabOperations } from './workspace-tab-ops.js';

const withLock = createLock();

export { SKIP_SAVE };
export { snapshotWindow } from './snapshot.js';
export { categorizeUrl } from './workspace-tab-ops.js';

export const workspaceManager = {
  SKIP_SAVE,

  /**
   * Load persisted state (workspaces, order, settings) without session info
   */
  async loadState() {
    const raw = await storage.getLocal([
      STORAGE_KEYS.WORKSPACES,
      STORAGE_KEYS.WORKSPACE_ORDER,
      STORAGE_KEYS.SETTINGS,
      STORAGE_KEYS.SCHEMA_VERSION,
      STORAGE_KEYS.TOMBSTONES
    ]);
    return migrateStorageData(raw);
  },

  /**
   * Load full workspaces state from storage, including window bindings
   */
  async getState() {
    const state = await this.loadState();
    const [bindings, activeWorkspaceId, previousWorkspaceId] = await Promise.all([
      windowRegistry.getAllBindings(),
      windowRegistry.getActiveWorkspaceId(),
      windowRegistry.getPreviousWorkspaceId()
    ]);

    return {
      ...state,
      bindings,
      activeWorkspaceId,
      previousWorkspaceId
    };
  },

  /**
   * Get single workspace by ID
   */
  async getWorkspace(id) {
    const state = await this.loadState();
    return state.workspaces[id] || null;
  },

  /**
   * Atomically read, modify and persist state. Return SKIP_SAVE from fn to avoid a write.
   */
  async mutate(fn) {
    return withLock(async () => {
      const state = await this.loadState();
      const result = await fn(state);
      if (result === SKIP_SAVE) return undefined;
      await storage.setLocal({
        [STORAGE_KEYS.SCHEMA_VERSION]: state.schemaVersion,
        [STORAGE_KEYS.WORKSPACES]: state.workspaces,
        [STORAGE_KEYS.WORKSPACE_ORDER]: state.workspaceOrder,
        [STORAGE_KEYS.TOMBSTONES]: state.tombstones
      });
      return result;
    });
  },

  /**
   * Replace the workspaces dictionary (and optionally order) wholesale
   */
  async saveWorkspaces(workspaces, workspaceOrder = null) {
    return withLock(async () => {
      const update = { [STORAGE_KEYS.WORKSPACES]: workspaces };
      if (workspaceOrder) update[STORAGE_KEYS.WORKSPACE_ORDER] = workspaceOrder;
      await storage.setLocal(update);
    });
  },

  async updateSettings(partial = {}) {
    return withLock(async () => {
      const state = await this.loadState();
      const merged = migrateStorageData({ settings: { ...state.settings, ...partial } }).settings;
      await storage.setLocal({ [STORAGE_KEYS.SETTINGS]: merged });
      return merged;
    });
  },

  /**
   * Create a new workspace
   */
  async createWorkspace({ name, color, icon, tabs = [], groups = [], window: windowInfo = null } = {}) {
    return this.mutate((state) => {
      const chosenColor = isValidColor(color)
        ? color
        : nextUnusedColor(Object.values(state.workspaces).map((w) => w.color), state.workspaceOrder.length);
      const newWs = createWorkspaceModel({ name, color: chosenColor, icon, tabs, groups, window: windowInfo });
      state.workspaces[newWs.id] = newWs;
      state.workspaceOrder.push(newWs.id);
      return newWs;
    });
  },

  /**
   * Create a workspace from an existing browser window and bind it
   */
  async createFromCurrentWindow(windowId, name, color, icon = '') {
    const snap = await snapshotWindow(windowId);
    const ws = await this.createWorkspace({
      name: name || 'Window Workspace',
      color,
      icon,
      tabs: snap.tabs,
      groups: snap.groups,
      window: snap.window
    });

    await windowRegistry.bind(windowId, ws.id);
    await windowRegistry.setLiveMaps(ws.id, snap.liveMaps);
    return ws;
  },

  /**
   * Update name / color / icon in one go
   */
  async updateWorkspace(id, { name, color, icon } = {}) {
    return this.mutate((state) => {
      const ws = state.workspaces[id];
      if (!ws) throw new Error(`Workspace ${id} not found`);
      if (name !== undefined) ws.name = sanitizeName(name);
      if (color !== undefined && isValidColor(color)) ws.color = color;
      if (icon !== undefined) ws.icon = sanitizeIcon(icon);
      ws.updatedAt = Date.now();
      return ws;
    });
  },

  async renameWorkspace(id, newName) {
    return this.updateWorkspace(id, { name: newName });
  },

  async recolorWorkspace(id, newColor) {
    if (!isValidColor(newColor)) throw new Error(`Invalid color: ${newColor}`);
    return this.updateWorkspace(id, { color: newColor });
  },

  /**
   * Delete workspace. Its window (if open) stays open, unmanaged.
   * Returns the removed workspace and its position so the UI can offer undo.
   */
  async deleteWorkspace(id) {
    const removed = await this.mutate((state) => {
      const ws = state.workspaces[id];
      if (!ws) return SKIP_SAVE;
      const index = state.workspaceOrder.indexOf(id);
      delete state.workspaces[id];
      state.workspaceOrder = state.workspaceOrder.filter((wId) => wId !== id);
      // Remember the deletion so cloud sync does not bring the workspace back
      const now = Date.now();
      state.tombstones[id] = now;
      for (const [tid, at] of Object.entries(state.tombstones)) {
        if (now - at > SYNC_TOMBSTONE_TTL_MS) delete state.tombstones[tid];
      }
      return { workspace: ws, index };
    });

    if (!removed) return null;
    await windowRegistry.unbindWorkspace(id);
    return removed;
  },

  /**
   * Put a deleted workspace back (undo)
   */
  async restoreWorkspace(workspace, index = -1) {
    if (!workspace || !workspace.id) throw new Error('Nothing to restore');
    return this.mutate((state) => {
      const clean = sanitizeWorkspace(workspace, workspace.id);
      if (state.workspaces[clean.id]) clean.id = generateId('ws');
      delete state.tombstones[clean.id];
      clean.updatedAt = Date.now();
      state.workspaces[clean.id] = clean;
      const pos = index >= 0 && index <= state.workspaceOrder.length ? index : state.workspaceOrder.length;
      state.workspaceOrder.splice(pos, 0, clean.id);
      return clean;
    });
  },

  /**
   * Duplicate workspace
   */
  async duplicateWorkspace(id) {
    return this.mutate((state) => {
      const source = state.workspaces[id];
      if (!source) throw new Error(`Workspace ${id} not found`);

      const groupIdMap = new Map();
      const newGroups = (source.groups || []).map((g) => {
        const newGid = generateId('g');
        groupIdMap.set(g.id, newGid);
        return { ...g, id: newGid };
      });

      const newTabs = (source.tabs || []).map((t) => ({
        ...t,
        id: generateId('t'),
        groupId: t.groupId ? groupIdMap.get(t.groupId) || null : null
      }));

      const copy = createWorkspaceModel({
        name: `${source.name} (Copy)`,
        color: source.color,
        icon: source.icon,
        tabs: newTabs,
        groups: newGroups,
        window: source.window
      });

      state.workspaces[copy.id] = copy;
      const idx = state.workspaceOrder.indexOf(id);
      if (idx !== -1) state.workspaceOrder.splice(idx + 1, 0, copy.id);
      else state.workspaceOrder.push(copy.id);
      return copy;
    });
  },

  /**
   * Reorder workspaces
   */
  async reorderWorkspaces(newOrder = []) {
    return this.mutate((state) => {
      const validIds = [...new Set(newOrder)].filter((id) => Boolean(state.workspaces[id]));
      for (const id of state.workspaceOrder) {
        if (!validIds.includes(id)) validIds.push(id);
      }
      state.workspaceOrder = validIds;
      return validIds;
    });
  },

  /**
   * Adopt a window into an existing workspace (replacing its saved tabs)
   */
  async adoptWindow(windowId, workspaceId) {
    const existing = await this.getWorkspace(workspaceId);
    if (!existing) throw new Error(`Workspace ${workspaceId} not found`);

    const snap = await snapshotWindow(windowId, existing);
    const ws = await this.mutate((state) => {
      const target = state.workspaces[workspaceId];
      if (!target) throw new Error(`Workspace ${workspaceId} not found`);
      target.tabs = snap.tabs.length ? snap.tabs : [newTabEntry(0)];
      target.groups = snap.groups;
      target.window = snap.window;
      target.updatedAt = Date.now();
      target.lastOpenedAt = Date.now();
      return target;
    });

    await windowRegistry.bind(windowId, workspaceId);
    await windowRegistry.setLiveMaps(workspaceId, snap.liveMaps);
    return ws;
  },

  async touchLastOpened(workspaceId) {
    return this.mutate((state) => {
      const ws = state.workspaces[workspaceId];
      if (!ws) return SKIP_SAVE;
      ws.lastOpenedAt = Date.now();
      return ws;
    });
  },

};

// Tab and group operations (kept in their own file; they run with workspaceManager as `this`)
Object.assign(workspaceManager, tabOperations);
