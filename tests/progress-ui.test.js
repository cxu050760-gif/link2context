import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('v0.2.3 loads progress UI before the interception content script', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.equal(manifest.version, '0.2.3');
  assert.deepEqual(manifest.content_scripts[0].js.slice(0, 2), ['progress-ui.js', 'content-script.js']);
});

test('progress panel shows elapsed time, history, success and persistent error state', () => {
  const ui = read('extension/progress-ui.js');
  assert.match(ui, /setInterval\(tick, 1000\)/);
  assert.match(ui, /MAX_LOGS = 7/);
  assert.match(ui, /state === 'success'/);
  assert.match(ui, /state === 'error'/);
  assert.match(ui, /hideTimer = setTimeout/);
});

test('background reports important fetch, WorkBuddy fallback and parsing stages', () => {
  const background = read('extension/background.js');
  for (const stage of [
    'direct-fetch', 'direct-retry', 'compatibility-retry', 'direct-failed',
    'fallback-open', 'fallback-wait', 'fallback-extract', 'fallback-extracted',
    'normalize', 'prepare-output', 'ready', 'error',
  ]) {
    assert.match(background, new RegExp(`['"]${stage}['"]`));
  }
  assert.match(background, /chrome\.tabs\.sendMessage/);
});

test('fetch helper exposes retry and compatibility progress without coupling fetch to UI', () => {
  const fetchUrl = read('extension/core/fetch-url.js');
  assert.match(fetchUrl, /onProgress/);
  assert.match(fetchUrl, /stage: 'retry'/);
  assert.match(fetchUrl, /stage: 'compatibility-retry'/);
  assert.match(fetchUrl, /progress reporting must never break fetch/);
});

test('package and manifest versions stay aligned', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.version, manifest.version);
});
