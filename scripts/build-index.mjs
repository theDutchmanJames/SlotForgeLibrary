// Writes library.json from items/*/item.json. Fails when an item is broken.
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildIndex, ROOT } from './library.mjs';

const { index, problems } = await buildIndex();
if (problems.length) {
  console.error('Problems:\n' + problems.map(p => ' - ' + p).join('\n'));
  process.exit(1);
}
const file = path.join(ROOT, 'library.json');
let old = null;
try { old = JSON.parse(await fs.readFile(file, 'utf8')); } catch {}
// Keep the old date when nothing changed, so the file only changes when the library does.
if (old && JSON.stringify(old.items) === JSON.stringify(index.items)) index.updated = old.updated;
await fs.writeFile(file, JSON.stringify(index, null, 2) + '\n');
console.log(`library.json: ${index.items.length} item(s).`);
