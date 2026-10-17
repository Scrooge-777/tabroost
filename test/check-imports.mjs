import fs from 'fs';
import path from 'path';

let broken = 0;
function checkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      checkDir(full);
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
      const content = fs.readFileSync(full, 'utf8');
      const regex = /(?:import|export)\s+(?:.*?from\s+)?['"]([^'"]+)['"]/g;
      let m;
      while ((m = regex.exec(content)) !== null) {
        const importPath = m[1];
        if (importPath.startsWith('.')) {
          const resolved = path.resolve(path.dirname(full), importPath);
          if (!fs.existsSync(resolved)) {
            console.error('BROKEN IMPORT:', full, '->', importPath, 'resolved to', resolved);
            broken++;
          }
        }
      }
    }
  }
}

checkDir(path.resolve('src'));
if (broken === 0) {
  console.log('ALL IMPORTS RESOLVE SUCCESSFULLY!');
} else {
  console.error(`Found ${broken} broken imports!`);
  process.exit(1);
}
