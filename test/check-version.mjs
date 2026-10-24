import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));

if (pkg.version !== manifest.version) {
  console.error(`Version mismatch: package.json ${pkg.version} vs manifest.json ${manifest.version}`);
  process.exit(1);
}
console.log(`Versions in sync (${pkg.version})`);
