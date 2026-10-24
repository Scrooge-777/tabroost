/**
 * Workspace templates — a saved starting set of tabs and groups (name, color, icon) that a
 * new workspace can be created from. Kept in storage.local; not synced.
 */

import { STORAGE_KEYS } from '../shared/constants.js';
import { storage } from '../shared/storage.js';
import { sanitizeGroup, sanitizeIcon, sanitizeName, sanitizeNotes, sanitizeTab } from '../shared/schema.js';
import { isValidColor, DEFAULT_COLOR } from '../shared/colors.js';
import { generateId, createLock } from '../shared/utils.js';
import { workspaceManager } from './workspace-manager.js';

export const MAX_TEMPLATES = 20;

const withLock = createLock();

async function readAll() {
  const items = await storage.getLocal(STORAGE_KEYS.TEMPLATES);
  const value = items[STORAGE_KEYS.TEMPLATES];
  return Array.isArray(value) ? value : [];
}

function describe(t) {
  return { id: t.id, name: t.name, color: t.color, icon: t.icon, tabCount: t.tabs.length, groupCount: t.groups.length };
}

export const templates = {
  async list() {
    return (await readAll()).map(describe);
  },

  /** Save the current tabs and groups of a workspace as a template */
  async saveFromWorkspace(workspaceId, name = '') {
    return withLock(async () => {
      const state = await workspaceManager.loadState();
      const ws = state.workspaces[workspaceId];
      if (!ws) throw new Error('Workspace not found');

      const all = await readAll();
      if (all.length >= MAX_TEMPLATES) throw new Error(`You can keep up to ${MAX_TEMPLATES} templates. Delete one first.`);

      const template = {
        id: generateId('tpl'),
        name: sanitizeName(name || ws.name),
        color: isValidColor(ws.color) ? ws.color : DEFAULT_COLOR,
        icon: sanitizeIcon(ws.icon),
        notes: sanitizeNotes(ws.notes),
        createdAt: Date.now(),
        tabs: ws.tabs.map(({ id, url, title, pinned, index, groupId }) => ({ id, url, title, pinned, index, groupId, active: false })),
        groups: ws.groups.map((g) => ({ ...g }))
      };
      await storage.setLocal({ [STORAGE_KEYS.TEMPLATES]: [...all, template] });
      return describe(template);
    });
  },

  async remove(id) {
    return withLock(async () => {
      const all = await readAll();
      const next = all.filter((t) => t.id !== id);
      if (next.length === all.length) return false;
      await storage.setLocal({ [STORAGE_KEYS.TEMPLATES]: next });
      return true;
    });
  },

  /** Create a workspace from a template, with fresh tab and group ids */
  async instantiate(id, name = '') {
    const template = (await readAll()).find((t) => t.id === id);
    if (!template) throw new Error('That template no longer exists');

    const groupIds = new Map();
    const groups = template.groups.map((g) => {
      const fresh = generateId('g');
      groupIds.set(g.id, fresh);
      return sanitizeGroup({ ...g, id: fresh });
    });
    const known = new Set(groups.map((g) => g.id));
    const tabs = template.tabs.map((t, i) =>
      sanitizeTab({ ...t, id: generateId('t'), groupId: t.groupId ? groupIds.get(t.groupId) || null : null, active: i === 0 }, i, known)
    );

    return workspaceManager.createWorkspace({
      name: name || template.name,
      color: template.color,
      icon: template.icon,
      notes: template.notes,
      tabs,
      groups
    });
  }
};
