import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import { fakeGitHub } from './fake-github.mjs';

const env = { GITHUB_TOKEN: 'x', TURNSTILE_SECRET: 'x', TICKET_KEY: 'a-long-random-test-key', ALLOWED_ORIGINS: 'https://thedutchmanjames.github.io' };
const ORIGIN = 'https://thedutchmanjames.github.io';
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 1, 2, 3]);
const zip = new Uint8Array(4000); zip.set([0x50, 0x4b, 0x03, 0x04]);
const form = over => ({
  title: 'Datsun rail frame', type: 'chassis', app: 'Frame', appVersion: '0.1.0', scale: '1/32',
  description: 'A light rail-frame chassis.', printed: 'tested', printNotes: 'PETG', licence: 'CC-BY-4.0',
  author: 'Racer 42', rights: true, basedOn: 'https://www.printables.com/model/7', token: 'ok', picture: Buffer.from(png).toString('base64'), fileSize: zip.length, ...over,
});
const post = (body, origin = ORIGIN) => new Request('https://w.example/submit', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const put = (id, ticket, bytes = zip) => new Request(`https://w.example/upload/${id}`, { method: 'PUT', headers: { Origin: ORIGIN, 'X-Ticket': ticket, 'Content-Length': String(bytes.length), 'Content-Type': 'application/zip' }, body: bytes, duplex: 'half' });

async function withFake(opts, fn) {
  const fake = fakeGitHub(opts), real = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  try { await fn(fake.state); } finally { globalThis.fetch = real; }
}

test('a submission becomes a branch, a release file and a pull request', () => withFake({}, async s => {
  const r1 = await worker.fetch(post(form()), env);
  assert.equal(r1.status, 200);
  const { id, ticket } = await r1.json();
  assert.match(id, /^datsun-rail-frame-[a-z0-9]+$/);
  assert.ok(s.refs[`heads/submission/${id}`]);
  const tree = Object.values(s.trees)[0].tree;
  const item = JSON.parse(s.blobs[tree.find(e => e.path.endsWith('item.json')).sha].content);
  assert.equal(item.storage, 'release');
  assert.equal(item.author, 'Racer 42');
  assert.equal(item.size, zip.length);
  const r2 = await worker.fetch(put(id, ticket), env);
  assert.equal(r2.status, 200, await r2.clone().text());
  assert.equal(s.assets[`${id}.zip`].length, zip.length);
  assert.equal(s.pulls.length, 1);
  assert.equal(s.pulls[0].head, `submission/${id}`);
  assert.match(s.pulls[0].body, /Racer 42/);
  assert.ok(s.pulls[0].body.includes('<https://www.printables.com/model/7>'));
  assert.equal(item.basedOn, 'https://www.printables.com/model/7');
  assert.deepEqual(s.labels['100'], ['submission']);
  assert.equal((await r2.json()).pr, 'https://github.com/pr/100');
  const again = await worker.fetch(put(id, ticket), env);
  assert.equal(again.status, 409);
}));

test('refuses other websites and failed spam checks', () => withFake({ human: false }, async () => {
  assert.equal((await worker.fetch(post(form(), 'https://evil.example'), env)).status, 403);
  const r = await worker.fetch(post(form()), env);
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /spam check/);
}));

test('refuses bad answers and writes nothing', () => withFake({}, async s => {
  const bad = await worker.fetch(post(form({ rights: false })), env);
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /Tick both/);
  assert.equal((await worker.fetch(post(form({ picture: btoa('<svg>') })), env)).status, 400);
  assert.equal((await worker.fetch(post(form({ fileSize: 26 * 1024 * 1024 })), env)).status, 400);
  assert.equal(Object.keys(s.refs).length, 1, 'nothing was written');
}));

test('refuses forged, swapped and wrong-size uploads', () => withFake({}, async s => {
  const { id, ticket } = await (await worker.fetch(post(form()), env)).json();
  assert.equal((await worker.fetch(put(id, ticket.slice(0, -2) + 'xx'), env)).status, 403);
  assert.equal((await worker.fetch(put('other-id', ticket), env)).status, 403);
  assert.equal((await worker.fetch(put(id, ticket, zip.subarray(0, 100)), env)).status, 400);
  assert.equal(Object.keys(s.assets).length, 0);
  assert.equal(s.pulls.length, 0);
}));

test('answers the browser pre-flight with CORS headers for the website only', async () => {
  const r = await worker.fetch(new Request('https://w.example/submit', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env);
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});
