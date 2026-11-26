// Shared rules for the SlotForge community library: what an item looks like, and how a
// submission issue is read. Used by add-from-issue.mjs, build-index.mjs and the tests.
import fs from 'node:fs/promises';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const ITEMS = path.join(ROOT, 'items');

export const TYPES = {
  'Track': 'track', 'Chassis': 'chassis', 'Body': 'body', 'Building': 'building',
  'Livery': 'livery', 'Decal sheet': 'decals', 'Race-screen pack': 'race-screen',
};
export const APPS = {
  'SlotForge Circuit': 'Circuit', 'SlotForge Foundry': 'Foundry', 'SlotForge Anvil': 'Anvil',
  'SlotForge Frame': 'Frame', 'SlotForge Livery': 'Livery', 'SlotForge Decals': 'Decals',
  'SlotForge Timing': 'Timing', 'Any 3D printer (STL)': 'STL',
};
export const SCALES = ['1/32', '1/24', '1/43', 'HO', 'Not scale-specific'];
export const PRINTED = { 'Yes, printed and tested': 'tested', 'Not printed yet': 'untested', 'Not a printed item': 'n/a' };
export const LICENCES = {
  'CC BY 4.0 (credit me)': 'CC-BY-4.0', 'CC BY-NC 4.0 (credit me, no selling)': 'CC-BY-NC-4.0',
  'CC BY-SA 4.0 (credit me, share changes alike)': 'CC-BY-SA-4.0', 'CC0 (no conditions)': 'CC0-1.0',
};
export const MAX_BYTES = 25 * 1024 * 1024;

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

export const slugify = s => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'item';

const clean = (s, max) => String(s || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max);

// Turns a submission issue into an item description plus the two attachment URLs.
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
  const scale = s['Scale'];
  if (!SCALES.includes(scale)) throw new Error('Choose a scale.');
  const version = clean(s['Oldest app version it opens in'], 20).replace(/^v/i, '');
  if (version && !/^\d+(\.\d+){0,2}$/.test(version)) throw new Error(`“${version}” is not an app version like 0.5.0.`);
  const description = clean(s['Description'], 1500);
  if (description.length < 10) throw new Error('Write a short description.');
  const printed = pick('Printed and tested?', PRINTED);
  const licence = pick('Licence', LICENCES);
  const ticks = (s['Your rights'] || '').match(/- \[x\]/gi) || [];
  if (ticks.length < 2) throw new Error('Both boxes under “Your rights” need a tick.');
  const preview = links(s['Picture']).find(u => ATTACHMENT.test(u));
  if (!preview) throw new Error('Drag a picture into “Picture”, so it is uploaded to GitHub.');
  const files = links(s['Files']).find(u => ATTACHMENT.test(u) && /\.zip$/i.test(u.split('?')[0]));
  if (!files) throw new Error('Drag a .zip into “Files”, so it is uploaded to GitHub.');
  const login = String(issue.user?.login || '');
  return {
    item: {
      id: `${slugify(title)}-${issue.number}`,
      title, type, app: app === 'STL' ? null : app, appVersion: app === 'STL' ? null : (version || null),
      scale: scale === 'Not scale-specific' ? null : scale,
      description,
      printed, printNotes: clean(s['Print notes'], 1000) || null,
      licence,
      author: clean(s['Name to show'], 40) || login,
      github: login,
      issue: issue.number,
      added: new Date().toISOString().slice(0, 10),
    },
    previewUrl: preview, filesUrl: files,
  };
}

// File signatures: the download must really be what it says.
export function sniff(bytes) {
  const b = bytes.subarray(0, 12);
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'webp';
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return 'zip';
  return null;
}

const SAFE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SAFE_FILE = /^[\w][\w .()-]{0,99}\.(png|jpg|webp|zip)$/i;

// Reads every items/<id>/item.json, checks it and returns the public index.
export async function buildIndex() {
  const items = [];
  const problems = [];
  let dirs = [];
  try { dirs = await fs.readdir(ITEMS, { withFileTypes: true }); } catch {}
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const where = `items/${d.name}`;
    try {
      if (!SAFE.test(d.name)) throw new Error('folder name may only use a-z, 0-9 and -');
      const item = JSON.parse(await fs.readFile(path.join(ITEMS, d.name, 'item.json'), 'utf8'));
      if (item.id !== d.name) throw new Error('id must match the folder name');
      if (!Object.values(TYPES).includes(item.type)) throw new Error(`unknown type ${item.type}`);
      if (item.app !== null && !Object.values(APPS).includes(item.app)) throw new Error(`unknown app ${item.app}`);
      for (const key of ['preview', 'file']) {
        if (!SAFE_FILE.test(item[key] || '')) throw new Error(`${key} must be a png/jpg/webp/zip file name`);
        const stat = await fs.stat(path.join(ITEMS, d.name, item[key]));
        if (key === 'file') item.size = stat.size;
      }
      items.push(item);
    } catch (e) { problems.push(`${where}: ${e.message}`); }
  }
  items.sort((a, b) => (b.added || '').localeCompare(a.added || '') || a.title.localeCompare(b.title));
  return { index: { version: 1, updated: new Date().toISOString(), items }, problems };
}
