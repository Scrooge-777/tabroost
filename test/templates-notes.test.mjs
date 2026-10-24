import assert from 'node:assert/strict';
import './harness.mjs';

const { workspaceManager } = await import('../src/background/workspace-manager.js');
const { templates, MAX_TEMPLATES } = await import('../src/background/templates.js');
const { handleMessage } = await import('../src/background/router.js');
const { sanitizeNotes, migrateStorageData } = await import('../src/shared/schema.js');
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

console.log('\nnotes');

await test('notes are trimmed, capped and kept through create, update and duplicate', async () => {
  assert.equal(sanitizeNotes('  hello\r\nworld  '), 'hello\nworld');
  assert.equal(sanitizeNotes('x'.repeat(900)).length, 500);
  assert.equal(sanitizeNotes(undefined), '');

  const ws = await send(MESSAGE_TYPES.CREATE_WORKSPACE, { name: 'Noted', notes: 'Finish chapter 3' });
  assert.equal(ws.notes, 'Finish chapter 3');
  const updated = await send(MESSAGE_TYPES.UPDATE_WORKSPACE, { id: ws.id, notes: 'Next: references' });
  assert.equal(updated.notes, 'Next: references');
  const untouched = await send(MESSAGE_TYPES.UPDATE_WORKSPACE, { id: ws.id, name: 'Renamed' });
  assert.equal(untouched.notes, 'Next: references', 'an update without notes keeps them');
  const copy = await send(MESSAGE_TYPES.DUPLICATE_WORKSPACE, { id: ws.id });
  assert.equal(copy.notes, 'Next: references');
});

await test('workspaces saved before notes existed load with empty notes', () => {
  const migrated = migrateStorageData({ workspaces: { old: { id: 'old', name: 'Old', tabs: [] } } });
  assert.equal(migrated.workspaces.old.notes, '');
});

console.log('\ntemplates');

const source = await workspaceManager.createWorkspace({
  name: 'Research',
  color: 'purple',
  icon: '📚',
  notes: 'Start here',
  groups: [{ id: 'g1', title: 'Papers', color: 'green' }],
  tabs: [
    { id: 't1', url: 'https://scholar.test/', title: 'Scholar', pinned: true, groupId: null },
    { id: 't2', url: 'https://paper.test/a', title: 'Paper A', groupId: 'g1' },
    { id: 't3', url: 'https://paper.test/b', title: 'Paper B', groupId: 'g1' }
  ]
});

let templateId;

await test('a workspace can be saved as a template and listed', async () => {
  const saved = await send(MESSAGE_TYPES.SAVE_TEMPLATE, { workspaceId: source.id });
  templateId = saved.id;
  assert.equal(saved.name, 'Research');
  assert.equal(saved.tabCount, 3);
  assert.equal(saved.groupCount, 1);
  const listed = (await send(MESSAGE_TYPES.LIST_WORKSPACES)).templates;
  assert.deepEqual(listed.map((t) => t.id), [templateId]);
});

await test('creating from a template gives an independent workspace with fresh ids', async () => {
  const ws = await send(MESSAGE_TYPES.CREATE_FROM_TEMPLATE, { id: templateId });
  assert.notEqual(ws.id, source.id);
  assert.equal(ws.color, 'purple');
  assert.equal(ws.icon, '📚');
  assert.equal(ws.notes, 'Start here');
  assert.deepEqual(ws.tabs.map((t) => t.url), source.tabs.map((t) => t.url));
  assert.equal(ws.tabs[0].pinned, true);
  assert.ok(ws.tabs.every((t, i) => t.id !== source.tabs[i].id), 'tab ids are new');
  assert.equal(ws.groups.length, 1);
  assert.notEqual(ws.groups[0].id, source.groups[0].id);
  assert.equal(ws.tabs[1].groupId, ws.groups[0].id);
  assert.equal(ws.tabs[2].groupId, ws.groups[0].id);

  // Changing the source afterwards does not change the template
  await workspaceManager.mutate((state) => {
    state.workspaces[source.id].tabs = state.workspaces[source.id].tabs.slice(0, 1);
    return true;
  });
  const again = await send(MESSAGE_TYPES.CREATE_FROM_TEMPLATE, { id: templateId, name: 'Second run' });
  assert.equal(again.name, 'Second run');
  assert.equal(again.tabs.length, 3);
});

await test('templates can be deleted, and a missing one fails clearly', async () => {
  const res = await send(MESSAGE_TYPES.DELETE_TEMPLATE, { id: templateId });
  assert.equal(res.deleted, true);
  assert.equal((await send(MESSAGE_TYPES.DELETE_TEMPLATE, { id: templateId })).deleted, false);
  await assert.rejects(() => send(MESSAGE_TYPES.CREATE_FROM_TEMPLATE, { id: templateId }), /no longer exists/);
});

await test('the template count is capped', async () => {
  for (let i = 0; i < MAX_TEMPLATES; i++) await templates.saveFromWorkspace(source.id, `T${i}`);
  await assert.rejects(() => templates.saveFromWorkspace(source.id, 'one too many'), /up to 20/);
});

console.log(`\n${passed} checks passed${failed ? `, ${failed} failed` : ''}\n`);
