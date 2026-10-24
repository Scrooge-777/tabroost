import assert from 'node:assert/strict';
import { clearSession, closeWindowRaw, windowCount } from './harness.mjs';

const { workspaceManager } = await import('../src/background/workspace-manager.js');
const { sessionRestore } = await import('../src/background/session-restore.js');
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
const tab = (url, i) => ({ id: `t${i}`, url, title: url, index: i });
const mk = (name, url) => workspaceManager.createWorkspace({ name, tabs: [tab(url, 0)] });

console.log('\nsession restore');

const a = await mk('A', 'https://a.test/');
const b = await mk('B', 'https://b.test/');
const c = await mk('C', 'https://c.test/');

async function simulateRestart() {
  for (const winId of Object.keys(await windowRegistry.getAllBindings())) closeWindowRaw(Number(winId));
  clearSession(); // session storage does not survive a browser restart
}

await test('open workspaces are remembered and offered again after a restart', async () => {
  await send(MESSAGE_TYPES.OPEN_WORKSPACE, { id: a.id });
  await send(MESSAGE_TYPES.OPEN_WORKSPACE, { id: b.id });
  await sessionRestore.remember();

  await simulateRestart();
  const pending = await sessionRestore.prepareOnStartup();
  assert.deepEqual([...pending].sort(), [a.id, b.id].sort());
  const listed = await send(MESSAGE_TYPES.LIST_WORKSPACES);
  assert.deepEqual([...listed.pendingRestore].sort(), [a.id, b.id].sort());
  assert.ok(!listed.pendingRestore.includes(c.id));
});

await test('a workspace the browser already brought back is not offered', async () => {
  await simulateRestart();
  await sessionRestore.remember(); // nothing is bound now, so the last session would be empty
  // Put the saved session back as it was before the restart
  await send(MESSAGE_TYPES.OPEN_WORKSPACE, { id: a.id });
  await send(MESSAGE_TYPES.OPEN_WORKSPACE, { id: b.id });
  await sessionRestore.remember();
  await simulateRestart();

  // The browser restores A on its own, and startup recovery rebinds it
  await send(MESSAGE_TYPES.OPEN_WORKSPACE, { id: a.id });
  const pending = await sessionRestore.prepareOnStartup();
  assert.deepEqual(pending, [b.id]);
});

await test('reopening opens a window per pending workspace and clears the offer', async () => {
  const before = windowCount();
  const res = await send(MESSAGE_TYPES.RESTORE_SESSION);
  assert.equal(res.opened, 1);
  assert.equal(windowCount(), before + 1);
  assert.deepEqual(await sessionRestore.getPending(), []);
});

await test('dismissing clears the offer without opening anything', async () => {
  await simulateRestart();
  await send(MESSAGE_TYPES.OPEN_WORKSPACE, { id: c.id });
  await sessionRestore.remember();
  await simulateRestart();
  assert.deepEqual(await sessionRestore.prepareOnStartup(), [c.id]);
  const before = windowCount();
  await send(MESSAGE_TYPES.DISMISS_SESSION_RESTORE);
  assert.deepEqual(await sessionRestore.getPending(), []);
  assert.equal(windowCount(), before);
});

await test('deleted workspaces are never offered', async () => {
  await simulateRestart();
  await send(MESSAGE_TYPES.OPEN_WORKSPACE, { id: b.id });
  await sessionRestore.remember();
  await simulateRestart();
  await send(MESSAGE_TYPES.DELETE_WORKSPACE, { id: b.id });
  assert.deepEqual(await sessionRestore.prepareOnStartup(), []);
});

console.log(`\n${passed} checks passed${failed ? `, ${failed} failed` : ''}\n`);
