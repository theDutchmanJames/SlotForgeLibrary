// Rules shared by the scripts, the GitHub workflows and the Cloudflare Worker.
// No Node-only imports here: the Worker bundles this file.

export const REPO = 'theDutchmanJames/SlotForgeLibrary';
export const FILES_TAG = 'files'; // release that holds the published .zip files
export const PENDING = 'Pending submissions'; // draft release (owner-only) holding .zip files waiting for review

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
export const MAX_PICTURE = 3 * 1024 * 1024;
// Files a slotcar item never needs, refused inside a .zip.
export const BLOCKED = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|vbe|js|jse|wsf|hta|jar|sh|app|dll|lnk|reg|apk|dmg|pkg|deb|rpm|appimage)$/i;

export const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const SAFE_FILE = /^[\w][\w .()-]{0,99}\.(png|jpg|webp|zip)$/i;

export const slugify = s => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'item';

export const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max);

// Checks an item from the website form (values are the short codes, not the form labels).
// Returns the item fields or throws an Error with a message for the submitter.
export function checkFields(f) {
  const title = clean(f.title, 80);
  if (title.length < 3) throw new Error('Give your item a name.');
  if (!Object.values(TYPES).includes(f.type)) throw new Error('Choose what it is.');
  if (!Object.values(APPS).includes(f.app)) throw new Error('Choose the app it is made for.');
  const scale = SCALES.includes(f.scale) ? f.scale : null;
  if (!scale) throw new Error('Choose a scale.');
  const version = clean(f.appVersion, 20).replace(/^v/i, '');
  if (version && !/^\d+(\.\d+){0,2}$/.test(version)) throw new Error(`“${version}” is not an app version like 0.5.0.`);
  const description = clean(f.description, 1500);
  if (description.length < 10) throw new Error('Write a short description.');
  if (!Object.values(PRINTED).includes(f.printed)) throw new Error('Say whether it was printed and tested.');
  if (!Object.values(LICENCES).includes(f.licence)) throw new Error('Choose a licence.');
  const author = clean(f.author, 40);
  if (author.length < 2) throw new Error('Fill in the name to show as its maker.');
  if (f.rights !== true) throw new Error('Tick both boxes under “Your rights”.');
  const basedOn = originalUrl(f.basedOn);
  return {
    title, type: f.type,
    app: f.app === 'STL' ? null : f.app, appVersion: f.app === 'STL' ? null : (version || null),
    scale: scale === 'Not scale-specific' ? null : scale,
    description, printed: f.printed, printNotes: clean(f.printNotes, 1000) || null,
    licence: f.licence, author, basedOn,
  };
}

// Optional link to the design this one is based on: a plain http(s) web address, or nothing.
export function originalUrl(value) {
  const text = clean(value, 300);
  if (!text) return null;
  let url;
  try { url = new URL(/^[a-z]+:/i.test(text) ? text : 'https://' + text); } catch { url = null; }
  if (!url || !['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password)
    throw new Error('“Original design” must be a web address, like https://www.printables.com/model/12345.');
  return url.href;
}

// File signatures: the upload must really be what it says.
export function sniff(bytes) {
  const b = bytes.subarray(0, 12);
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'webp';
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return 'zip';
  return null;
}

// Names of the files inside a .zip, read from its central directory.
export function zipEntries(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('The .zip is damaged.');
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const names = [];
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || v.getUint32(p, true) !== 0x02014b50) throw new Error('The .zip is damaged.');
    const len = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true);
    const size = v.getUint32(p + 24, true);
    names.push({ name: dec.decode(bytes.subarray(p + 46, p + 46 + len)), size });
    p += 46 + len + extra + comment;
  }
  return names;
}
