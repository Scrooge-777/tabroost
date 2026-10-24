/**
 * Production Packaging Script for Tabroost
 * Creates a clean zip bundle for Chrome Web Store & Edge Add-ons in dist/
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const rootDir = path.resolve('.');
const distDir = path.join(rootDir, 'dist');
const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const version = pkg.version || '1.1.0';
const zipName = `tabroost-v${version}.zip`;
const zipPath = path.join(distDir, zipName);

console.log(`Building release archive for Tabroost v${version}...`);

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

// Bundle core extension files (excluding test, docs, node_modules, .git)
const includeEntries = ['manifest.json', 'src', 'assets', 'LICENSE', 'README.md'];
const command = `tar.exe -a -c -f "${zipPath}" ${includeEntries.join(' ')}`;

try {
  execSync(command, { cwd: rootDir, stdio: 'inherit' });
} catch (err) {
  console.error('Packaging failed:', err.message);
  process.exit(1);
}

if (fs.existsSync(zipPath)) {
  const stats = fs.statSync(zipPath);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');

  console.log('\nPackage build complete:');
  console.log(`  Artifact: ${zipPath}`);
  console.log(`  Size:     ${(stats.size / 1024).toFixed(2)} KB`);
  console.log(`  SHA-256:  ${hash}`);
} else {
  console.error('Error: Zip archive not created.');
  process.exit(1);
}
