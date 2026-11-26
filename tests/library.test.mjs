import test from 'node:test';
import assert from 'node:assert/strict';
import { readSubmission, sections, sniff } from '../scripts/library.mjs';

const body = (over = {}) => {
  const v = {
    'What is it?': 'Chassis', 'Made for': 'SlotForge Frame', 'Oldest app version it opens in': 'v0.1.0',
    'Scale': '1/32', 'Description': 'A rail-frame chassis for a Datsun 240Z body.',
    'Picture': '![shot](https://github.com/user-attachments/assets/0b7a1c2e-1111-2222-3333-444455556666)',
    'Files': '[datsun.zip](https://github.com/user-attachments/files/123456/datsun.zip)',
    'Printed and tested?': 'Yes, printed and tested', 'Print notes': 'Bambu, PETG, 0.2 mm.',
    'Licence': 'CC BY 4.0 (credit me)', 'Name to show': '_No response_',
    'Your rights': '- [X] I made this\n- [X] It contains no paid parts', ...over,
  };
  return Object.entries(v).map(([k, x]) => `### ${k}\n\n${x}`).join('\n\n');
};
const issue = (over, title = '[Library] Datsun rail frame') => ({ number: 7, title, body: body(over), user: { login: 'racer' } });

test('reads a complete submission', () => {
  const { item, previewUrl, filesUrl } = readSubmission(issue());
  assert.equal(item.id, 'datsun-rail-frame-7');
  assert.equal(item.type, 'chassis');
  assert.equal(item.app, 'Frame');
  assert.equal(item.appVersion, '0.1.0');
  assert.equal(item.printed, 'tested');
  assert.equal(item.author, 'racer');
  assert.equal(item.licence, 'CC-BY-4.0');
  assert.match(previewUrl, /user-attachments\/assets/);
  assert.match(filesUrl, /datsun\.zip$/);
});

test('a plain STL has no app or version', () => {
  const { item } = readSubmission(issue({ 'What is it?': 'Building', 'Made for': 'Any 3D printer (STL)', 'Scale': 'Not scale-specific' }));
  assert.equal(item.app, null);
  assert.equal(item.appVersion, null);
  assert.equal(item.scale, null);
});

test('refuses links that are not GitHub uploads', () => {
  assert.throws(() => readSubmission(issue({ 'Files': '[x.zip](https://evil.example/x.zip)' })), /Drag a \.zip/);
  assert.throws(() => readSubmission(issue({ 'Picture': '![x](https://evil.example/x.png)' })), /Drag a picture/);
});

test('refuses missing ticks, bad versions and unknown answers', () => {
  assert.throws(() => readSubmission(issue({ 'Your rights': '- [X] one\n- [ ] two' })), /Your rights/);
  assert.throws(() => readSubmission(issue({ 'Oldest app version it opens in': 'latest' })), /not an app version/);
  assert.throws(() => readSubmission(issue({ 'What is it?': 'Spaceship' })), /does not know/);
  assert.throws(() => readSubmission(issue({}, '[Library] ')), /name in the issue title/);
});

test('escapes nothing itself but strips control characters and trims', () => {
  const { item } = readSubmission(issue({ 'Description': '  <b>Bold</b>\u0007 claim  ' }));
  assert.equal(item.description, '<b>Bold</b> claim');
});

test('sections handles CRLF and empty answers', () => {
  assert.deepEqual(sections('### A\r\n\r\n_No response_\r\n\r\n### B\r\n\r\nx'), { A: '', B: 'x' });
});

test('sniffs file types', () => {
  assert.equal(sniff(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])), 'png');
  assert.equal(sniff(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0])), 'zip');
  assert.equal(sniff(Uint8Array.from([0x3c, 0x73, 0x76, 0x67, 0, 0, 0, 0, 0, 0, 0, 0])), null);
});
