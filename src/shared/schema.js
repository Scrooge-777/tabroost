/**
 * Data shapes, validation, and migration for Brave Workspaces
 */

import { SCHEMA_VERSION, DEFAULT_SETTINGS } from './constants.js';
import { DEFAULT_COLOR, isValidColor } from './colors.js';
import { generateId } from './utils.js';

/**
 * Factory for a new workspace
 */
export function createWorkspaceModel({
  name = 'New Workspace',
  color = DEFAULT_COLOR,
  icon = '',
  tabs = [],
  groups = []
} = {}) {
  const now = Date.now();
  const id = generateId('ws');

  // If no tabs provided, default to a clean new tab
  const sanitizedTabs = tabs.length > 0
    ? tabs.map((t, idx) => sanitizeTab(t, idx))
    : [{
        id: generateId('t'),
        url: 'chrome://newtab/',
        title: 'New Tab',
        favIconUrl: '',
        pinned: false,
        index: 0,
        groupId: null,
        active: true
      }];

  return {
    id,
    name: (name || 'Workspace').trim(),
    color: isValidColor(color) ? color : DEFAULT_COLOR,
    icon: icon || '',
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    tabs: sanitizedTabs,
    groups: groups.map(sanitizeGroup)
  };
}

/**
 * Sanitize single tab entry
 */
export function sanitizeTab(tab, index = 0) {
  return {
    id: tab.id || generateId('t'),
    url: tab.url || 'chrome://newtab/',
    title: tab.title || 'New Tab',
    favIconUrl: tab.favIconUrl || '',
    pinned: Boolean(tab.pinned),
    index: typeof tab.index === 'number' ? tab.index : index,
    groupId: tab.groupId || null,
    active: Boolean(tab.active)
  };
}

/**
 * Sanitize single group entry
 */
export function sanitizeGroup(group) {
  return {
    id: group.id || generateId('g'),
    title: (group.title || '').trim(),
    color: isValidColor(group.color) ? group.color : 'grey',
    collapsed: false
  };
}

/**
 * Ensure storage shape conforms to Schema V1
 */
export function migrateStorageData(raw = {}) {
  const data = raw || {};
  const version = data.schemaVersion || 0;

  const result = {
    schemaVersion: SCHEMA_VERSION,
    settings: {
      ...DEFAULT_SETTINGS,
      ...(data.settings || {})
    },
    workspaces: {},
    workspaceOrder: []
  };

  if (data.workspaces && typeof data.workspaces === 'object') {
    for (const [id, ws] of Object.entries(data.workspaces)) {
      if (ws && typeof ws === 'object' && ws.name) {
        result.workspaces[id] = {
          id: ws.id || id,
          name: ws.name || 'Workspace',
          color: isValidColor(ws.color) ? ws.color : DEFAULT_COLOR,
          icon: ws.icon || '',
          createdAt: ws.createdAt || Date.now(),
          updatedAt: ws.updatedAt || Date.now(),
          lastOpenedAt: ws.lastOpenedAt || Date.now(),
          tabs: Array.isArray(ws.tabs) ? ws.tabs.map(sanitizeTab) : [],
          groups: Array.isArray(ws.groups) ? ws.groups.map(sanitizeGroup) : []
        };
      }
    }
  }

  if (Array.isArray(data.workspaceOrder)) {
    result.workspaceOrder = data.workspaceOrder.filter((id) => Boolean(result.workspaces[id]));
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
  if (!payload || typeof payload !== 'object') {
    throw new Error('Import data must be a valid JSON object.');
  }

  if (!payload.workspaces || typeof payload.workspaces !== 'object') {
    throw new Error('Invalid format: missing workspaces object.');
  }

  return migrateStorageData(payload);
}
