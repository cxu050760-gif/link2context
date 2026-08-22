import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('manifest grants only the browser APIs needed by the navigation fallback', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.ok(manifest.permissions.includes('tabs'));
  assert.ok(manifest.permissions.includes('scripting'));
  assert.ok(manifest.host_permissions.includes('https://*/*'));
});

test('WorkBuddy direct fetch failure has a real browser-navigation fallback', () => {
  const background = read('extension/background.js');
  assert.match(background, /resolved\.kind === 'workbuddy'/);
  assert.match(background, /readWorkBuddyViaBackgroundTab/);
  assert.match(background, /chrome\.tabs\.create\(\{ url: target\.href, active: false \}\)/);
  assert.match(background, /chrome\.scripting\.executeScript/);
  assert.match(background, /chrome\.tabs\.remove\(tabId\)/);
});

test('navigation fallback is pinned to the official WorkBuddy static host', () => {
  const background = read('extension/background.js');
  assert.match(background, /WORKBUDDY_STATIC_HOST = 'workbuddy-space-static\.codebuddy\.work'/);
  assert.match(background, /url\.hostname\.toLowerCase\(\) !== WORKBUDDY_STATIC_HOST/);
  assert.match(background, /url\.protocol !== 'https:'/);
});

test('fallback still enforces the global response size cap', () => {
  const background = read('extension/background.js');
  assert.match(background, /MAX_FETCH_BYTES/);
  assert.match(background, /bytes\.byteLength > MAX_FETCH_BYTES/);
});
