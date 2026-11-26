// Node-side helpers for the library: reading a GitHub issue-form submission and building the index.
// The rules themselves live in rules.mjs, shared with the Cloudflare Worker.
import fs from 'node:fs/promises';
import path from 'node:path';
import { TYPES, APPS, SCALES, PRINTED, LICENCES, SAFE_ID, SAFE_FILE, REPO, FILES_TAG, slugify, clean, checkFields } from './rules.mjs';
export * from './rules.mjs';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const ITEMS = path.join(ROOT, 'items');

// Only files uploaded to GitHub itself are fetched; nothing else is ever downloaded.
export const ATTACHMENT = /^https:\/\/(github\.com\/user-attachments\/(assets|files)\/[\w./%-]+|user-images\.githubusercontent\.com\/[\w./%-]+|private-user-images\.githubusercontent\.com\/[\w./%?=&-]+)$/;

// Issue forms arrive as "### Label\n\nvalue" blocks.
export function sections(body) {
  const out = {};
  const parts = String(body || '').replace(/\r\n/g, '\n').split(/^### /m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const label = part.slice(0, nl < 0 ? undefined : nl).trim();
    let value = nl < 0 ? '' : part.slice(nl + 1).trim();
    if (value === '_No response_') value = '';
    out[label] = value;
  }
  return out;
}

const links = text => [...String(text).matchAll(/\]\((https:[^)\s]+)\)|src="(https:[^"]+)"|(?:^|\s)(https:\/\/\S+)/g)]
  .map(m => (m[1] || m[2] || m[3]).replace(/[>.,]+$/, ''));

// Turns a submission issue into an item plus the two attachment URLs.
// Throws an Error with a plain message the submitter can act on.
export function readSubmission(issue) {
  const s = sections(issue.body);
  const pick = (label, table) => {
    const v = s[label];
    if (!(v in table)) throw new Error(`“${label}” has an answer the library does not know: ${v || '(empty)'}.`);
    return table[v];
  };
  const title = clean(String(issue.title || '').replace(/^\s*\[library\]\s*/i, ''), 80);
  if (title.length < 3) throw new Error('Give the item a name in the issue title, after “[Library]”.');
  const type = pick('What is it?', TYPES);
  const app = pick('Made for', APPS);
  if (!SCALES.includes(s['Scale'])) throw new Error('Choose a scale.');
  const printed = pick('Printed and tested?', PRINTED);
  const licence = pick('Licence', LICENCES);
  const ticks = (s['Your rights'] || '').match(/- \[x\]/gi) || [];
  if (ticks.length < 2) throw new Error('Both boxes under “Your rights” need a tick.');
  const login = String(issue.user?.login || '');
  const fields = checkFields({
    title, type, app, scale: s['Scale'], appVersion: s['Oldest app version it opens in'],
    description: s['Description'], printed, printNotes: s['Print notes'], licence,
    author: clean(s['Name to show'], 40) || login, rights: true, basedOn: s['Original design'],
  });
  const preview = links(s['Picture']).find(u => ATTACHMENT.test(u));
  if (!preview) throw new Error('Drag a picture into “Picture”, so it is uploaded to GitHub.');
  const files = links(s['Files']).find(u => ATTACHMENT.test(u) && /\.zip$/i.test(u.split('?')[0]));
  if (!files) throw new Error('Drag a .zip into “Files”, so it is uploaded to GitHub.');
  return {
    item: {
      id: `${slugify(title)}-${issue.number}`, ...fields,
      github: login, issue: issue.number, added: new Date().toISOString().slice(0, 10),
    },
    previewUrl: preview, filesUrl: files,
  };
}

export const downloadUrl = item => item.storage === 'release'
  ? `https://github.com/${REPO}/releases/download/${FILES_TAG}/${encodeURIComponent(item.file)}`
  : `https://github.com/${REPO}/raw/main/items/${item.id}/${encodeURIComponent(item.file)}`;

// Reads every items/<id>/item.json, checks it and returns the public index.
export async function buildIndex() {
  const items = [];
  const problems = [];
  let dirs = [];
  try { dirs = await fs.readdir(ITEMS, { withFileTypes: true }); } catch {}
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    try {
      if (!SAFE_ID.test(d.name)) throw new Error('folder name may only use a-z, 0-9 and -');
      const item = JSON.parse(await fs.readFile(path.join(ITEMS, d.name, 'item.json'), 'utf8'));
      if (item.id !== d.name) throw new Error('id must match the folder name');
      if (!Object.values(TYPES).includes(item.type)) throw new Error(`unknown type ${item.type}`);
      if (item.app !== null && !Object.values(APPS).includes(item.app)) throw new Error(`unknown app ${item.app}`);
      for (const key of ['preview', 'file']) if (!SAFE_FILE.test(item[key] || '')) throw new Error(`${key} must be a png/jpg/webp/zip file name`);
      await fs.stat(path.join(ITEMS, d.name, item.preview));
      if (item.storage === 'release') {
        if (!(item.size > 0)) throw new Error('size is missing');
      } else {
        item.size = (await fs.stat(path.join(ITEMS, d.name, item.file))).size;
      }
      item.download = downloadUrl(item);
      items.push(item);
    } catch (e) { problems.push(`items/${d.name}: ${e.message}`); }
  }
  items.sort((a, b) => (b.added || '').localeCompare(a.added || '') || a.title.localeCompare(b.title));
  return { index: { version: 1, updated: new Date().toISOString(), items }, problems };
}
