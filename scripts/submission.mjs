// Run by the "Website submission" workflow on a submission/<id> pull request.
//   node scripts/submission.mjs check    lists what is inside the waiting .zip; fails on blocked files
//   node scripts/submission.mjs publish  (merged)  moves the .zip from the draft release to "files"
//   node scripts/submission.mjs decline  (closed)  deletes the waiting .zip
// Needs GITHUB_TOKEN, GITHUB_REPOSITORY and BRANCH. Writes a comment to $RESULT_FILE.
import fs from 'node:fs/promises';
import { PENDING, FILES_TAG, BLOCKED, MAX_BYTES, SAFE_ID, sniff, zipEntries } from './rules.mjs';

const [mode] = process.argv.slice(2);
const repo = process.env.GITHUB_REPOSITORY;
const id = String(process.env.BRANCH || '').replace(/^submission\//, '');
const result = process.env.RESULT_FILE || 'result.md';
if (!SAFE_ID.test(id)) throw new Error(`Not a submission branch: ${process.env.BRANCH}`);
const name = `${id}.zip`;

const api = async (method, url, body, headers = {}) => {
  const res = await fetch(url.startsWith('http') ? url : `https://api.github.com/repos/${repo}${url}`, {
    method, body, redirect: 'follow',
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...headers },
  });
  if (!res.ok && !(res.status === 404 && method !== 'POST')) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
  return res;
};
const json = async (...a) => { const r = await api(...a); return r.status === 404 ? null : r.json(); };

const releases = await json('GET', '/releases?per_page=100') || [];
const pending = releases.find(r => r.draft && r.name === PENDING);
const asset = pending?.assets.find(a => a.name === name);

async function bytesOf(a) {
  const r = await api('GET', a.url, undefined, { Accept: 'application/octet-stream' });
  return new Uint8Array(await r.arrayBuffer());
}

if (mode === 'check') {
  if (!asset) {
    await fs.writeFile(result, `The .zip for this submission is missing from “${PENDING}”, so it cannot be published. Close this pull request.`);
    process.exit(1);
  }
  const zip = await bytesOf(asset);
  let problem = '';
  let entries = [];
  if (zip.length > MAX_BYTES) problem = 'The .zip is larger than 25 MB.';
  else if (sniff(zip) !== 'zip') problem = 'The file is not a .zip.';
  else {
    try { entries = zipEntries(zip); } catch (e) { problem = e.message; }
    const bad = entries.filter(e => BLOCKED.test(e.name) || e.name.includes('..'));
    if (bad.length) problem = `It holds files the library does not accept: ${bad.map(e => '`' + e.name + '`').join(', ')}.`;
  }
  const list = entries.slice(0, 60).map(e => `| \`${e.name.replace(/`/g, "'")}\` | ${e.size.toLocaleString('en')} bytes |`).join('\n');
  await fs.writeFile(result, [
    problem ? `❌ **Do not merge.** ${problem}` : `✅ The .zip holds ${entries.length} file${entries.length === 1 ? '' : 's'} and nothing the library blocks.`, '',
    entries.length ? `| Inside ${name} | Size |\n|---|---|\n${list}${entries.length > 60 ? `\n| … and ${entries.length - 60} more | |` : ''}` : '',
  ].join('\n'));
  if (problem) process.exit(1);
} else if (mode === 'publish') {
  if (!asset) throw new Error(`${name} is not waiting in “${PENDING}”.`);
  let files = await json('GET', `/releases/tags/${FILES_TAG}`);
  if (!files) files = await (await api('POST', '/releases', JSON.stringify({ tag_name: FILES_TAG, name: 'Library files', body: 'The .zip files of the SlotForge community library. Browse them at https://thedutchmanjames.github.io/library/' }))).json();
  const zip = await bytesOf(asset);
  const existing = files.assets?.find(a => a.name === name);
  if (existing) await api('DELETE', existing.url);
  await api('POST', files.upload_url.replace(/\{.*\}$/, '') + `?name=${encodeURIComponent(name)}`, zip, { 'Content-Type': 'application/zip' });
  await api('DELETE', asset.url);
  await fs.writeFile(result, `Published: [${name}](https://github.com/${repo}/releases/download/${FILES_TAG}/${name}) is in the [community library](https://thedutchmanjames.github.io/library/#${id}). It appears on the website within about 5 minutes (GitHub caches the list).`);
} else if (mode === 'decline') {
  if (asset) await api('DELETE', asset.url);
  await fs.writeFile(result, `Not added to the library. The uploaded .zip has been deleted.`);
} else {
  throw new Error('Use check, publish or decline.');
}
console.log(`${mode} ${name}: done`);
