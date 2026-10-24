/**
 * Unit tests for client-side Web Crypto PBKDF2 + AES-GCM engine
 */

import { encryptPayload, decryptPayload, deriveKey } from '../src/shared/crypto.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    failed++;
    console.error(`  FAIL: ${message}`);
  } else {
    passed++;
    console.log(`  pass: ${message}`);
  }
}

async function runTests() {
  console.log('crypto test suite');

  // 1. Basic round-trip encryption & decryption
  try {
    const payload = {
      workspaces: {
        'ws-1': { id: 'ws-1', name: 'Research Project', tabs: [{ url: 'https://example.com' }] }
      },
      updatedAt: 1730000000000
    };
    const passphrase = 'SuperSecretUserPassphrase!123';

    const envelope = await encryptPayload(payload, passphrase);
    assert(envelope.version === 1, 'envelope contains version 1');
    assert(envelope.format === 'tabroost-e2ee-aes-gcm', 'envelope specifies correct format');
    assert(typeof envelope.ciphertext === 'string' && envelope.ciphertext.length > 0, 'ciphertext is non-empty base64 string');
    assert(typeof envelope.salt === 'string', 'salt is base64 string');
    assert(typeof envelope.iv === 'string', 'iv is base64 string');

    const decrypted = await decryptPayload(envelope, passphrase);
    assert(decrypted.workspaces['ws-1'].name === 'Research Project', 'decrypted content matches original object');
    assert(decrypted.workspaces['ws-1'].tabs[0].url === 'https://example.com', 'nested tabs preserved');
  } catch (err) {
    assert(false, `round-trip failed: ${err.message}`);
  }

  // 2. Reject incorrect passphrase
  try {
    const payload = { secret: 'data' };
    const envelope = await encryptPayload(payload, 'correct-password');
    let rejected = false;
    try {
      await decryptPayload(envelope, 'wrong-password');
    } catch {
      rejected = true;
    }
    assert(rejected, 'rejects incorrect passphrase with decryption error');
  } catch (err) {
    assert(false, `wrong password test threw unexpected error: ${err.message}`);
  }

  // 3. Different IV and Salt for identical plaintexts
  try {
    const payload = { same: 'data' };
    const pass = 'fixed-passphrase';
    const env1 = await encryptPayload(payload, pass);
    const env2 = await encryptPayload(payload, pass);
    assert(env1.salt !== env2.salt, 'generates distinct random salt for each encryption');
    assert(env1.iv !== env2.iv, 'generates distinct random IV for each encryption');
    assert(env1.ciphertext !== env2.ciphertext, 'generates distinct ciphertext for each encryption');
  } catch (err) {
    assert(false, `randomization test failed: ${err.message}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests();
