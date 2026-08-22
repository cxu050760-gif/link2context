import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkBuddyShare, resolveSpecialUrl, workBuddyDataUrl } from '../extension/core/workbuddy.js';

test('extracts WorkBuddy share code exactly', () => {
  const u = new URL('https://workbuddy.link/p/fqAaNqzcOZ0DzTS9JZGXsM?ext2=copy_link');
  assert.equal(parseWorkBuddyShare(u), 'fqAaNqzcOZ0DzTS9JZGXsM');
});

test('builds public data URL', () => {
  assert.equal(workBuddyDataUrl('Ab12_Cd-34').href, 'https://workbuddy-space-static.codebuddy.work/page/Ab12_Cd-34/0/conversation-data.json');
});

test('generic URLs are not rewritten', () => {
  const u = new URL('https://example.com/data.json');
  const r = resolveSpecialUrl(u);
  assert.equal(r.kind, 'generic');
  assert.equal(r.fetchUrl.href, u.href);
});

test('rejects encoded slash or malformed share code', () => {
  assert.throws(() => parseWorkBuddyShare(new URL('https://workbuddy.link/p/abc%2Fdef')));
  assert.throws(() => workBuddyDataUrl('../secret'));
});

test('dot-segment path normalizes away and is not treated as a share', () => {
  assert.equal(parseWorkBuddyShare(new URL('https://workbuddy.link/p/%2e%2e')), null);
});
