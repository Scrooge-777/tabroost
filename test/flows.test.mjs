import assert from 'node:assert/strict';
import {
  seedWindow, getWindow, getGroup, windowCount, closeWindowRaw, clearSession, dumpSession, dumpLocal, resetAll
} from './harness.mjs';

const { workspaceManager } = await import('../src/background/workspace-manager.js');
const { windowOpener } = await import('../src/background/window-opener.js');
const { windowRegistry } = await import('../src/background/window-registry.js');
const { tabSync } = await import('../src/background/tab-sync.js');
const { handleMessage } = await import('../src/background/router.js');
const { backups } = await import('../src/background/backups.js');
const { matchWindowsToWorkspaces, startupRecovery } = await import('../src/background/startup-recovery.js');
const { migrateStorageData, validateImportPayload } = await import('../src/shared/schema.js');
const { sanitizeRestoreUrl } = await import('../src/shared/utils.js');
const { MESSAGE_TYPES } = await import('../src/shared/constants.js');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  pass  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}\n        ${err.stack || err.message}`);
    process.exitCode = 1;
  }
}

const send = (type, payload = {}) => handleMessage({ type, ...payload }, {});
const liveTabIdFor = async (wsId, persistentId) => (await windowRegistry.getLiveMaps(wsId)).tabs[persistentId];

// ---------------------------------------------------------------------------
console.log('\nworkspace lifecycle');

let ws;
const seeded = seedWindow([
  'https://example.com/a',
  'https://example.com/b',
  'https://example.com/c',
]);

await test('saves window as a workspace and binds it', async () => {
  ws = await workspaceManager.createFromCurrentWindow(seeded.id, 'College', 'blue');
  assert.equal(ws.name, 'College');
  assert.equal(ws.tabs.length, 3);
  assert.ok(ws.tabs.every((t) => t.url.startsWith('https://')));
});

await test('binds the saved window immediately and records live tab ids', async () => {
  assert.equal(await windowRegistry.getWindowForWorkspace(ws.id), seeded.id);
  const maps = await windowRegistry.getLiveMaps(ws.id);
  assert.equal(Object.keys(maps.tabs).length, 3);
});

await test('lists the workspace as open', async () => {
  const state = await workspaceManager.getState();
  assert.ok(state.workspaces[ws.id]);
  assert.equal(state.bindings[String(seeded.id)], ws.id);
});

await test('opening an already-open workspace focuses, does not duplicate', async () => {
  const before = windowCount();
  const winId = await windowOpener.openWorkspace(ws.id);
  assert.equal(winId, seeded.id);
  assert.equal(windowCount(), before, 'no second window should be created');
});

await test('snapshot picks up a tab added to the live window and keeps tab ids stable', async () => {
  const idsBefore = (await workspaceManager.getWorkspace(ws.id)).tabs.map((t) => t.id);
  await chrome.tabs.create({ windowId: seeded.id, url: 'https://example.com/d', index: 3 });
  await tabSync.saveWorkspaceFromWindow(ws.id);
  const updated = await workspaceManager.getWorkspace(ws.id);
  assert.equal(updated.tabs.length, 4);
  assert.equal(updated.tabs[3].url, 'https://example.com/d');
  assert.deepEqual(updated.tabs.slice(0, 3).map((t) => t.id), idsBefore);
});

await test('tab ids survive navigation (live map, not URL matching)', async () => {
  const before = await workspaceManager.getWorkspace(ws.id);
  const live = getWindow(seeded.id).tabs[1];
  live.url = 'https://example.com/b-navigated';
  await tabSync.saveWorkspaceFromWindow(ws.id);
  const after = await workspaceManager.getWorkspace(ws.id);
  assert.equal(after.tabs[1].id, before.tabs[1].id);
  assert.equal(after.tabs[1].url, 'https://example.com/b-navigated');
});

await test('closing the workspace window releases the binding but keeps tabs', async () => {
  await windowOpener.closeWorkspace(ws.id);
  assert.equal(await windowRegistry.getWindowForWorkspace(ws.id), null);
  const stored = await workspaceManager.getWorkspace(ws.id);
  assert.equal(stored.tabs.length, 4, 'saved tabs must survive the window closing');
});

await test('reopening restores every tab in the saved order and window size', async () => {
  const newWinId = await windowOpener.openWorkspace(ws.id);
  const win = getWindow(newWinId);
  assert.deepEqual(win.tabs.map((t) => t.url), [
    'https://example.com/a',
    'https://example.com/b-navigated',
    'https://example.com/c',
    'https://example.com/d',
  ]);
  assert.equal(chrome.windows.lastCreateProps.width, 1000);
  assert.equal(chrome.windows.lastCreateProps.height, 700);
});

await test('opening records lastOpenedAt (MRU sorting works)', async () => {
  const before = (await workspaceManager.getWorkspace(ws.id)).lastOpenedAt;
  await new Promise((r) => setTimeout(r, 5));
  await windowOpener.closeWorkspace(ws.id);
  await windowOpener.openWorkspace(ws.id);
  const after = (await workspaceManager.getWorkspace(ws.id)).lastOpenedAt;
  assert.ok(after > before, 'lastOpenedAt must be persisted on open');
});

await test('pinned state survives a round trip', async () => {
  const winId = await windowRegistry.getWindowForWorkspace(ws.id);
  await chrome.tabs.update(getWindow(winId).tabs[0].id, { pinned: true });
  await tabSync.saveWorkspaceFromWindow(ws.id);
  await windowOpener.closeWorkspace(ws.id);
  const restoredWinId = await windowOpener.openWorkspace(ws.id);
  assert.equal(getWindow(restoredWinId).tabs[0].pinned, true);
});

await test('stale binding self-heals when a window dies while the worker sleeps', async () => {
  const windowId = await windowRegistry.getWindowForWorkspace(ws.id);
  closeWindowRaw(windowId);
  const newWinId = await windowOpener.openWorkspace(ws.id);
  assert.notEqual(newWinId, windowId, 'should open a fresh window, not focus a dead one');
});

await test('brave:// URLs are restored as chrome:// and unsafe schemes as new tab', async () => {
  assert.equal(sanitizeRestoreUrl('brave://settings/'), 'chrome://settings/');
  assert.equal(sanitizeRestoreUrl('javascript:alert(1)'), 'chrome://newtab/');
  assert.equal(sanitizeRestoreUrl(''), 'chrome://newtab/');
});

// ---------------------------------------------------------------------------
console.log('\nregressions (bugs fixed in 1.0)');

await test('an unmanaged window is never auto-bound to a workspace', async () => {
  const before = await workspaceManager.getWorkspace(ws.id);
  await windowOpener.closeWorkspace(ws.id);
  const stray = seedWindow(['https://unrelated.example/x']);
  await tabSync.triggerSyncForWindow(stray.id);
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(await windowRegistry.getWorkspaceForWindow(stray.id), null);
  const after = await workspaceManager.getWorkspace(ws.id);
  assert.deepEqual(after.tabs.map((t) => t.url), before.tabs.map((t) => t.url), 'saved tabs must not be overwritten');
  await chrome.windows.remove(stray.id);
});

await test('clicking a tab of an open workspace activates it instead of opening a duplicate', async () => {
  const winId = await windowOpener.openWorkspace(ws.id);
  const stored = await workspaceManager.getWorkspace(ws.id);
  const countBefore = getWindow(winId).tabs.length;
  await send(MESSAGE_TYPES.OPEN_TAB_IN_WORKSPACE, { workspaceId: ws.id, tabId: stored.tabs[2].id, url: stored.tabs[2].url });
  const win = getWindow(winId);
  assert.equal(win.tabs.length, countBefore, 'no duplicate tab');
  assert.equal(win.tabs.find((t) => t.active).url, stored.tabs[2].url);
});

await test('closing a tab of an open workspace closes the real tab', async () => {
  const winId = await windowRegistry.getWindowForWorkspace(ws.id);
  const stored = await workspaceManager.getWorkspace(ws.id);
  const target = stored.tabs[3];
  await send(MESSAGE_TYPES.CLOSE_TAB_IN_WORKSPACE, { workspaceId: ws.id, tabId: target.id });
  assert.ok(!getWindow(winId).tabs.some((t) => t.url === target.url));
  await tabSync.saveWorkspaceFromWindow(ws.id);
  assert.ok(!(await workspaceManager.getWorkspace(ws.id)).tabs.some((t) => t.id === target.id));
});

await test('closing the last tab of an open workspace keeps its window alive', async () => {
  const solo = seedWindow(['https://solo.example/']);
  const soloWs = await workspaceManager.createFromCurrentWindow(solo.id, 'Solo');
  await send(MESSAGE_TYPES.CLOSE_TAB_IN_WORKSPACE, { workspaceId: soloWs.id, tabId: soloWs.tabs[0].id });
  assert.ok(getWindow(solo.id), 'window must stay open');
  assert.equal(getWindow(solo.id).tabs.length, 1);
  await windowOpener.closeWorkspace(soloWs.id);
  await workspaceManager.deleteWorkspace(soloWs.id);
});

await test('two groups with the same title and color keep distinct ids', async () => {
  const win = seedWindow(['https://g.example/1', 'https://g.example/2', 'https://g.example/3', 'https://g.example/4']);
  const [t1, t2, t3, t4] = getWindow(win.id).tabs;
  const g1 = await chrome.tabs.group({ tabIds: [t1.id, t2.id] });
  const g2 = await chrome.tabs.group({ tabIds: [t3.id, t4.id] });
  await chrome.tabGroups.update(g1, { title: 'Docs', color: 'blue' });
  await chrome.tabGroups.update(g2, { title: 'Docs', color: 'blue' });
  const dupWs = await workspaceManager.createFromCurrentWindow(win.id, 'Dupes');
  assert.equal(dupWs.groups.length, 2);
  assert.notEqual(dupWs.groups[0].id, dupWs.groups[1].id);
  await tabSync.saveWorkspaceFromWindow(dupWs.id);
  const again = await workspaceManager.getWorkspace(dupWs.id);
  assert.equal(new Set(again.tabs.map((t) => t.groupId)).size, 2, 'tabs stay in their own group');
  await windowOpener.closeWorkspace(dupWs.id);
  await workspaceManager.deleteWorkspace(dupWs.id);
});

await test('collapsed tab groups are saved and restored collapsed', async () => {
  const win = seedWindow(['https://c.example/active', 'https://c.example/1', 'https://c.example/2']);
  const tabs = getWindow(win.id).tabs;
  const gid = await chrome.tabs.group({ tabIds: [tabs[1].id, tabs[2].id] });
  await chrome.tabGroups.update(gid, { title: 'Later', color: 'green', collapsed: true });
  const cws = await workspaceManager.createFromCurrentWindow(win.id, 'Collapse');
  assert.equal(cws.groups[0].collapsed, true);
  await windowOpener.closeWorkspace(cws.id);
  const newWin = await windowOpener.openWorkspace(cws.id);
  const restoredGid = getWindow(newWin).tabs[1].groupId;
  assert.equal(getGroup(restoredGid).collapsed, true);
  assert.equal(getGroup(restoredGid).title, 'Later');
  await windowOpener.closeWorkspace(cws.id);
  await workspaceManager.deleteWorkspace(cws.id);
});

await test('organizeTabs groups live tabs (correct tabs.group createProperties)', async () => {
  const win = seedWindow([
    'https://github.com/a', 'https://stackoverflow.com/q/1', 'https://youtube.com/watch?v=1', 'https://www.youtube.com/watch?v=2'
  ]);
  const res = await workspaceManager.organizeTabs({ windowId: win.id });
  assert.equal(res.live, true);
  assert.equal(res.groupsCreated, 2);
  await chrome.windows.remove(win.id);
});

await test('moving a stored tab of a closed workspace into an open one opens it there', async () => {
  const closed = await workspaceManager.createWorkspace({
    name: 'Closed', tabs: [{ url: 'https://closed.example/1' }, { url: 'https://closed.example/2' }]
  });
  const tabId = closed.tabs[1].id;
  await send(MESSAGE_TYPES.MOVE_TAB_TO_WORKSPACE, { tabId, targetWorkspaceId: ws.id, sourceWorkspaceId: closed.id });
  const winId = await windowRegistry.getWindowForWorkspace(ws.id);
  assert.ok(getWindow(winId).tabs.some((t) => t.url === 'https://closed.example/2'));
  const src = await workspaceManager.getWorkspace(closed.id);
  assert.equal(src.tabs.length, 1);
  await tabSync.saveWorkspaceFromWindow(ws.id);
  const target = await workspaceManager.getWorkspace(ws.id);
  assert.ok(target.tabs.some((t) => t.id === tabId), 'moved tab keeps its id');
  await workspaceManager.deleteWorkspace(closed.id);
});

await test('moving a live tab to a closed workspace stores it there and closes it here', async () => {
  const closed = await workspaceManager.createWorkspace({ name: 'Inbox', tabs: [{ url: 'https://inbox.example/' }] });
  const stored = await workspaceManager.getWorkspace(ws.id);
  const moving = stored.tabs.find((t) => !t.pinned);
  await send(MESSAGE_TYPES.MOVE_TAB_TO_WORKSPACE, { tabId: moving.id, targetWorkspaceId: closed.id, sourceWorkspaceId: ws.id });
  const winId = await windowRegistry.getWindowForWorkspace(ws.id);
  assert.ok(!getWindow(winId).tabs.some((t) => t.url === moving.url));
  const target = await workspaceManager.getWorkspace(closed.id);
  assert.ok(target.tabs.some((t) => t.url === moving.url));
  await workspaceManager.deleteWorkspace(closed.id);
});

await test('drag-merging two live tabs creates a group and returns its persistent id', async () => {
  await tabSync.flush(ws.id);
  const stored = await workspaceManager.getWorkspace(ws.id);
  const free = stored.tabs.filter((t) => !t.pinned && !t.groupId);
  assert.ok(free.length >= 2, 'needs two ungrouped tabs');
  // Another window has focus: the new group must still be created in the workspace's window
  const focusThief = seedWindow(['https://focus.example/'], { focused: true });
  const wsWinId = await windowRegistry.getWindowForWorkspace(ws.id);
  const countBefore = getWindow(wsWinId).tabs.length;
  const res = await send(MESSAGE_TYPES.MERGE_TABS_INTO_GROUP, {
    sourceWorkspaceId: ws.id, sourceTabId: free[0].id, targetWorkspaceId: ws.id, targetTabId: free[1].id
  });
  assert.equal(getWindow(wsWinId).tabs.length, countBefore, 'tabs must stay in the workspace window');
  assert.equal(getWindow(focusThief.id).tabs.length, 1, 'focused window must not receive the tabs');
  await chrome.windows.remove(focusThief.id);
  assert.equal(res.success, true);
  assert.equal(res.isNew, true);
  assert.equal(typeof res.groupId, 'string');
  const after = await workspaceManager.getWorkspace(ws.id);
  assert.ok(after.groups.some((g) => g.id === res.groupId));
  const liveA = await liveTabIdFor(ws.id, free[0].id);
  assert.notEqual((await chrome.tabs.get(liveA)).groupId, -1);

  await send(MESSAGE_TYPES.UPDATE_TAB_GROUP, { workspaceId: ws.id, groupId: res.groupId, title: 'Pair', color: 'pink' });
  const native = (await chrome.tabs.get(liveA)).groupId;
  assert.equal(getGroup(native).title, 'Pair');
  assert.equal(getGroup(native).color, 'pink');
  await send(MESSAGE_TYPES.UNGROUP_TABS, { workspaceId: ws.id, groupId: res.groupId });
  assert.equal((await chrome.tabs.get(liveA)).groupId, -1);
});

await test('concurrent writes do not clobber each other (mutation lock)', async () => {
  const a = await workspaceManager.createWorkspace({ name: 'A' });
  const b = await workspaceManager.createWorkspace({ name: 'B' });
  await Promise.all([
    workspaceManager.renameWorkspace(a.id, 'A2'),
    workspaceManager.renameWorkspace(b.id, 'B2'),
    workspaceManager.recolorWorkspace(a.id, 'red'),
    workspaceManager.updateWorkspace(b.id, { icon: '🚀' })
  ]);
  const state = await workspaceManager.loadState();
  assert.equal(state.workspaces[a.id].name, 'A2');
  assert.equal(state.workspaces[a.id].color, 'red');
  assert.equal(state.workspaces[b.id].name, 'B2');
  assert.equal(state.workspaces[b.id].icon, '🚀');
  await workspaceManager.deleteWorkspace(a.id);
  await workspaceManager.deleteWorkspace(b.id);
});

await test('large inline favicons are not persisted', async () => {
  const big = 'data:image/png;base64,' + 'A'.repeat(5000);
  const created = await workspaceManager.createWorkspace({ name: 'Fav', tabs: [{ url: 'https://f.example', favIconUrl: big }] });
  assert.equal(created.tabs[0].favIconUrl, '');
  await workspaceManager.deleteWorkspace(created.id);
});

await test('closeWindowOnWorkspaceSwitch closes the old window only after the new one exists', async () => {
  await workspaceManager.updateSettings({ closeWindowOnWorkspaceSwitch: true });
  const other = await workspaceManager.createWorkspace({ name: 'Other', tabs: [{ url: 'https://other.example/' }] });
  const oldWin = await windowRegistry.getWindowForWorkspace(ws.id);
  await windowRegistry.setActiveWorkspaceId(ws.id);
  const newWin = await windowOpener.openWorkspace(other.id);
  assert.ok(getWindow(newWin), 'new window open');
  assert.equal(getWindow(oldWin), undefined, 'old window closed');
  assert.equal(await windowRegistry.getPreviousWorkspaceId(), ws.id);
  await workspaceManager.updateSettings({ closeWindowOnWorkspaceSwitch: false });

  const res = await send(MESSAGE_TYPES.SWITCH_TO_LAST);
  assert.equal(res.switched, true);
  assert.equal(res.workspaceId, ws.id);
  await windowOpener.closeWorkspace(other.id);
  await workspaceManager.deleteWorkspace(other.id);
});

// ---------------------------------------------------------------------------
console.log('\ncrud & management');

await test('rename and recolor persist', async () => {
  await workspaceManager.renameWorkspace(ws.id, 'Coursework');
  await workspaceManager.recolorWorkspace(ws.id, 'purple');
  const found = await workspaceManager.getWorkspace(ws.id);
  assert.equal(found.name, 'Coursework');
  assert.equal(found.color, 'purple');
});

await test('invalid colors are rejected', async () => {
  await assert.rejects(() => workspaceManager.recolorWorkspace(ws.id, 'teal'));
});

await test('duplicate copies tabs into a new id', async () => {
  const source = await workspaceManager.getWorkspace(ws.id);
  const copy = await workspaceManager.duplicateWorkspace(ws.id);
  assert.notEqual(copy.id, ws.id);
  assert.equal(copy.name, 'Coursework (Copy)');
  assert.equal(copy.tabs.length, source.tabs.length);
  assert.equal(copy.color, 'purple');
  await workspaceManager.deleteWorkspace(copy.id);
});

await test('delete removes the workspace, leaves its window open, and can be undone', async () => {
  const target = await workspaceManager.createWorkspace({ name: 'Scratch' });
  const win = seedWindow(['https://example.com/keep']);
  await windowRegistry.bind(win.id, target.id);
  const before = windowCount();

  const res = await send(MESSAGE_TYPES.DELETE_WORKSPACE, { id: target.id });
  assert.equal(res.deleted, true);
  assert.ok(!(await workspaceManager.getWorkspace(target.id)));
  assert.equal(windowCount(), before, 'the window must stay open');
  assert.equal(await windowRegistry.getWorkspaceForWindow(win.id), null);

  const restored = await send(MESSAGE_TYPES.RESTORE_WORKSPACE, { workspace: res.workspace, index: res.index });
  const state = await workspaceManager.loadState();
  assert.equal(state.workspaceOrder[res.index], restored.id);
  await workspaceManager.deleteWorkspace(restored.id);
  await chrome.windows.remove(win.id);
});

await test('reorder is reflected in the listed order', async () => {
  await workspaceManager.createWorkspace({ name: 'Second' });
  const state = await workspaceManager.getState();
  const reversed = [...state.workspaceOrder].reverse();
  await workspaceManager.reorderWorkspaces(reversed);
  const after = await workspaceManager.getState();
  assert.deepEqual(after.workspaceOrder, reversed);
});

await test('new workspaces get an unused color', async () => {
  const state = await workspaceManager.loadState();
  const used = new Set(Object.values(state.workspaces).map((w) => w.color));
  const created = await workspaceManager.createWorkspace({ name: 'Auto color' });
  assert.ok(!used.has(created.color));
  await workspaceManager.deleteWorkspace(created.id);
});

// ---------------------------------------------------------------------------
console.log('\nimport, export, backups');

await test('export -> import (merge) adds workspaces without touching existing ones', async () => {
  const exported = await send(MESSAGE_TYPES.EXPORT);
  const countBefore = Object.keys(exported.workspaces).length;
  const res = await send(MESSAGE_TYPES.IMPORT, { payload: exported, mode: 'merge' });
  assert.equal(res.count, countBefore);
  const state = await workspaceManager.loadState();
  assert.equal(Object.keys(state.workspaces).length, countBefore * 2);
  assert.ok(state.workspaces[ws.id], 'original kept');
});

await test('import (replace) swaps everything and a backup allows going back', async () => {
  const before = await workspaceManager.loadState();
  const payload = { workspaces: { x: { id: 'x', name: 'Only', tabs: [{ url: 'https://only.example' }] } } };
  await send(MESSAGE_TYPES.IMPORT, { payload, mode: 'replace' });
  let state = await workspaceManager.loadState();
  assert.deepEqual(Object.keys(state.workspaces), ['x']);

  const list = await send(MESSAGE_TYPES.LIST_BACKUPS);
  const preImport = list.find((b) => b.reason === 'before-import');
  assert.ok(preImport, 'a before-import backup exists');
  await send(MESSAGE_TYPES.RESTORE_BACKUP, { id: preImport.id });
  state = await workspaceManager.loadState();
  assert.equal(Object.keys(state.workspaces).length, Object.keys(before.workspaces).length);
});

await test('import rejects files without workspaces', async () => {
  assert.throws(() => validateImportPayload({ foo: 1 }));
  assert.throws(() => validateImportPayload({ workspaces: {} }));
});

await test('identical consecutive backups are not duplicated', async () => {
  const first = await backups.create('manual');
  const second = await backups.create('manual');
  assert.equal(first, second);
});

await test('v1 data migrates (unknown settings dropped, defaults filled)', async () => {
  const migrated = migrateStorageData({
    schemaVersion: 1,
    settings: { autoSyncNewTabs: true, dragToGroupTabs: true, confirmDelete: false },
    workspaces: { w: { id: 'w', name: 'Old', color: 'teal', tabs: [{ url: 'https://o.example', groupId: 'g_gone' }], groups: [] } },
    workspaceOrder: ['w', 'w', 'missing']
  });
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.settings.confirmDelete, false);
  assert.equal(migrated.settings.autoSyncNewTabs, undefined);
  assert.equal(migrated.settings.sortOrder, 'manual');
  assert.equal(migrated.workspaces.w.color, 'blue');
  assert.equal(migrated.workspaces.w.tabs[0].groupId, null, 'dangling group refs dropped');
  assert.deepEqual(migrated.workspaceOrder, ['w']);
});

// ---------------------------------------------------------------------------
console.log('\nsession storage & recovery');

await test('bindings live in session storage, not module memory', async () => {
  assert.ok('windowBindings' in dumpSession());
});

await test('losing session storage does not lose workspaces', async () => {
  clearSession();
  const state = await workspaceManager.getState();
  assert.ok(Object.keys(state.workspaces).length > 0);
});

await test('startup matching pairs windows to the best workspace only', () => {
  const pairs = matchWindowsToWorkspaces(
    [
      { id: 1, tabs: [{ url: 'https://a.com/1' }, { url: 'https://a.com/2' }] },
      { id: 2, tabs: [{ url: 'https://b.com/1' }, { url: 'chrome://newtab/' }] },
      { id: 3, tabs: [{ url: 'https://zzz.com/' }] }
    ],
    [
      { id: 'A', tabs: [{ url: 'https://a.com/1' }, { url: 'https://a.com/2/' }] },
      { id: 'B', tabs: [{ url: 'https://www.b.com/1' }] }
    ]
  );
  assert.deepEqual(pairs.map((p) => [p.winId, p.wsId]).sort(), [[1, 'A'], [2, 'B']]);
});

await test('startup recovery rebinds a restored window', async () => {
  resetAll();
  const restoredWs = await workspaceManager.createWorkspace({
    name: 'Restored', tabs: [{ url: 'https://r.example/1' }, { url: 'https://r.example/2' }]
  });
  const win = seedWindow(['https://r.example/1', 'https://r.example/2']);
  const bound = await startupRecovery.runRecovery({ delays: [0] });
  assert.equal(bound.length, 1);
  assert.equal(await windowRegistry.getWorkspaceForWindow(win.id), restoredWs.id);
});

// ---------------------------------------------------------------------------
console.log('\nworker wiring');

await test('service worker loads; menus and badge follow the focused workspace', async () => {
  const { updateContextMenus, setupContextMenus, updateToolbarBadge } = await import('../src/background/service-worker.js');
  assert.equal(typeof setupContextMenus, 'function');
  await updateContextMenus({ force: true });
  assert.ok(chrome.contextMenus.items.some((i) => i.title === 'Restored'));

  const winId = (await chrome.windows.getLastFocused()).id;
  await updateToolbarBadge(winId);
  assert.equal(chrome.action.badge.text, 'RES');
  assert.match(chrome.action.badge.title, /Restored/);
});

await test('router rejects unknown message types', async () => {
  await assert.rejects(() => send('NOPE'));
});

await test('storage stays small: nothing but known keys in local', async () => {
  const keys = Object.keys(dumpLocal()).sort();
  for (const k of keys) assert.ok(['backups', 'schemaVersion', 'settings', 'workspaceOrder', 'workspaces'].includes(k), `unexpected key ${k}`);
});

console.log(`\n${passed} checks passed${failed ? `, ${failed} failed` : ''}\n`);
