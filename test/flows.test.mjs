import assert from 'node:assert/strict';
import { seedWindow, getWindow, windowCount, closeWindowRaw, clearSession, dumpSession } from './harness.mjs';

const { workspaceManager } = await import('../src/background/workspace-manager.js');
const { windowOpener } = await import('../src/background/window-opener.js');
const { windowRegistry } = await import('../src/background/window-registry.js');
const { tabSync } = await import('../src/background/tab-sync.js');
const { storage } = await import('../src/shared/storage.js');
const { MESSAGE_TYPES } = await import('../src/shared/constants.js');

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  pass  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}\n        ${err.message}`);
    process.exitCode = 1;
  }
}

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

await test('binds the saved window immediately in session storage', async () => {
  const bound = await windowRegistry.getWindowForWorkspace(ws.id);
  assert.equal(bound, seeded.id);
});

await test('lists the workspace as open and active', async () => {
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

await test('snapshot picks up a tab added to the live window', async () => {
  await chrome.tabs.create({ windowId: seeded.id, url: 'https://example.com/d', index: 3 });
  await tabSync.saveWorkspaceFromWindow(ws.id);
  const updated = await workspaceManager.getWorkspace(ws.id);
  assert.equal(updated.tabs.length, 4);
  assert.equal(updated.tabs[3].url, 'https://example.com/d');
});

await test('closing the workspace window releases the binding but keeps tabs', async () => {
  await windowOpener.closeWorkspace(ws.id);
  assert.equal(await windowRegistry.getWindowForWorkspace(ws.id), null);
  const stored = await workspaceManager.getWorkspace(ws.id);
  assert.equal(stored.tabs.length, 4, 'saved tabs must survive the window closing');
});

await test('reopening restores every tab in the saved order', async () => {
  const newWinId = await windowOpener.openWorkspace(ws.id);
  const win = getWindow(newWinId);
  assert.equal(win.tabs.length, 4);
  assert.deepEqual(win.tabs.map((t) => t.url), [
    'https://example.com/a',
    'https://example.com/b',
    'https://example.com/c',
    'https://example.com/d',
  ]);
});

await test('pinned state survives a round trip', async () => {
  const winId = await windowRegistry.getWindowForWorkspace(ws.id);
  const win = getWindow(winId);
  await chrome.tabs.update(win.tabs[0].id, { pinned: true });
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

console.log('\ncrud & management');

await test('rename and recolor persist', async () => {
  await workspaceManager.renameWorkspace(ws.id, 'Coursework');
  await workspaceManager.recolorWorkspace(ws.id, 'purple');
  const found = await workspaceManager.getWorkspace(ws.id);
  assert.equal(found.name, 'Coursework');
  assert.equal(found.color, 'purple');
});

await test('duplicate copies tabs into a new id', async () => {
  const copy = await workspaceManager.duplicateWorkspace(ws.id);
  assert.notEqual(copy.id, ws.id);
  assert.equal(copy.name, 'Coursework (Copy)');
  assert.equal(copy.tabs.length, 4);
  assert.equal(copy.color, 'purple');
});

await test('delete removes the workspace and leaves its window open', async () => {
  const target = await workspaceManager.createWorkspace({ name: 'Scratch' });
  const win = seedWindow(['https://example.com/keep']);
  await windowRegistry.bind(win.id, target.id);
  const before = windowCount();

  await workspaceManager.deleteWorkspace(target.id);
  const state = await workspaceManager.getState();
  assert.ok(!state.workspaces[target.id]);
  assert.equal(windowCount(), before, 'the window must stay open');
  assert.equal(await windowRegistry.getWorkspaceForWindow(win.id), null);
});

await test('reorder is reflected in the listed order', async () => {
  const state = await workspaceManager.getState();
  const reversed = [...state.workspaceOrder].reverse();
  await workspaceManager.reorderWorkspaces(reversed);
  const after = await workspaceManager.getState();
  assert.deepEqual(after.workspaceOrder, reversed);
});

console.log('\nsession storage contract');

await test('bindings live in session storage, not module memory', async () => {
  const session = dumpSession();
  assert.ok('windowBindings' in session, 'windowBindings must be persisted to storage.session');
});

await test('losing session storage does not lose workspaces', async () => {
  clearSession();
  const state = await workspaceManager.getState();
  assert.ok(Object.keys(state.workspaces).length > 0, 'workspaces are in storage.local and must survive');
});

console.log('\nadvanced features');

await test('closeTabInWorkspace removes a specific tab from stored workspace', async () => {
  const targetWs = await workspaceManager.getWorkspace(ws.id);
  const initialCount = targetWs.tabs.length;
  const tabToRemove = targetWs.tabs[0];
  await workspaceManager.closeTabInWorkspace(ws.id, tabToRemove.id);
  const updatedWs = await workspaceManager.getWorkspace(ws.id);
  assert.equal(updatedWs.tabs.length, initialCount - 1);
});

await test('settings update persists changes in storage', async () => {
  const current = await workspaceManager.getState();
  const nextSettings = { ...current.settings, closeWindowOnWorkspaceSwitch: true };
  await storage.setLocal({ settings: nextSettings });
  const updated = await workspaceManager.getState();
  assert.equal(updated.settings.closeWindowOnWorkspaceSwitch, true);
});

await test('mergeTabsIntoGroup merges two tabs into a tab group', async () => {
  const targetWs = await workspaceManager.getWorkspace(ws.id);
  assert.ok(targetWs.tabs.length >= 2, 'workspace has at least 2 tabs');
  const tabA = targetWs.tabs[0];
  const tabB = targetWs.tabs[1];

  const result = await workspaceManager.mergeTabsIntoGroup({
    sourceWorkspaceId: ws.id,
    sourceTabId: tabA.id,
    targetWorkspaceId: ws.id,
    targetTabId: tabB.id
  });

  assert.ok(result.success, 'merge should succeed');
  assert.ok(result.groupId, 'merge should return groupId');
  assert.equal(result.isNew, true, 'merge should report isNew: true for newly created group');
  const updatedWs = await workspaceManager.getWorkspace(ws.id);
  const updatedTabA = updatedWs.tabs.find((t) => t.id === tabA.id);
  const updatedTabB = updatedWs.tabs.find((t) => t.id === tabB.id);
  assert.ok(updatedTabA.groupId, 'tabA should have a groupId');
  assert.equal(updatedTabA.groupId, updatedTabB.groupId, 'both tabs should share the same groupId');
});

await test('autoSyncNewTabs and dragToGroupTabs settings persist properly', async () => {
  const current = await workspaceManager.getState();
  const nextSettings = {
    ...current.settings,
    autoSyncNewTabs: true,
    dragToGroupTabs: true
  };
  await storage.setLocal({ settings: nextSettings });
  const updated = await workspaceManager.getState();
  assert.equal(updated.settings.autoSyncNewTabs, true);
  assert.equal(updated.settings.dragToGroupTabs, true);
});

await test('organizeTabs clusters tabs into smart color-coded groups', async () => {
  const testWs = await workspaceManager.createWorkspace({
    name: 'OrgTest',
    color: 'blue',
    tabs: [
      { id: 't1', title: 'GitHub Repo', url: 'https://github.com/brave/brave-browser' },
      { id: 't2', title: 'Stack Overflow', url: 'https://stackoverflow.com/questions/123' },
      { id: 't3', title: 'YouTube Music', url: 'https://music.youtube.com' },
      { id: 't4', title: 'YouTube Video', url: 'https://youtube.com/watch?v=abc' }
    ]
  });

  const res = await workspaceManager.organizeTabs({ workspaceId: testWs.id });
  assert.ok(res.success, 'organizeTabs should succeed');
  assert.ok(res.groupsCreated >= 2, 'should create at least 2 groups (Development and Media)');

  const updated = await workspaceManager.getWorkspace(testWs.id);
  assert.ok(updated.groups && updated.groups.length >= 2, 'workspace should have at least 2 groups');
  const devGroup = updated.groups.find((g) => g.title === 'Development');
  const mediaGroup = updated.groups.find((g) => g.title === 'Media');
  assert.ok(devGroup, 'Development group should exist');
  assert.ok(mediaGroup, 'Media group should exist');
});

await test('updateTabGroup updates title and color of a tab group in workspace', async () => {
  const targetWs = await workspaceManager.getWorkspace(ws.id);
  assert.ok(targetWs.groups && targetWs.groups.length > 0, 'workspace has a group');
  const targetGroup = targetWs.groups[0];

  const res = await workspaceManager.updateTabGroup({
    workspaceId: ws.id,
    groupId: targetGroup.id,
    title: 'Research Group',
    color: 'orange'
  });

  assert.ok(res.success, 'updateTabGroup should succeed');
  assert.equal(res.group.title, 'Research Group');
  assert.equal(res.group.color, 'orange');

  const refreshedWs = await workspaceManager.getWorkspace(ws.id);
  const updatedGrp = refreshedWs.groups.find((g) => g.id === targetGroup.id);
  assert.equal(updatedGrp.title, 'Research Group');
  assert.equal(updatedGrp.color, 'orange');
});

await test('addTabToGroup adds an ungrouped tab to an existing group in a workspace', async () => {
  const targetWs = await workspaceManager.getWorkspace(ws.id);
  const targetGroup = targetWs.groups[0];

  // Add a new tab to workspace
  const newTab = { id: 'tab_join_test', title: 'Joined Tab', url: 'https://brave.com' };
  targetWs.tabs.push(newTab);
  await workspaceManager.saveWorkspaces({ [ws.id]: targetWs });

  const res = await workspaceManager.addTabToGroup({
    workspaceId: ws.id,
    tabId: newTab.id,
    groupId: targetGroup.id
  });

  assert.ok(res.success, 'addTabToGroup should succeed');
  const refreshedWs = await workspaceManager.getWorkspace(ws.id);
  const foundTab = refreshedWs.tabs.find((t) => t.id === newTab.id);
  assert.equal(foundTab.groupId, targetGroup.id, 'tab should now have the target group ID');
});

await test('ungroupTabs removes group and clears groupId from member tabs', async () => {
  const targetWs = await workspaceManager.getWorkspace(ws.id);
  const targetGroup = targetWs.groups[0];
  assert.ok(targetGroup, 'target group exists');

  const res = await workspaceManager.ungroupTabs({
    workspaceId: ws.id,
    groupId: targetGroup.id
  });

  assert.ok(res.success, 'ungroupTabs should succeed');
  const refreshedWs = await workspaceManager.getWorkspace(ws.id);
  const groupStillExists = (refreshedWs.groups || []).some((g) => g.id === targetGroup.id);
  assert.equal(groupStillExists, false, 'group should be removed from workspace.groups');

  const memberTabsWithGid = (refreshedWs.tabs || []).filter((t) => t.groupId === targetGroup.id);
  assert.equal(memberTabsWithGid.length, 0, 'all member tabs should have their groupId cleared');
});

await test('removeTabFromGroup ungroups only a single tab from a group', async () => {
  const targetWs = await workspaceManager.getWorkspace(ws.id);
  const gid = 'test_group_remove';
  targetWs.groups = targetWs.groups || [];
  targetWs.groups.push({ id: gid, title: 'Pair', color: 'blue' });
  targetWs.tabs[0].groupId = gid;
  targetWs.tabs[1].groupId = gid;
  await workspaceManager.saveWorkspaces({ [ws.id]: targetWs });

  const res = await workspaceManager.removeTabFromGroup({
    workspaceId: ws.id,
    tabId: targetWs.tabs[0].id
  });

  assert.ok(res.success, 'removeTabFromGroup should succeed');
  const refreshedWs = await workspaceManager.getWorkspace(ws.id);
  const tab0 = refreshedWs.tabs.find((t) => t.id === targetWs.tabs[0].id);
  const tab1 = refreshedWs.tabs.find((t) => t.id === targetWs.tabs[1].id);

  assert.ok(!tab0.groupId, 'tab0 should have groupId removed');
  assert.equal(tab1.groupId, gid, 'tab1 should remain in the group');
  assert.ok(refreshedWs.groups.some((g) => g.id === gid), 'group should still exist with remaining tab');

  // Now remove the second (last) tab from the group
  const res2 = await workspaceManager.removeTabFromGroup({
    workspaceId: ws.id,
    tabId: targetWs.tabs[1].id
  });
  assert.ok(res2.success, 'removeTabFromGroup for last tab should succeed');
  const refreshedWs2 = await workspaceManager.getWorkspace(ws.id);
  const tab1After = refreshedWs2.tabs.find((t) => t.id === targetWs.tabs[1].id);
  assert.ok(!tab1After.groupId, 'tab1 should have groupId removed');
  assert.equal(refreshedWs2.groups.some((g) => g.id === gid), false, 'empty group should be cleaned up from workspace.groups');
});

await test('setupContextMenus and updateContextMenus execute without error', async () => {
  const { updateContextMenus, setupContextMenus, updateToolbarBadge } = await import('../src/background/service-worker.js');
  assert.equal(typeof updateContextMenus, 'function');
  assert.equal(typeof setupContextMenus, 'function');
  assert.equal(typeof updateToolbarBadge, 'function');
  await updateContextMenus();
  await setupContextMenus();
  await updateToolbarBadge();
});

console.log(`\n${passed} checks passed\n`);


