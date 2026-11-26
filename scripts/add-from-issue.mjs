// Run by the "Add approved item" workflow: reads the labelled issue from the GitHub event,
// downloads its picture and .zip, and writes items/<id>/. Writes a message for the issue
// comment to $RESULT_FILE either way.
import fs from 'node:fs/promises';
import path from 'node:path';
import { readSubmission, sniff, ITEMS, MAX_BYTES } from './library.mjs';

const event = JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
const result = process.env.RESULT_FILE || 'result.md';

async function download(url, what) {
  // No token is sent: attachments of a public repository are public.
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`The ${what} could not be downloaded (${res.status}).`);
  const length = Number(res.headers.get('content-length') || 0);
  if (length > MAX_BYTES) throw new Error(`The ${what} is larger than 25 MB.`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error(`The ${what} is larger than 25 MB.`);
  return bytes;
}

try {
  const { item, previewUrl, filesUrl } = readSubmission(event.issue);
  const picture = await download(previewUrl, 'picture');
  const kind = sniff(picture);
  if (!['png', 'jpg', 'webp'].includes(kind)) throw new Error('The picture must be a PNG, JPG or WebP image.');
  const zip = await download(filesUrl, '.zip');
  if (sniff(zip) !== 'zip') throw new Error('The files must be a .zip.');
  const dir = path.join(ITEMS, item.id);
  await fs.mkdir(dir, { recursive: true });
  item.preview = `preview.${kind}`;
  item.file = `${item.id}.zip`;
  await fs.writeFile(path.join(dir, item.preview), picture);
  await fs.writeFile(path.join(dir, item.file), zip);
  await fs.writeFile(path.join(dir, 'item.json'), JSON.stringify(item, null, 2) + '\n');
  await fs.writeFile(result, `Thanks! **${item.title}** is now in the [SlotForge community library](https://thedutchmanjames.github.io/library/#${item.id}). It can take a few minutes to appear.`);
  await fs.appendFile(process.env.GITHUB_OUTPUT || '/dev/null', `id=${item.id}\nok=true\n`);
  console.log(`Added ${item.id}`);
} catch (e) {
  await fs.writeFile(result, `This could not be added to the library yet: ${e.message}\n\nEdit the issue to fix it, then the label can be added again.`);
  await fs.appendFile(process.env.GITHUB_OUTPUT || '/dev/null', 'ok=false\n');
  console.error(e.message);
}
