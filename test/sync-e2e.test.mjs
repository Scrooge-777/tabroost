/**
 * End-to-end sync tests: the real SyncEngine, workspace manager and crypto against an
 * in-memory fake of the GitHub Gist API. Two "devices" are two snapshots of storage.
 */

import assert from 'node:assert/strict';
import { resetAll } from './harness.mjs';

const { workspaceManager } = await import('../src/background/workspace-manager.js');
const { SyncEngine, mergeState, SyncHttpError } = await import('../src/background/sync-engine.js');
const { setSyncSecrets, getSyncSecrets, migrateLegacySecrets } = await import('../src/shared/secrets.js');
const { decryptPayload } = await import('../src/shared/crypto.js');
const { sanitizeSyncPayload } = await import('../src/shared/schema.js');
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

const PASS = 'correct horse battery';
const TOKEN = 'ghp_testtoken';

function fakeGistServer() {
  const server = {
    gists: {},
    clock: 1,
    calls: [],
    failNext: null,
    afterFirstGet: null,
    fetch: async (url, options = {}) => {
      const method = options.method || 'GET';
      server.calls.push(`${method} ${url}`);
      const json = (status, body, headers = {}) => ({
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (k) => headers[k.toLowerCase()] ?? null },
        json: async () => body,
        text: async () => JSON.stringify(body)
      });
      if (server.failNext) {
        const failure = server.failNext;
        server.failNext = null;
        return json(failure.status, { message: failure.message || 'fail' }, failure.headers);
      }
      const auth = options.headers?.Authorization;
      if (auth !== `Bearer ${TOKEN}`) return json(401, { message: 'Bad credentials' });

      if (method === 'POST' && url.endsWith('/gists')) {
        const id = `gist${Object.keys(server.gists).length + 1}`;
        server.gists[id] = { files: JSON.parse(options.body).files, updated_at: `t${server.clock++}` };
        return json(201, { id });
      }
      const id = url.split('/gists/')[1];
      const gist = server.gists[id];
      if (!gist) return json(404, { message: 'Not Found' });
      if (method === 'PATCH') {
        Object.assign(gist.files, JSON.parse(options.body).files);
        gist.updated_at = `t${server.clock++}`;
        return json(200, { id });
      }
      const body = { id, files: gist.files, updated_at: gist.updated_at };
      const once = server.afterFirstGet;
      if (once) {
        server.afterFirstGet = null;
        // Another device writes right after we read
        queueMicrotask(once);
      }
      return json(200, body);
    }
  };
  return server;
}

const snapshot = async () => ({
  local: await chrome.storage.local.get(null),
  session: await chrome.storage.session.get(null)
});
async function load(snap) {
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  await chrome.storage.local.set(snap.local);
  await chrome.storage.session.set(snap.session);
}

async function configure(extra = {}) {
  await workspaceManager.updateSettings({ syncEnabled: true, ...extra });
  await setSyncSecrets({ token: TOKEN, passphrase: PASS }, false);
}

const names = async () => {
  const s = await workspaceManager.loadState();
  return s.workspaceOrder.map((id) => s.workspaces[id].name);
};

// ---------------------------------------------------------------------------
console.log('\nmergeState');

await test('tombstone beats an older workspace but not a newer edit', () => {
  const ws = (id, updatedAt) => ({ id, name: id, updatedAt, createdAt: 1 });
  const merged = mergeState(
    { workspaces: { a: ws('a', 100), b: ws('b', 500) }, workspaceOrder: ['a', 'b'], tombstones: {} },
    { workspaces: {}, workspaceOrder: [], tombstones: { a: 200, b: 200 } },
    300
  );
  assert.deepEqual(Object.keys(merged.workspaces), ['b']);
  assert.deepEqual(merged.workspaceOrder, ['b']);
  assert.equal(merged.tombstones.a, 200);
  assert.equal(merged.tombstones.b, undefined);
});

await test('expired tombstones are dropped', () => {
  const day = 24 * 60 * 60 * 1000;
  const merged = mergeState({ tombstones: { old: 1 } }, {}, 40 * day);
  assert.deepEqual(merged.tombstones, {});
});

// ---------------------------------------------------------------------------
console.log('\nsync end to end');

const server = fakeGistServer();
const engine = new SyncEngine(server.fetch);
let deviceA;
let deviceB;

await test('first sync creates a secret gist holding only ciphertext', async () => {
  resetAll();
  await configure();
  await workspaceManager.createWorkspace({ name: 'Research' });
  await workspaceManager.createWorkspace({ name: 'Writing' });

  const res = await engine.syncNow();
  assert.equal(res.status, 'success');
  assert.equal(res.workspaceCount, 2);

  const stored = Object.values(server.gists)[0].files['tabroost-workspaces.enc'].content;
  assert.ok(!stored.includes('Research'), 'plaintext leaked to the gist');
  const envelope = JSON.parse(stored);
  assert.equal(envelope.version, 2);
  assert.equal(envelope.kdf.iterations, 600000);

  const settings = (await workspaceManager.loadState()).settings;
  assert.ok(settings.syncGistId);
  assert.ok(settings.lastSyncedAt);
  deviceA = await snapshot();
});

await test('second device receives the workspaces', async () => {
  resetAll();
  const gistId = Object.keys(server.gists)[0];
  await configure({ syncGistId: gistId });
  await engine.syncNow();
  assert.deepEqual((await names()).sort(), ['Research', 'Writing']);
  deviceB = await snapshot();
});

await test('a deletion on one device is not undone by the other', async () => {
  await load(deviceB);
  const state = await workspaceManager.loadState();
  const writingId = state.workspaceOrder.find((id) => state.workspaces[id].name === 'Writing');
  await workspaceManager.deleteWorkspace(writingId);
  await engine.syncNow();
  deviceB = await snapshot();

  await load(deviceA);
  await engine.syncNow();
  assert.deepEqual(await names(), ['Research']);
  deviceA = await snapshot();

  await load(deviceB);
  await engine.syncNow();
  assert.deepEqual(await names(), ['Research'], 'deleted workspace came back');
});

await test('undoing a delete brings the workspace back everywhere', async () => {
  await load(deviceA);
  const created = await workspaceManager.createWorkspace({ name: 'Temp' });
  await engine.syncNow();
  const removed = await workspaceManager.deleteWorkspace(created.id);
  await engine.syncNow();
  await workspaceManager.restoreWorkspace(removed.workspace, removed.index);
  await engine.syncNow();
  assert.ok((await names()).includes('Temp'));
  deviceA = await snapshot();

  await load(deviceB);
  await engine.syncNow();
  assert.ok((await names()).includes('Temp'));
  deviceB = await snapshot();
});

await test('edits made while the request is in flight are kept', async () => {
  await load(deviceA);
  const slowEngine = new SyncEngine(async (url, options) => {
    const res = await server.fetch(url, options);
    if ((options?.method || 'GET') === 'GET') {
      await workspaceManager.createWorkspace({ name: 'Made during sync' });
    }
    return res;
  });
  await slowEngine.syncNow();
  assert.ok((await names()).includes('Made during sync'));
  assert.ok((await names()).includes('Research'));
});

await test('a write by another device mid-sync is merged, not overwritten', async () => {
  await load(deviceB);
  const other = await workspaceManager.createWorkspace({ name: 'From device B' });
  const before = server.calls.length;

  server.afterFirstGet = async () => {
    // Device A pushes a new workspace into the gist
    const snapB = await snapshot();
    await load(deviceA);
    await workspaceManager.createWorkspace({ name: 'From device A' });
    const a = new SyncEngine(server.fetch);
    await a.syncNow();
    deviceA = await snapshot();
    await load(snapB);
  };
  const res = await engine.syncNow();
  assert.equal(res.status, 'success');
  assert.ok(server.calls.length - before > 3, 'expected a retry round');

  await load(deviceA);
  await engine.syncNow();
  const finalNames = await names();
  assert.ok(finalNames.includes('From device A'));
  assert.ok(finalNames.includes('From device B') || other.name === 'From device B');
});

await test('wrong passphrase fails without touching local data', async () => {
  await load(deviceB);
  const before = await names();
  await setSyncSecrets({ passphrase: 'a different passphrase' }, false);
  await assert.rejects(() => engine.syncNow(), /incorrect passphrase/);
  assert.deepEqual(await names(), before);
  await setSyncSecrets({ passphrase: PASS }, false);
});

await test('locked sync reports it instead of crashing', async () => {
  await load(deviceB);
  await chrome.storage.session.clear();
  await assert.rejects(() => engine.syncNow(), /locked/i);
});

await test('a remembered passphrase survives a browser restart', async () => {
  await load(deviceB);
  await setSyncSecrets({ token: TOKEN, passphrase: PASS }, true);
  await chrome.storage.session.clear();
  const secrets = await getSyncSecrets();
  assert.equal(secrets.passphrase, PASS);
});

await test('rate limit enables backoff for background syncs', async () => {
  await load(deviceB);
  await setSyncSecrets({ token: TOKEN, passphrase: PASS }, false);
  server.failNext = { status: 403, message: 'rate limited', headers: { 'retry-after': '120' } };
  await assert.rejects(() => engine.syncNow({ background: true }), (err) => err instanceof SyncHttpError && err.status === 403);
  const status = await engine.getStatus();
  assert.ok(status.retryAt > Date.now());
  const skipped = await engine.syncNow({ background: true });
  assert.equal(skipped.status, 'backing-off');
  await chrome.storage.session.remove('syncBackoff');
});

await test('bad token reports a clear message', async () => {
  await load(deviceB);
  await setSyncSecrets({ token: 'wrong', passphrase: PASS }, false);
  await assert.rejects(() => engine.syncNow(), /rejected the token/);
});

// ---------------------------------------------------------------------------
console.log('\nsecrets and payload safety');

await test('secrets never appear in settings, export or backups', async () => {
  await load(deviceB);
  await setSyncSecrets({ token: TOKEN, passphrase: PASS }, true);
  await handleMessage({ type: MESSAGE_TYPES.CREATE_BACKUP }, {});
  const exported = JSON.stringify(await handleMessage({ type: MESSAGE_TYPES.EXPORT }, {}));
  assert.ok(!exported.includes(TOKEN) && !exported.includes(PASS));
  assert.ok(!exported.includes('syncGistId'));
  assert.equal(JSON.parse(exported).app, 'tabroost');
  const local = await chrome.storage.local.get(['settings', 'backups']);
  const flat = JSON.stringify(local);
  assert.ok(!flat.includes(TOKEN) && !flat.includes(PASS));
});

await test('legacy secrets inside settings are migrated out', async () => {
  resetAll();
  await chrome.storage.local.set({
    settings: { syncEnabled: true, syncGistToken: 'ghp_old', syncPassphrase: 'old passphrase' }
  });
  assert.equal(await migrateLegacySecrets(), true);
  const raw = (await chrome.storage.local.get('settings')).settings;
  assert.equal(raw.syncGistToken, undefined);
  assert.equal(raw.syncPassphrase, undefined);
  const secrets = await getSyncSecrets();
  assert.equal(secrets.token, 'ghp_old');
  assert.equal(secrets.passphrase, 'old passphrase');
});

await test('router rejects a short passphrase', async () => {
  await assert.rejects(
    () => handleMessage({ type: MESSAGE_TYPES.UPDATE_SYNC_CONFIG, secrets: { passphrase: 'short' } }, {}),
    /at least 8/
  );
});

await test('remote payload is sanitised and newer schemas are refused', () => {
  const clean = sanitizeSyncPayload({
    workspaces: {
      x: { id: 'x', name: 'X', color: 'not-a-colour', tabs: [{ url: 'https://a.test', groupId: 'ghost' }] },
      junk: 'nope'
    },
    workspaceOrder: ['x', 'junk', 'x'],
    tombstones: { gone: 5, bad: 'x' }
  });
  assert.deepEqual(Object.keys(clean.workspaces), ['x']);
  assert.notEqual(clean.workspaces.x.color, 'not-a-colour');
  assert.equal(clean.workspaces.x.tabs[0].groupId, null);
  assert.deepEqual(clean.workspaceOrder, ['x']);
  assert.deepEqual(clean.tombstones, { gone: 5 });
  assert.throws(() => sanitizeSyncPayload({ schemaVersion: 99, workspaces: {} }), /newer Tabroost/);
  assert.throws(() => sanitizeSyncPayload('string'), /not an object/);
});

await test('legacy v1 envelopes still decrypt', async () => {
  const { bytesToBase64 } = await import('../src/shared/crypto.js');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(PASS), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode('{"ok":1}'));
  const envelope = {
    version: 1,
    format: 'tabroost-e2ee-aes-gcm',
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ct))
  };
  assert.deepEqual(await decryptPayload(envelope, PASS), { ok: 1 });
});

console.log(`\n${passed} checks passed${failed ? `, ${failed} failed` : ''}\n`);
