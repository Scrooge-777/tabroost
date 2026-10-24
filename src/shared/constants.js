/**
 * Storage keys and message constants for Tabroost
 */

export const SCHEMA_VERSION = 2;

export const STORAGE_KEYS = {
  SCHEMA_VERSION: 'schemaVersion',
  WORKSPACES: 'workspaces',
  WORKSPACE_ORDER: 'workspaceOrder',
  SETTINGS: 'settings',
  BACKUPS: 'backups',
  TOMBSTONES: 'tombstones',
  HISTORY: 'history',
  SYNC_SECRETS: 'syncSecrets',

  // Session storage keys
  WINDOW_BINDINGS: 'windowBindings',
  ACTIVE_WORKSPACE_ID: 'activeWorkspaceId',
  PREVIOUS_WORKSPACE_ID: 'previousWorkspaceId',
  SUPPRESS_SYNC: 'suppressSync',
  LIVE_MAPS: 'liveMaps',
  SYNC_LOCK: 'syncLock',
  SYNC_BACKOFF: 'syncBackoff'
};

export const DEFAULT_SETTINGS = {
  restoreOnStartup: true,
  closeWindowOnWorkspaceSwitch: false,
  confirmDelete: true,
  sortOrder: 'manual', // 'manual' | 'recent'
  showPagePill: false,
  pillPosition: 'top-left', // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center-left' | 'center-right'
  pillStyle: 'handle', // 'handle' (edge strip + slide-out panel) | 'dot'
  pillSize: 'medium',
  pillOpenOnHover: false,
  pillOffsetY: null, // 0-100 (% of window height) once the handle has been dragged
  pillHiddenSites: '', // hostnames (one per line or comma separated) where the indicator stays hidden // 'compact' | 'medium' | 'large' | 'xlarge'
  accentBorder: false,
  autoBackup: true,
  lazyRestoreTabs: true,
  syncEnabled: false,
  syncProvider: 'gist',
  syncGistId: '',
  syncRememberSecrets: false, // keep token + passphrase on disk instead of session-only
  syncIntervalMinutes: 30,
  lastSyncedAt: null
};

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);

export const MAX_BACKUPS = 10;
export const BACKUP_ALARM = 'workspaces-auto-backup';
export const BACKUP_INTERVAL_MINUTES = 60 * 6;
export const SYNC_ALARM = 'workspaces-cloud-sync';
export const SYNC_TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SYNC_MIN_PASSPHRASE_LENGTH = 8;
export const SYNC_PAYLOAD_VERSION = 2;
export const EXPORT_APP_NAME = 'tabroost';
export const LEGACY_EXPORT_APP_NAME = 'workspaces';

/** Secrets that must never be part of settings, exports or backups */
export const LEGACY_SECRET_SETTING_KEYS = ['syncGistToken', 'syncPassphrase'];

export const PAGE_SCRIPT_ID = 'workspaces-page-indicator';

export const MESSAGE_TYPES = {
  // Panel/Options -> Background Worker
  LIST_WORKSPACES: 'LIST_WORKSPACES',
  CREATE_WORKSPACE: 'CREATE_WORKSPACE',
  CREATE_FROM_CURRENT_WINDOW: 'CREATE_FROM_CURRENT_WINDOW',
  OPEN_WORKSPACE: 'OPEN_WORKSPACE',
  CLOSE_WORKSPACE: 'CLOSE_WORKSPACE',
  UPDATE_WORKSPACE: 'UPDATE_WORKSPACE',
  RENAME_WORKSPACE: 'RENAME_WORKSPACE',
  RECOLOR_WORKSPACE: 'RECOLOR_WORKSPACE',
  DELETE_WORKSPACE: 'DELETE_WORKSPACE',
  RESTORE_WORKSPACE: 'RESTORE_WORKSPACE',
  DUPLICATE_WORKSPACE: 'DUPLICATE_WORKSPACE',
  REORDER_WORKSPACES: 'REORDER_WORKSPACES',
  ADOPT_WINDOW: 'ADOPT_WINDOW',
  LIST_HISTORY: 'LIST_HISTORY',
  CREATE_VERSION: 'CREATE_VERSION',
  RESTORE_VERSION: 'RESTORE_VERSION',
  SWITCH_TO_LAST: 'SWITCH_TO_LAST',
  MOVE_TAB_TO_WORKSPACE: 'MOVE_TAB_TO_WORKSPACE',
  CLOSE_TAB_IN_WORKSPACE: 'CLOSE_TAB_IN_WORKSPACE',
  OPEN_TAB_IN_WORKSPACE: 'OPEN_TAB_IN_WORKSPACE',
  MERGE_TABS_INTO_GROUP: 'MERGE_TABS_INTO_GROUP',
  ADD_TAB_TO_GROUP: 'ADD_TAB_TO_GROUP',
  REMOVE_TAB_FROM_GROUP: 'REMOVE_TAB_FROM_GROUP',
  UNGROUP_TABS: 'UNGROUP_TABS',
  UPDATE_TAB_GROUP: 'UPDATE_TAB_GROUP',
  ORGANIZE_TABS: 'ORGANIZE_TABS',
  GET_CURRENT_STATUS: 'GET_CURRENT_STATUS',
  GET_PAGE_INDICATOR: 'GET_PAGE_INDICATOR',
  GET_SETTINGS: 'GET_SETTINGS',
  UPDATE_SETTINGS: 'UPDATE_SETTINGS',
  SYNC_PAGE_FEATURES: 'SYNC_PAGE_FEATURES',
  EXPORT: 'EXPORT',
  IMPORT: 'IMPORT',
  LIST_BACKUPS: 'LIST_BACKUPS',
  CREATE_BACKUP: 'CREATE_BACKUP',
  RESTORE_BACKUP: 'RESTORE_BACKUP',
  RESET_ALL: 'RESET_ALL',
  OPEN_SIDE_PANEL: 'OPEN_SIDE_PANEL',

  // Cloud Sync Messages
  START_SYNC: 'START_SYNC',
  GET_SYNC_STATUS: 'GET_SYNC_STATUS',
  UPDATE_SYNC_CONFIG: 'UPDATE_SYNC_CONFIG',

  // Background Worker -> UI broadcast
  WORKSPACE_UPDATED: 'WORKSPACE_UPDATED',
  STATE_CHANGED: 'STATE_CHANGED',
  TRIGGER_NEW_WORKSPACE_MODAL: 'TRIGGER_NEW_WORKSPACE_MODAL',
  INDICATOR_REFRESH: 'INDICATOR_REFRESH',

  // Flyout iframe -> content script (window.postMessage)
  CLOSE_FLYOUT: 'CLOSE_TABROOST_FLYOUT'
};

/** Message types that are broadcasts, never requests for the router */
export const BROADCAST_TYPES = new Set([
  MESSAGE_TYPES.WORKSPACE_UPDATED,
  MESSAGE_TYPES.STATE_CHANGED,
  MESSAGE_TYPES.TRIGGER_NEW_WORKSPACE_MODAL,
  MESSAGE_TYPES.INDICATOR_REFRESH,
  MESSAGE_TYPES.CLOSE_FLYOUT
]);
