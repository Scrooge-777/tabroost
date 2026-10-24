/**
 * Contract check: every `workspaceManager.x(`, `windowRegistry.x(`, ... call in src/
 * must name a method that exists on that object. Catches typos and calls to methods that
 * were never written (sync once called workspaceManager.saveState, which did not exist).
 */

import fs from 'node:fs';
import path from 'node:path';
import './harness.mjs';

const targets = {
  workspaceManager: (await import('../src/background/workspace-manager.js')).workspaceManager,
  windowRegistry: (await import('../src/background/window-registry.js')).windowRegistry,
  windowOpener: (await import('../src/background/window-opener.js')).windowOpener,
  backups: (await import('../src/background/backups.js')).backups,
  pageFeatures: (await import('../src/background/page-features.js')).pageFeatures,
  syncEngine: (await import('../src/background/sync-engine.js')).syncEngine,
  tabSync: (await import('../src/background/tab-sync.js')).tabSync,
  storage: (await import('../src/shared/storage.js')).storage
};

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const has = (obj, name) => {
  for (let o = obj; o; o = Object.getPrototypeOf(o)) {
    if (Object.prototype.hasOwnProperty.call(o, name)) return true;
  }
  return false;
};

let missing = 0;
for (const file of walk('src')) {
  const text = fs.readFileSync(file, 'utf8');
  for (const [name, obj] of Object.entries(targets)) {
    const re = new RegExp(String.raw`\b${name}\.([A-Za-z_$][\w$]*)\s*\(`, 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      if (!has(obj, m[1])) {
        console.error(`MISSING METHOD: ${name}.${m[1]}() called in ${file}`);
        missing++;
      }
    }
  }
}

if (missing) {
  console.error(`${missing} call(s) to methods that do not exist`);
  process.exit(1);
}
console.log('All object method calls resolve');
