import assert from 'node:assert/strict';
import { getWindow, windowCount } from './harness.mjs';

const { workspaceManager } = await import('../src/background/workspace-manager.js');
const { history, MAX_VERSIONS_PER_WORKSPACE } = await import('../src/background/history.js');
const { windowRegistry } = await import('../src/background/window-registry.js');
const { handleMessage } = await import('../src/background/router.js');
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
const tab = (url, i) => ({ id: `t${i}-${url}`, url, title: url, index: i });

async function setTabs(id, urls) {
  await workspaceManager.mutate((state) => {
    state.workspaces[id].tabs = urls.map((u, i) => ({ ...tab(u, i), favIconUrl: '', pinned: false, groupId: null, active: i === 0 }));
    state.workspaces[id].updatedAt = Date.now();
    return true;
  });
}

console.log('\nworkspace history');

const ws = await workspaceManager.createWorkspace({ name: 'History check', tabs: [tab('https://a.test/', 0)] });

await test('first change is recorded, identical state is not', async () => {
  assert.ok(await history.record(ws.id, 'auto'));
  assert.equal(await history.record(ws.id, 'auto', { force: true }), null);
  assert.equal((await history.list(ws.id)).length, 1);
});

await test('automatic versions are rate limited, manual ones are not', async () => {
  await setTabs(ws.id, ['https://a.test/', 'https://b.test/']);
  assert.equal(await history.record(ws.id, 'auto'), null, 'auto version inside the interval');
  assert.ok(await history.record(ws.id, 'manual', { force: true }));
  const versions = await history.list(ws.id);
  assert.equal(versions.length, 2);
  assert.equal(versions[0].reason, 'manual');
});

await test('list reports what changed against the previous version', async () => {
  await setTabs(ws.id, ['https://b.test/', 'https://c.test/', 'https://d.test/']);
  await history.record(ws.id, 'manual', { force: true });
  const [newest, middle, oldest] = await history.list(ws.id);
  assert.deepEqual([newest.tabCount, newest.added, newest.removed], [3, 2, 1]);
  assert.deepEqual([middle.tabCount, middle.added, middle.removed], [2, 1, 0]);
  assert.equal(oldest.first, true);
});

await test('restoring a version brings the tabs back and keeps the previous state as a version', async () => {
  const versions = await history.list(ws.id);
  const oldest = versions[versions.length - 1];
  const res = await send(MESSAGE_TYPES.RESTORE_VERSION, { workspaceId: ws.id, versionId: oldest.id });
  assert.equal(res.restored, true);
  assert.equal(res.reopened, false);
  const state = await workspaceManager.loadState();
  assert.deepEqual(state.workspaces[ws.id].tabs.map((t) => t.url), ['https://a.test/']);
  const after = await history.list(ws.id);
  assert.equal(after[0].tabCount, 3);
});

await test('restoring an open workspace reopens its window with the old tabs', async () => {
  const open = await workspaceManager.createWorkspace({ name: 'Open restore', tabs: [tab('https://one.test/', 0), tab('https://two.test/', 1)] });
  await history.record(open.id, 'manual', { force: true });
  await setTabs(open.id, ['https://three.test/']);
  await history.record(open.id, 'manual', { force: true });

  await send(MESSAGE_TYPES.OPEN_WORKSPACE, { id: open.id });
  const before = windowCount();
  const versions = await history.list(open.id);
  const first = versions[versions.length - 1];
  const res = await send(MESSAGE_TYPES.RESTORE_VERSION, { workspaceId: open.id, versionId: first.id });
  assert.equal(res.reopened, true);
  assert.equal(windowCount(), before, 'old window closed, new one opened');
  const winId = await windowRegistry.getWindowForWorkspace(open.id);
  assert.ok(winId !== null);
  assert.deepEqual(getWindow(winId).tabs.map((t) => t.url), ['https://one.test/', 'https://two.test/']);
});

await test('only the newest versions are kept', async () => {
  const many = await workspaceManager.createWorkspace({ name: 'Many', tabs: [tab('https://x.test/0', 0)] });
  for (let i = 0; i < MAX_VERSIONS_PER_WORKSPACE + 5; i++) {
    await setTabs(many.id, [`https://x.test/${i}`]);
    await history.record(many.id, 'manual', { force: true });
  }
  assert.equal((await history.list(many.id)).length, MAX_VERSIONS_PER_WORKSPACE);
});

await test('history of a deleted workspace survives undo, then is pruned', async () => {
  const gone = await workspaceManager.createWorkspace({ name: 'Gone', tabs: [tab('https://gone.test/', 0)] });
  await history.record(gone.id, 'manual', { force: true });
  const removed = await send(MESSAGE_TYPES.DELETE_WORKSPACE, { id: gone.id });
  assert.equal((await history.list(gone.id)).length, 1, 'kept for undo');
  await send(MESSAGE_TYPES.RESTORE_WORKSPACE, { workspace: removed.workspace, index: removed.index });
  assert.equal((await history.list(gone.id)).length, 1);

  await send(MESSAGE_TYPES.DELETE_WORKSPACE, { id: gone.id });
  await workspaceManager.mutate((state) => { delete state.tombstones[gone.id]; return true; });
  await history.record(ws.id, 'manual', { force: true });
  assert.equal((await history.list(gone.id)).length, 0, 'pruned once the deletion is forgotten');
});

await test('restoring an unknown version fails clearly', async () => {
  await assert.rejects(() => send(MESSAGE_TYPES.RESTORE_VERSION, { workspaceId: ws.id, versionId: 'nope' }), /no longer exists/);
});

console.log(`\n${passed} checks passed${failed ? `, ${failed} failed` : ''}\n`);
