/**
 * Security checks: message sender policy and Gist URL/ID validation
 */

import { isSenderAllowed } from '../src/background/router.js';
import { isValidGistId, isTrustedGistUrl, GistAdapter } from '../src/background/sync-engine.js';
import { MESSAGE_TYPES } from '../src/shared/constants.js';

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

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const ORIGIN = `chrome-extension://${ID}/`;
const allow = (message, sender) => isSenderAllowed(message, sender, ID, ORIGIN);

console.log('message sender policy');
const panel = { id: ID, url: `${ORIGIN}src/sidepanel/panel.html` };
const page = { id: ID, url: 'https://example.com/', tab: { id: 1, windowId: 1 } };

assert(allow({ type: MESSAGE_TYPES.RESET_ALL }, panel), 'extension pages may send any command');
assert(!allow({ type: MESSAGE_TYPES.RESET_ALL }, { url: panel.url }), 'a sender without an extension id is rejected');
assert(!allow({ type: MESSAGE_TYPES.RESET_ALL }, { id: 'other', url: panel.url }), 'another extension id is rejected');
assert(allow({ type: MESSAGE_TYPES.GET_PAGE_INDICATOR }, page), 'content scripts may read the page indicator');
assert(allow({ type: MESSAGE_TYPES.UPDATE_SETTINGS, settings: { pillOffsetY: 40 } }, page), 'content scripts may save the pill position');
assert(!allow({ type: MESSAGE_TYPES.UPDATE_SETTINGS, settings: { syncEnabled: true } }, page), 'content scripts cannot change other settings');
assert(!allow({ type: MESSAGE_TYPES.UPDATE_SETTINGS, settings: {} }, page), 'content scripts cannot send empty settings patches');
for (const type of [MESSAGE_TYPES.EXPORT, MESSAGE_TYPES.IMPORT, MESSAGE_TYPES.RESET_ALL, MESSAGE_TYPES.UPDATE_SYNC_CONFIG, MESSAGE_TYPES.DELETE_WORKSPACE, MESSAGE_TYPES.RESTORE_BACKUP]) {
  assert(!allow({ type }, page), `content scripts cannot send ${type}`);
}

console.log('gist id and url validation');
assert(isValidGistId('a'.repeat(32)), 'a normal hex gist id is accepted');
assert(!isValidGistId('../user'), 'path traversal in a gist id is rejected');
assert(!isValidGistId('abc?x=1'), 'query characters in a gist id are rejected');
assert(!isValidGistId(''), 'an empty gist id is rejected');
assert(isTrustedGistUrl('https://gist.githubusercontent.com/u/id/raw/file'), 'raw gist host is trusted');
assert(!isTrustedGistUrl('http://gist.githubusercontent.com/u/id/raw/file'), 'plain http is not trusted');
assert(!isTrustedGistUrl('https://evil.example/raw'), 'foreign hosts are not trusted');
assert(!isTrustedGistUrl('https://gist.githubusercontent.com.evil.example/x'), 'look-alike hosts are not trusted');
assert(!isTrustedGistUrl('not a url'), 'garbage is not trusted');

let threw = false;
try { new GistAdapter('tok', '../../user'); } catch { threw = true; }
assert(threw, 'GistAdapter refuses an invalid gist id');

let truncatedThrew = false;
const fake = async (url) => {
  if (String(url).startsWith('https://api.github.com/gists/')) {
    return {
      ok: true,
      json: async () => ({ files: { 'tabroost-workspaces.enc': { truncated: true, raw_url: 'https://evil.example/steal' } } })
    };
  }
  throw new Error('token would have been sent to an untrusted address');
};
try {
  await new GistAdapter('tok', 'a'.repeat(32), fake).fetchGist();
} catch (err) {
  truncatedThrew = /untrusted/.test(err.message);
}
assert(truncatedThrew, 'a truncated gist with a foreign raw_url is not fetched with the token');

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
