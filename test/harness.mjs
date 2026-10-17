/**
 * Minimal chrome.* mock so the background logic can be exercised outside a browser.
 * Models windows, tabs, native tab groups (per window), and both storage areas.
 */
const localStore = {};
const sessionStore = {};

let nextWindowId = 100;
let nextTabId = 1000;
let nextGroupId = 5000;
const windows = new Map();
const groups = new Map(); // gid -> { id, windowId, title, color, collapsed }

const noopEvent = () => ({ addListener() {}, removeListener() {} });

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
      out = structuredClone(out);
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
    async setAccessLevel() {}
  };
}

function makeTab(windowId, { url, pinned = false, index, active = false }) {
  return {
    id: nextTabId++, windowId, url, title: url, favIconUrl: '',
    pinned: Boolean(pinned), index, active, groupId: -1
  };
}

function reindex(win) { win.tabs.forEach((t, i) => { t.index = i; t.windowId = win.id; }); }

function findTab(tabId) {
  for (const w of windows.values()) {
    const t = w.tabs.find((x) => x.id === tabId);
    if (t) return { win: w, tab: t };
  }
  return null;
}

function pruneGroups() {
  const used = new Set();
  for (const w of windows.values()) for (const t of w.tabs) if (t.groupId !== -1) used.add(t.groupId);
  for (const gid of [...groups.keys()]) if (!used.has(gid)) groups.delete(gid);
}

function closeWindow(id) {
  windows.delete(id);
  pruneGroups();
}

export const listeners = { messages: [] };

globalThis.chrome = {
  storage: { local: area(localStore), session: area(sessionStore), onChanged: noopEvent() },

  runtime: {
    id: 'test-extension',
    lastError: null,
    onMessage: noopEvent(),
    onInstalled: noopEvent(),
    onStartup: noopEvent(),
    getURL: (p) => `chrome-extension://test-extension/${String(p).replace(/^\//, '')}`,
    async sendMessage(msg, cb) {
      listeners.messages.push(msg);
      if (typeof cb === 'function') cb({ ok: true });
      return { ok: true };
    },
  },

  commands: { onCommand: noopEvent() },
  alarms: {
    async get() { return null; },
    async create() {},
    onAlarm: noopEvent()
  },
  permissions: { async contains() { return false; } },
  scripting: {
    async getRegisteredContentScripts() { return []; },
    async registerContentScripts() {},
    async unregisterContentScripts() {},
    async executeScript() {}
  },
  action: {
    badge: { text: '', color: null, title: '' },
    async setBadgeText(details) {
      if (details && 'windowId' in details) throw new Error("Unexpected property: 'windowId'");
      this.badge.text = details.text;
    },
    async setBadgeBackgroundColor(details) {
      if (details && 'windowId' in details) throw new Error("Unexpected property: 'windowId'");
      this.badge.color = details.color;
    },
    async setBadgeTextColor() {},
    async setTitle(details) { this.badge.title = details.title; },
    async openPopup() { return true; }
  },
  sidePanel: { async setPanelBehavior() {}, async open() { return true; } },
  contextMenus: {
    items: [],
    async removeAll(cb) {
      this.items = [];
      if (typeof cb === 'function') cb();
    },
    create(props, cb) {
      this.items.push(props);
      if (typeof cb === 'function') cb();
    },
    onClicked: noopEvent()
  },

  windows: {
    WINDOW_ID_NONE: -1,
    onRemoved: noopEvent(),
    onFocusChanged: noopEvent(),
    onBoundsChanged: noopEvent(),
    lastCreateProps: null,
    async create(props = {}) {
      this.lastCreateProps = props;
      const id = nextWindowId++;
      const win = {
        id, focused: !!props.focused, tabs: [],
        state: props.state || 'normal',
        left: props.left ?? 0, top: props.top ?? 0, width: props.width ?? 1200, height: props.height ?? 800
      };
      if (props.tabId) {
        const found = findTab(props.tabId);
        found.win.tabs.splice(found.win.tabs.indexOf(found.tab), 1);
        reindex(found.win);
        found.tab.groupId = -1;
        win.tabs.push(found.tab);
      } else {
        win.tabs.push(makeTab(id, { url: props.url, index: 0, active: true }));
      }
      if (props.focused) for (const w of windows.values()) w.focused = false;
      windows.set(id, win);
      reindex(win);
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
      closeWindow(id);
    },
  },

  tabs: {
    onCreated: noopEvent(),
    onRemoved: noopEvent(),
    onUpdated: noopEvent(),
    onMoved: noopEvent(),
    onAttached: noopEvent(),
    onDetached: noopEvent(),
    onActivated: noopEvent(),
    async query({ windowId, active } = {}) {
      if (windowId === undefined) {
        const all = [...windows.values()].flatMap((w) => w.tabs);
        return structuredClone(active ? all.filter((t) => t.active) : all);
      }
      const w = windows.get(windowId);
      if (!w) throw new Error('No window with id ' + windowId);
      return structuredClone(w.tabs);
    },
    async get(tabId) {
      const found = findTab(tabId);
      if (!found) throw new Error('No tab with id: ' + tabId);
      return structuredClone(found.tab);
    },
    async create({ windowId, url, pinned, index, active }) {
      const w = windows.get(windowId);
      if (!w) throw new Error('No window with id ' + windowId);
      if (typeof url === 'string' && url.startsWith('blocked://')) throw new Error('Cannot open ' + url);
      const tab = makeTab(windowId, { url, pinned, index, active });
      if (active) w.tabs.forEach((x) => { x.active = false; });
      w.tabs.splice(index ?? w.tabs.length, 0, tab);
      reindex(w);
      return structuredClone(tab);
    },
    async update(tabId, props) {
      const found = findTab(tabId);
      if (!found) throw new Error('No tab with id ' + tabId);
      const { win, tab } = found;
      if (props.active) { win.tabs.forEach((x) => { x.active = false; }); tab.active = true; }
      if (props.pinned !== undefined) tab.pinned = props.pinned;
      return structuredClone(tab);
    },
    async move(tabId, { windowId, index }) {
      const found = findTab(tabId);
      if (!found) throw new Error('No tab with id ' + tabId);
      const { win, tab } = found;
      win.tabs.splice(win.tabs.indexOf(tab), 1);
      reindex(win);
      if (win.tabs.length === 0) closeWindow(win.id);
      const target = windows.get(windowId ?? win.id);
      tab.groupId = -1;
      tab.active = false;
      target.tabs.splice(index === -1 || index == null ? target.tabs.length : index, 0, tab);
      reindex(target);
      pruneGroups();
      return structuredClone(tab);
    },
    async remove(tabId) {
      const ids = Array.isArray(tabId) ? tabId : [tabId];
      for (const id of ids) {
        const found = findTab(id);
        if (!found) continue;
        found.win.tabs.splice(found.win.tabs.indexOf(found.tab), 1);
        reindex(found.win);
        if (found.win.tabs.length === 0) closeWindow(found.win.id);
      }
      pruneGroups();
    },
    async group({ tabIds, groupId, createProperties } = {}) {
      const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
      const first = findTab(ids[0]);
      if (!first) throw new Error('No tab with id ' + ids[0]);
      if (createProperties && Object.keys(createProperties).some((k) => k !== 'windowId')) {
        throw new Error('Invalid createProperties');
      }
      let gid = groupId;
      if (!gid) {
        gid = nextGroupId++;
        groups.set(gid, { id: gid, windowId: createProperties?.windowId ?? first.win.id, title: '', color: 'grey', collapsed: false });
      } else if (!groups.has(gid)) {
        throw new Error('No group with id: ' + gid);
      }
      for (const id of ids) {
        const found = findTab(id);
        if (found) found.tab.groupId = gid;
      }
      pruneGroups();
      return gid;
    },
    async ungroup(tabIds) {
      const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
      for (const id of ids) {
        const found = findTab(id);
        if (found) found.tab.groupId = -1;
      }
      pruneGroups();
    },
    async duplicate(tabId) {
      const found = findTab(tabId);
      if (!found) throw new Error('No tab with id ' + tabId);
      const { win, tab } = found;
      const newTab = makeTab(win.id, { url: tab.url, pinned: tab.pinned, index: tab.index + 1, active: true });
      win.tabs.splice(tab.index + 1, 0, newTab);
      reindex(win);
      return structuredClone(newTab);
    },
    async sendMessage() {}
  },

  tabGroups: {
    TAB_GROUP_ID_NONE: -1,
    onCreated: noopEvent(),
    onUpdated: noopEvent(),
    onMoved: noopEvent(),
    onRemoved: noopEvent(),
    async query({ windowId } = {}) {
      return [...groups.values()].filter((g) => windowId === undefined || g.windowId === windowId).map((g) => ({ ...g }));
    },
    async get(groupId) {
      const g = groups.get(groupId);
      if (!g) throw new Error('No group with id: ' + groupId);
      return { ...g };
    },
    async update(groupId, props) {
      const g = groups.get(groupId);
      if (!g) throw new Error('No group with id: ' + groupId);
      Object.assign(g, props);
      return { ...g };
    }
  },
};

export function seedWindow(urls, { focused = true } = {}) {
  const id = nextWindowId++;
  const win = { id, focused, tabs: [], state: 'normal', left: 10, top: 20, width: 1000, height: 700 };
  urls.forEach((url, i) => win.tabs.push(makeTab(id, { url, index: i, active: i === 0 })));
  if (focused) for (const w of windows.values()) w.focused = false;
  windows.set(id, win);
  return win;
}

export function getWindow(id) { return windows.get(id); }
export function getGroup(id) { return groups.get(id); }
export function windowCount() { return windows.size; }
export function closeWindowRaw(id) { closeWindow(id); }
export function dumpSession() { return structuredClone(sessionStore); }
export function dumpLocal() { return structuredClone(localStore); }
export function clearSession() { for (const k of Object.keys(sessionStore)) delete sessionStore[k]; }
export function resetAll() {
  for (const k of Object.keys(localStore)) delete localStore[k];
  for (const k of Object.keys(sessionStore)) delete sessionStore[k];
  windows.clear();
  groups.clear();
}
