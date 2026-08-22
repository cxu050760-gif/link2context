import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('progress UI loads before the interception content script', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  const pkg = JSON.parse(read('package.json'));
  assert.equal(manifest.version, pkg.version);
  const scripts = manifest.content_scripts[0].js;
  const interceptorIndex = scripts.findIndex((name) => /^content-script(?:-|\.js)/.test(name));
  assert.equal(scripts[0], 'progress-ui.js');
  assert.ok(interceptorIndex > 0);
});

test('progress panel shows elapsed time, history, success and persistent error state', () => {
  const ui = read('extension/progress-ui.js');
  assert.match(ui, /setInterval\(tick, 1000\)/);
  assert.match(ui, /MAX_LOGS = 7/);
  assert.match(ui, /state === 'success'/);
  assert.match(ui, /state === 'error'/);
  assert.match(ui, /hideTimer = setTimeout/);
});

test('progress panel isolates a new job from stale old-job messages', () => {
  const ui = read('extension/progress-ui.js');
  assert.match(ui, /currentStartedAt/);
  assert.match(ui, /incomingStartedAt !== currentStartedAt/);
  assert.match(ui, /resetForNewJob/);
  assert.match(ui, /logEl\.replaceChildren\(\)/);
});

test('closing the panel suppresses the current job until a new start arrives', () => {
  const ui = read('extension/progress-ui.js');
  assert.match(ui, /suppressedStartedAt = currentStartedAt/);
  assert.match(ui, /incomingStartedAt === suppressedStartedAt/);
  assert.match(ui, /suppressedStartedAt = 0/);
});

test('background reports fetch, fallback, classification and typed terminal stages', () => {
  const background = read('extension/background.js');
  for (const stage of [
    'direct-fetch', 'direct-retry', 'compatibility-retry',
    'fallback-open', 'fallback-wait', 'fallback-extract', 'fallback-extracted',
    'resolve-chatgpt', 'chatgpt-fallback-open', 'chatgpt-fallback-extract',
    'classify-resource', 'normalize', 'prepare-output', 'ready',
  ]) {
    assert.match(background, new RegExp(`['"]${stage}['"]`));
  }
  assert.match(background, /classifyFetchFailure/);
  assert.match(background, /stageLabel\(info\.stage\)/);
  assert.match(background, /code: info\.code/);
  assert.match(background, /errorStage: info\.stage/);
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
