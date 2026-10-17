/**
 * Minimal chrome.* mock so the background logic can be exercised outside a browser.
 */
const localStore = {};
const sessionStore = {};

let nextWindowId = 100;
let nextTabId = 1000;
let nextGroupId = 5000;
const windows = new Map();
const groups = new Map();

function area(store) {
  return {
    async get(keys, cb) {
      let out = {};
      if (keys == null) out = { ...store };
      else if (typeof keys === 'string') out = keys in store ? { [keys]: store[keys] } : {};
      else if (Array.isArray(keys)) {
        for (const k of keys) if (k in store) out[k] = store[k];
      } else {
        out = { ...keys };
        for (const k of Object.keys(keys)) if (k in store) out[k] = store[k];
      }
      if (typeof cb === 'function') cb(out);
      return out;
    },
    async set(obj, cb) {
      Object.assign(store, structuredClone(obj));
      if (typeof cb === 'function') cb();
    },
    async remove(key, cb) {
      if (Array.isArray(key)) for (const k of key) delete store[k];
      else delete store[key];
      if (typeof cb === 'function') cb();
    },
    async clear(cb) {
      for (const k of Object.keys(store)) delete store[k];
      if (typeof cb === 'function') cb();
    },
  };
}

function makeTab(windowId, { url, pinned = false, index, active = false }) {
  return {
    id: nextTabId++, windowId, url, title: url, favIconUrl: '',
    pinned, index, active,
  };
}

function reindex(win) { win.tabs.forEach((t, i) => { t.index = i; }); }

export const listeners = { messages: [] };

globalThis.chrome = {
  storage: { local: area(localStore), session: area(sessionStore) },

  runtime: {
    lastError: null,
    onMessage: { addListener() {} },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    async sendMessage(msg, cb) {
      listeners.messages.push(msg);
      if (typeof cb === 'function') cb({ ok: true });
      return { ok: true };
    },
  },

  commands: { onCommand: { addListener() {} } },
  action: {
    async setBadgeText(details) {
      if (details && 'windowId' in details) {
        throw new Error("Unexpected property: 'windowId'");
      }
      return true;
    },
    async setBadgeBackgroundColor(details) {
      if (details && 'windowId' in details) {
        throw new Error("Unexpected property: 'windowId'");
      }
      return true;
    },
    async openPopup() { return true; }
  },
  sidePanel: { async setPanelBehavior() {}, async open() { return true; } },
  contextMenus: {
    async removeAll(cb) {
      if (typeof cb === 'function') cb();
    },
    create(props, cb) {
      if (typeof cb === 'function') cb();
    },
    onClicked: { addListener() {} }
  },

  windows: {
    WINDOW_ID_NONE: -1,
    onRemoved: { addListener() {} },
    onFocusChanged: { addListener() {} },
    async create({ url, focused }) {
      const id = nextWindowId++;
      const win = { id, focused: !!focused, tabs: [] };
      win.tabs.push(makeTab(id, { url, index: 0, active: true }));
      windows.set(id, win);
      return structuredClone(win);
    },
    async get(id) {
      const w = windows.get(id);
      if (!w) throw new Error('No window with id ' + id);
      return structuredClone(w);
    },
    async getAll() { return [...windows.values()].map((w) => structuredClone(w)); },
    async getLastFocused() {
      const w = [...windows.values()].find((x) => x.focused) || [...windows.values()][0];
      return w ? structuredClone(w) : null;
    },
    async update(id, props) {
      const w = windows.get(id);
      if (!w) throw new Error('No window with id ' + id);
      if (props.focused) {
        for (const x of windows.values()) x.focused = false;
        w.focused = true;
      }
      return structuredClone(w);
    },
    async remove(id) {
      if (!windows.has(id)) throw new Error('No window with id ' + id);
      windows.delete(id);
    },
  },

  tabs: {
    onCreated: { addListener() {} },
    onRemoved: { addListener() {} },
    onUpdated: { addListener() {} },
    onMoved: { addListener() {} },
    onAttached: { addListener() {} },
    onDetached: { addListener() {} },
    onActivated: { addListener() {} },
    async query({ windowId }) {
      const w = windows.get(windowId);
      if (!w) throw new Error('No window with id ' + windowId);
      return structuredClone(w.tabs);
    },
    async create({ windowId, url, pinned, index, active }) {
      const w = windows.get(windowId);
      const tab = makeTab(windowId, { url, pinned, index, active });
      w.tabs.splice(index ?? w.tabs.length, 0, tab);
      reindex(w);
      return structuredClone(tab);
    },
    async update(tabId, props) {
      for (const w of windows.values()) {
        const t = w.tabs.find((x) => x.id === tabId);
        if (!t) continue;
        if (props.active) { w.tabs.forEach((x) => { x.active = false; }); t.active = true; }
        if (props.pinned !== undefined) t.pinned = props.pinned;
        return structuredClone(t);
      }
      throw new Error('No tab with id ' + tabId);
    },
    async remove(tabId) {
      for (const w of windows.values()) {
        const i = w.tabs.findIndex((x) => x.id === tabId);
        if (i >= 0) { w.tabs.splice(i, 1); reindex(w); return; }
      }
    },
    async group({ tabIds, groupId } = {}) {
      let gid = groupId;
      if (!gid) {
        gid = nextGroupId++;
        groups.set(gid, { id: gid, title: '', color: 'grey', collapsed: false });
      }
      const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
      for (const w of windows.values()) {
        for (const t of w.tabs) {
          if (ids.includes(t.id)) {
            t.groupId = gid;
          }
        }
      }
      return gid;
    },
    async ungroup(tabIds) {
      const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
      for (const w of windows.values()) {
        for (const t of w.tabs) {
          if (ids.includes(t.id)) {
            t.groupId = -1;
          }
        }
      }
    },
    async duplicate(tabId) {
      for (const w of windows.values()) {
        const t = w.tabs.find((x) => x.id === tabId);
        if (t) {
          const newTab = makeTab(w.id, { url: t.url, pinned: t.pinned, index: t.index + 1, active: true });
          w.tabs.splice(t.index + 1, 0, newTab);
          reindex(w);
          return structuredClone(newTab);
        }
      }
      throw new Error('No tab with id ' + tabId);
    }
  },

  tabGroups: {
    TAB_GROUP_ID_NONE: -1,
    onCreated: { addListener() {} },
    onUpdated: { addListener() {} },
    onMoved: { addListener() {} },
    onRemoved: { addListener() {} },
    async query({ windowId } = {}) {
      return [...groups.values()].map((g) => ({ ...g, windowId }));
    },
    async update(groupId, props) {
      let g = groups.get(groupId);
      if (!g) {
        g = { id: groupId, title: '', color: 'grey', collapsed: false };
        groups.set(groupId, g);
      }
      Object.assign(g, props);
      return structuredClone(g);
    }
  },
};

export function seedWindow(urls, { focused = true } = {}) {
  const id = nextWindowId++;
  const win = { id, focused, tabs: [] };
  urls.forEach((url, i) => win.tabs.push(makeTab(id, { url, index: i, active: i === 0 })));
  if (focused) for (const w of windows.values()) w.focused = false;
  win.focused = focused;
  windows.set(id, win);
  return win;
}

export function getWindow(id) { return windows.get(id); }
export function windowCount() { return windows.size; }
export function closeWindowRaw(id) { windows.delete(id); }
export function dumpSession() { return structuredClone(sessionStore); }
export function clearSession() { for (const k of Object.keys(sessionStore)) delete sessionStore[k]; }
