// SlotForge Library submissions: a Cloudflare Worker that takes the website's submit form
// and turns it into a pull request on the library repository. Nobody needs an account.
//
// 1. POST /submit   JSON form + picture (base64, already shrunk in the browser) + Turnstile token.
//                   Checks everything, commits item.json and the picture to a new branch
//                   submission/<id>, and returns a signed ticket for the upload.
// 2. PUT  /upload/<id>   the .zip itself, streamed straight on to the "files" release as
//                   <id>.zip (never read into memory), then opens the pull request.
//
// Merging the pull request publishes the item; closing it declines it (submission.yml moves or deletes the file).
// Secrets: GITHUB_TOKEN (fine-grained, this repository: Contents and Pull requests read/write),
// TURNSTILE_SECRET, TICKET_KEY (any long random text). Vars: ALLOWED_ORIGINS (comma separated).
import { REPO, PENDING, MAX_BYTES, MAX_PICTURE, checkFields, sniff, slugify } from '../scripts/rules.mjs';

const GH = 'https://api.github.com';
const TICKET_MINUTES = 30;

class Refused extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

const enc = new TextEncoder();
const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const b64url = bytes => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(key, text) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(text))));
}
async function makeTicket(env, data) {
  const body = b64url(enc.encode(JSON.stringify(data)));
  return `${body}.${await hmac(env.TICKET_KEY, body)}`;
}
async function readTicket(env, ticket) {
  const [body, sig] = String(ticket || '').split('.');
  if (!body || !sig || sig !== await hmac(env.TICKET_KEY, body)) throw new Refused('This upload is not valid. Send the form again.', 403);
  const data = JSON.parse(new TextDecoder().decode(unb64(body.replace(/-/g, '+').replace(/_/g, '/'))));
  if (Date.now() > data.exp) throw new Refused('This upload took too long. Send the form again.', 403);
  return data;
}

function github(env) {
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'slotforge-library-worker',
  };
  const call = async (method, url, body, extra = {}) => {
    const res = await fetch(url.startsWith('http') ? url : GH + url, {
      method, headers: { ...headers, ...extra }, body: body === undefined ? undefined : (extra['Content-Type'] ? body : JSON.stringify(body)),
      ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
    });
    if (res.status === 404 && method === 'GET') return null;
    if (!res.ok) throw new Error(`GitHub ${method} ${url}: ${res.status} ${(await res.text()).slice(0, 300)}`);
    return res.status === 204 ? {} : res.json();
  };
  return call;
}

async function verifyHuman(env, token, ip) {
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', String(token || ''));
  if (ip) form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const out = await res.json().catch(() => ({}));
  if (!out.success) throw new Refused('The spam check did not pass. Try again.', 403);
}

async function submit(request, env) {
  const data = await request.json().catch(() => { throw new Refused('The form could not be read.'); });
  await verifyHuman(env, data.token, request.headers.get('CF-Connecting-IP'));
  let fields;
  try { fields = checkFields(data); } catch (e) { throw new Refused(e.message); }
  const picture = unb64(String(data.picture || ''));
  if (picture.length > MAX_PICTURE) throw new Refused('The picture is too large.');
  const kind = sniff(picture);
  if (!['png', 'jpg', 'webp'].includes(kind)) throw new Refused('The picture must be a PNG, JPG or WebP image.');
  const size = Number(data.fileSize);
  if (!(size > 22 && size <= MAX_BYTES)) throw new Refused('The .zip must be smaller than 25 MB.');

  const id = `${slugify(fields.title)}-${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;
  const item = {
    id, ...fields, github: null, issue: null, added: new Date().toISOString().slice(0, 10),
    preview: `preview.${kind}`, file: `${id}.zip`, storage: 'release', size,
  };
  const gh = github(env);
  const main = await gh('GET', `/repos/${REPO}/git/ref/heads/main`);
  const base = await gh('GET', `/repos/${REPO}/git/commits/${main.object.sha}`);
  const blob = async (content, encoding) => (await gh('POST', `/repos/${REPO}/git/blobs`, { content, encoding })).sha;
  const tree = await gh('POST', `/repos/${REPO}/git/trees`, {
    base_tree: base.tree.sha,
    tree: [
      { path: `items/${id}/item.json`, mode: '100644', type: 'blob', sha: await blob(JSON.stringify(item, null, 2) + '\n', 'utf-8') },
      { path: `items/${id}/${item.preview}`, mode: '100644', type: 'blob', sha: await blob(b64(picture), 'base64') },
    ],
  });
  const commit = await gh('POST', `/repos/${REPO}/git/commits`, { message: `Add ${id} (website submission)`, tree: tree.sha, parents: [main.object.sha] });
  await gh('POST', `/repos/${REPO}/git/refs`, { ref: `refs/heads/submission/${id}`, sha: commit.sha });
  const ticket = await makeTicket(env, { id, size, exp: Date.now() + TICKET_MINUTES * 60000 });
  return { id, ticket };
}

// Waiting files go to a draft release, which only the repository owner can see or download,
// so nothing unreviewed is ever public. Merging moves the file to the public "files" release.
async function pendingRelease(gh) {
  const all = await gh('GET', `/repos/${REPO}/releases?per_page=100`);
  return (all || []).find(r => r.draft && r.name === PENDING)
    || await gh('POST', `/repos/${REPO}/releases`, {
      tag_name: 'pending', name: PENDING, draft: true,
      body: 'Files sent from the library page, waiting for review. Merging a submission moves its file to the public "files" release; closing deletes it.',
    });
}

async function upload(request, env, id) {
  const t = await readTicket(env, request.headers.get('X-Ticket'));
  if (t.id !== id) throw new Refused('This upload is not valid.', 403);
  const length = Number(request.headers.get('Content-Length'));
  if (length !== t.size) throw new Refused('The .zip is not the size the form said.');
  const gh = github(env);
  const branch = await gh('GET', `/repos/${REPO}/git/ref/heads/submission/${id}`);
  if (!branch) throw new Refused('This submission was not found. Send the form again.', 404);
  const item = JSON.parse(new TextDecoder().decode(unb64((await gh('GET', `/repos/${REPO}/contents/items/${id}/item.json?ref=submission/${id}`)).content.replace(/\n/g, ''))));
  const release = await pendingRelease(gh);
  if ((release.assets || []).some(a => a.name === `${id}.zip`)) throw new Refused('This .zip was already sent.', 409);
  // Stream the body straight through: a Worker never holds the whole file.
  const body = typeof FixedLengthStream === 'function'
    ? (() => { const s = new FixedLengthStream(length); request.body.pipeTo(s.writable); return s.readable; })()
    : request.body;
  const uploadUrl = release.upload_url.replace(/\{.*\}$/, '') + `?name=${encodeURIComponent(id + '.zip')}&label=${encodeURIComponent('Waiting for review')}`;
  await gh('POST', uploadUrl, body, { 'Content-Type': 'application/zip', 'Content-Length': String(length) });

  const typeName = { track: 'Track', chassis: 'Chassis', body: 'Body', building: 'Building', livery: 'Livery', decals: 'Decal sheet', 'race-screen': 'Race-screen pack' }[item.type];
  const row = (k, v) => `| ${k} | ${String(v ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`;
  const pr = await gh('POST', `/repos/${REPO}/pulls`, {
    title: `${typeName}: ${item.title}`, head: `submission/${id}`, base: 'main',
    body: [
      `Sent from the [library page](https://thedutchmanjames.github.io/library/) by **${item.author}**.`, '',
      `![Picture](https://github.com/${REPO}/blob/submission/${id}/items/${id}/${item.preview}?raw=true)`, '',
      '| | |', '|---|---|',
      row('Type', typeName), row('Made for', item.app ? `${item.app} ${item.appVersion ? item.appVersion + ' or newer' : ''}` : 'Any 3D printer'),
      row('Scale', item.scale || 'Any'), row('Based on', item.basedOn ? `<${item.basedOn}>` : 'Their own design'), row('Printed and tested', item.printed), row('Licence', item.licence),
      row('File', `${id}.zip (${(item.size / 1048576).toFixed(1)} MB), in the draft release “${PENDING}” until this is merged`), '',
      '**Description**', '', item.description.split('\n').map(l => '> ' + l).join('\n'), '',
      ...(item.printNotes ? ['**Print notes**', '', item.printNotes.split('\n').map(l => '> ' + l).join('\n'), ''] : []),
      '---', '**Merge** to publish it in the library: its .zip moves to the public release. **Close** to decline it: its .zip is deleted.',
      'The check below lists what is inside the .zip.',
    ].join('\n'),
    maintainer_can_modify: true,
  });
  await gh('POST', `/repos/${REPO}/issues/${pr.number}/labels`, { labels: ['submission'] }).catch(() => {});
  return { id, pr: pr.html_url };
}

export default {
  async fetch(request, env) {
    const origins = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': origins.includes(origin) ? origin : origins[0] || '',
      'Access-Control-Allow-Methods': 'POST, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Ticket',
      'Access-Control-Max-Age': '86400', Vary: 'Origin',
    };
    const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (!origins.includes(origin)) throw new Refused('Send the form from the SlotForge website.', 403);
      const url = new URL(request.url);
      if (request.method === 'POST' && url.pathname === '/submit') return reply(await submit(request, env));
      const m = url.pathname.match(/^\/upload\/([a-z0-9-]{1,80})$/);
      if (request.method === 'PUT' && m) return reply(await upload(request, env, m[1]));
      throw new Refused('Not found.', 404);
    } catch (e) {
      if (e instanceof Refused) return reply({ error: e.message }, e.status);
      console.error(e);
      return reply({ error: 'Something went wrong on our side. Try again later.' }, 500);
    }
  },
};
