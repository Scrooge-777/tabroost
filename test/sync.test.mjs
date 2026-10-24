/**
 * Unit tests for Sync Engine & Conflict Resolution
 */

import { mergeWorkspaces } from '../src/background/sync-engine.js';

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

function runTests() {
  console.log('sync engine & conflict resolution test suite');

  // 1. Merge non-overlapping workspaces
  const localA = {
    'ws-1': { id: 'ws-1', name: 'Local Only', updatedAt: 1000 }
  };
  const remoteA = {
    'ws-2': { id: 'ws-2', name: 'Remote Only', updatedAt: 1200 }
  };
  const mergedA = mergeWorkspaces(localA, remoteA);
  assert(Boolean(mergedA['ws-1']), 'keeps local workspace');
  assert(Boolean(mergedA['ws-2']), 'adopts remote workspace');
  assert(Object.keys(mergedA).length === 2, 'contains exactly 2 workspaces');

  // 2. Conflict: Last-Write-Wins (remote newer)
  const localB = {
    'ws-1': { id: 'ws-1', name: 'Older Local Title', updatedAt: 1000 }
  };
  const remoteB = {
    'ws-1': { id: 'ws-1', name: 'Newer Remote Title', updatedAt: 2000 }
  };
  const mergedB = mergeWorkspaces(localB, remoteB);
  assert(mergedB['ws-1'].name === 'Newer Remote Title', 'newer remote update wins over older local');

  // 3. Conflict: Last-Write-Wins (local newer)
  const localC = {
    'ws-1': { id: 'ws-1', name: 'Newer Local Title', updatedAt: 3000 }
  };
  const remoteC = {
    'ws-1': { id: 'ws-1', name: 'Older Remote Title', updatedAt: 2000 }
  };
  const mergedC = mergeWorkspaces(localC, remoteC);
  assert(mergedC['ws-1'].name === 'Newer Local Title', 'newer local update wins over older remote');

  // 4. Tombstone deletion: Local deletion wins over older remote update
  const localD = {
    'ws-1': { id: 'ws-1', name: 'Deleted Item', deletedAt: 2500 }
  };
  const remoteD = {
    'ws-1': { id: 'ws-1', name: 'Pre-existing Item', updatedAt: 2000 }
  };
  const mergedD = mergeWorkspaces(localD, remoteD);
  assert(!mergedD['ws-1'], 'tombstone deletion suppresses resurrecting older remote workspace');

  // 5. Tombstone deletion: Remote update newer than local deletion
  const localE = {
    'ws-1': { id: 'ws-1', name: 'Deleted Item', deletedAt: 2500 }
  };
  const remoteE = {
    'ws-1': { id: 'ws-1', name: 'Re-activated Item on Laptop', updatedAt: 3000 }
  };
  const mergedE = mergeWorkspaces(localE, remoteE);
  assert(Boolean(mergedE['ws-1']), 'remote update newer than tombstone resurrects workspace');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests();
