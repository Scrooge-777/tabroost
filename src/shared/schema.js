/**
 * Data shapes, validation, and migration for Tabroost
 */

import { SCHEMA_VERSION, DEFAULT_SETTINGS, SETTING_KEYS, SYNC_PAYLOAD_VERSION } from './constants.js';
import { DEFAULT_COLOR, isValidColor } from './colors.js';
import { generateId, NEW_TAB_URL } from './utils.js';

const MAX_NAME_LENGTH = 60;
const MAX_NOTES_LENGTH = 500;
const MAX_INLINE_FAVICON = 2048;

export function newTabEntry(index = 0) {
  return {
    id: generateId('t'),
    url: NEW_TAB_URL,
    title: 'New Tab',
    favIconUrl: '',
    pinned: false,
    index,
    groupId: null,
    active: true
  };
}

export function sanitizeName(name, fallback = 'Workspace') {
  const trimmed = String(name ?? '').trim().slice(0, MAX_NAME_LENGTH);
  return trimmed || fallback;
}

export function sanitizeNotes(notes) {
  return String(notes ?? '').replace(/\r\n/g, '\n').trim().slice(0, MAX_NOTES_LENGTH);
}

/**
 * Keep only the first grapheme-ish chunk of an emoji/icon string.
 */
export function sanitizeIcon(icon) {
  const value = String(icon ?? '').trim();
  if (!value) return '';
  return Array.from(value).slice(0, 2).join('');
}

/**
 * Inline data: favicons can be tens of KB each; storing them for hundreds of tabs
 * quickly fills storage. Large ones are dropped (the UI falls back to _favicon).
 */
export function sanitizeFavicon(favIconUrl) {
  if (!favIconUrl || typeof favIconUrl !== 'string') return '';
  if (favIconUrl.startsWith('chrome://') || favIconUrl.startsWith('brave://')) return '';
  if (favIconUrl.startsWith('data:') && favIconUrl.length > MAX_INLINE_FAVICON) return '';
  return favIconUrl;
}

/**
 * Factory for a new workspace
 */
export function createWorkspaceModel({
  name = 'New Workspace',
  color = DEFAULT_COLOR,
  icon = '',
  notes = '',
  tabs = [],
  groups = [],
  window: windowInfo = null
} = {}) {
  const now = Date.now();
  const sanitizedGroups = groups.map(sanitizeGroup);
  const groupIds = new Set(sanitizedGroups.map((g) => g.id));
  const sanitizedTabs = tabs.length > 0
    ? tabs.map((t, idx) => sanitizeTab(t, idx, groupIds))
    : [newTabEntry(0)];

  return {
    id: generateId('ws'),
    name: sanitizeName(name),
    color: isValidColor(color) ? color : DEFAULT_COLOR,
    icon: sanitizeIcon(icon),
    notes: sanitizeNotes(notes),
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    tabs: sanitizedTabs,
    groups: sanitizedGroups,
    window: sanitizeWindowInfo(windowInfo),
    deletedAt: null
  };
}

/**
 * Sanitize single tab entry. When groupIds is given, references to unknown groups are dropped.
 */
export function sanitizeTab(tab, index = 0, groupIds = null) {
  let groupId = tab.groupId != null && tab.groupId !== -1 && tab.groupId !== '' ? String(tab.groupId) : null;
  if (groupId && groupIds && !groupIds.has(groupId)) groupId = null;
  return {
    id: tab.id ? String(tab.id) : generateId('t'),
    url: tab.url || NEW_TAB_URL,
    title: tab.title || tab.url || 'New Tab',
    favIconUrl: sanitizeFavicon(tab.favIconUrl),
    pinned: Boolean(tab.pinned),
    index: typeof tab.index === 'number' ? tab.index : index,
    groupId,
    active: Boolean(tab.active)
  };
}

/**
 * Sanitize single group entry
 */
export function sanitizeGroup(group) {
  return {
    id: group.id ? String(group.id) : generateId('g'),
    title: String(group.title || '').trim(),
    color: isValidColor(group.color) ? group.color : 'grey',
    collapsed: Boolean(group.collapsed)
  };
}

/**
 * Window placement saved alongside a workspace so it reopens where it was.
 */
export function sanitizeWindowInfo(info) {
  if (!info || typeof info !== 'object') return null;
  const state = ['normal', 'maximized', 'fullscreen'].includes(info.state) ? info.state : 'normal';
  const num = (v) => (Number.isFinite(v) ? Math.round(v) : null);
  const out = { state, left: num(info.left), top: num(info.top), width: num(info.width), height: num(info.height) };
  if (out.width !== null && out.width < 200) out.width = null;
  if (out.height !== null && out.height < 200) out.height = null;
  return out;
}

export function sanitizeWorkspace(ws, id) {
  const groups = Array.isArray(ws.groups) ? ws.groups.map(sanitizeGroup) : [];
  const groupIds = new Set(groups.map((g) => g.id));
  const tabs = Array.isArray(ws.tabs) ? ws.tabs.map((t, i) => sanitizeTab(t, i, groupIds)) : [];
  // Groups without any member tab are dead weight
  const usedGroupIds = new Set(tabs.map((t) => t.groupId).filter(Boolean));
  const now = Date.now();
  return {
    id: ws.id || id,
    name: sanitizeName(ws.name),
    color: isValidColor(ws.color) ? ws.color : DEFAULT_COLOR,
    icon: sanitizeIcon(ws.icon),
    notes: sanitizeNotes(ws.notes),
    createdAt: ws.createdAt || now,
    updatedAt: ws.updatedAt || now,
    lastOpenedAt: ws.lastOpenedAt || ws.updatedAt || now,
    tabs: tabs.length > 0 ? tabs : [newTabEntry(0)],
    groups: groups.filter((g) => usedGroupIds.has(g.id)),
    window: sanitizeWindowInfo(ws.window),
    deletedAt: typeof ws.deletedAt === 'number' ? ws.deletedAt : null
  };
}

export function sanitizeSettings(raw = {}) {
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of SETTING_KEYS) {
    if (raw && raw[key] !== undefined) {
      if (DEFAULT_SETTINGS[key] === null) {
        settings[key] = (raw[key] === null || typeof raw[key] === 'number') ? raw[key] : null;
      } else if (typeof raw[key] === typeof DEFAULT_SETTINGS[key]) {
        settings[key] = raw[key];
      }
    }
  }
  if (!['manual', 'recent'].includes(settings.sortOrder)) settings.sortOrder = 'manual';
  if (!['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center-left', 'center-right'].includes(settings.pillPosition)) {
    settings.pillPosition = 'top-left';
  }
  if (!['handle', 'dot'].includes(settings.pillStyle)) settings.pillStyle = 'handle';
  if (settings.pillOffsetY !== null && !(Number.isFinite(settings.pillOffsetY))) settings.pillOffsetY = null;
  if (settings.pillOffsetY !== null) settings.pillOffsetY = Math.min(100, Math.max(0, settings.pillOffsetY));
  settings.pillHiddenSites = settings.pillHiddenSites.slice(0, 2000);
  if (!['compact', 'medium', 'large', 'xlarge'].includes(settings.pillSize)) {
    settings.pillSize = 'medium';
  }
  return settings;
}

/**
 * Deleted workspace ids -> deletion time. Lets sync tell "deleted here" from "never had it".
 */
export function sanitizeTombstones(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, at] of Object.entries(raw)) {
    if (typeof at === 'number' && Number.isFinite(at) && at > 0) out[String(id)] = at;
  }
  return out;
}

/**
 * Validate and clean a payload decrypted from the cloud. Anything malformed throws,
 * so a corrupt or hostile remote can never reach storage unsanitized.
 */
export function sanitizeSyncPayload(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Remote sync payload is not an object');
  }
  if (raw.schemaVersion !== undefined && (!Number.isInteger(raw.schemaVersion) || raw.schemaVersion > SYNC_PAYLOAD_VERSION)) {
    throw new Error('Remote data was written by a newer Tabroost. Update this device first.');
  }
  if (raw.workspaces !== undefined && (typeof raw.workspaces !== 'object' || raw.workspaces === null || Array.isArray(raw.workspaces))) {
    throw new Error('Remote sync payload has invalid workspaces');
  }

  const workspaces = {};
  for (const [id, ws] of Object.entries(raw.workspaces || {})) {
    if (ws && typeof ws === 'object' && ws.name) {
      const clean = sanitizeWorkspace(ws, id);
      workspaces[clean.id] = clean;
    }
  }
  const workspaceOrder = Array.isArray(raw.workspaceOrder)
    ? [...new Set(raw.workspaceOrder.map(String))].filter((id) => workspaces[id])
    : [];
  return { workspaces, workspaceOrder, tombstones: sanitizeTombstones(raw.tombstones) };
}

/**
 * Ensure storage shape conforms to the current schema (v1 data migrates in place)
 */
export function migrateStorageData(raw = {}) {
  const data = raw || {};

  const result = {
    schemaVersion: SCHEMA_VERSION,
    settings: sanitizeSettings(data.settings),
    workspaces: {},
    workspaceOrder: [],
    tombstones: sanitizeTombstones(data.tombstones)
  };

  if (data.workspaces && typeof data.workspaces === 'object') {
    for (const [id, ws] of Object.entries(data.workspaces)) {
      if (ws && typeof ws === 'object' && ws.name) {
        const clean = sanitizeWorkspace(ws, id);
        result.workspaces[clean.id] = clean;
      }
    }
  }

  if (Array.isArray(data.workspaceOrder)) {
    result.workspaceOrder = [...new Set(data.workspaceOrder)].filter((id) => Boolean(result.workspaces[id]));
  }

  // Ensure all existing workspace IDs are present in order array
  for (const id of Object.keys(result.workspaces)) {
    if (!result.workspaceOrder.includes(id)) {
      result.workspaceOrder.push(id);
    }
  }

  return result;
}

/**
 * Validate imported payload
 */
export function validateImportPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Import data must be a valid JSON object.');
  }

  if (!payload.workspaces || typeof payload.workspaces !== 'object') {
    throw new Error('Invalid format: missing workspaces object.');
  }

  const migrated = migrateStorageData(payload);
  if (Object.keys(migrated.workspaces).length === 0) {
    throw new Error('The file does not contain any workspaces.');
  }
  return migrated;
}
