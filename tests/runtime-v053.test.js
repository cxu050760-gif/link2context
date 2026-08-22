import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverNextPage, extractNextPageUrl, MAX_PAGINATION_PAGES } from '../extension/core/html-lite.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const runtime = read('extension/content-script-v053.js');
const qwenBridge = read('extension/qwen-state-bridge-v053.js');
const progress = read('extension/progress-ui.js');
const manifest = JSON.parse(read('extension/manifest.json'));
const pkg = JSON.parse(read('package.json'));
const scripts = manifest.content_scripts?.[0]?.js || [];

test('v053 regression 01: V0.6 package keeps V0.5.3 fallback runtime while version advances', () => {
  assert.equal(pkg.version, '0.6.0');
  assert.equal(manifest.version, '0.6.0');
  assert.ok(scripts.includes('qwen-state-bridge-v053.js'));
  assert.ok(scripts.includes('content-script-v053.js'));
});

test('v053 regression 02: legacy stacked V0.5.1 + V0.5.2 runtimes remain inactive', () => {
  assert.ok(scripts.includes('qwen-state-bridge-v053.js'));
  assert.ok(scripts.includes('content-script-v053.js'));
  assert.ok(!scripts.includes('content-script-v051.js'));
  assert.ok(!scripts.includes('handoff-reliability-v052.js'));
});

test('v053 regression 03: progress UI is initialized before URL interception', () => {
  assert.equal(scripts[0], 'progress-ui.js');
  assert.ok(scripts.indexOf('progress-ui.js') < scripts.indexOf('qwen-state-bridge-v053.js'));
  assert.ok(scripts.indexOf('progress-ui.js') < scripts.indexOf('content-script-v053.js'));
});

test('v053 regression 04: Qwen/Tongyi ordinary text fallback remains state-verified browser-edit adapter', () => {
  assert.match(qwenBridge, /async function qwenBrowserEdit/);
  assert.match(qwenBridge, /execCommand\?\.\('insertText'/);
  assert.match(qwenBridge, /QWEN_EDITOR_STATE_UNCONFIRMED/);
});

test('v053 regression 05: generic fallback still forbids direct DOM fallback for Qwen', () => {
  assert.match(runtime, /Direct DOM replacement is intentionally forbidden for Qwen\/Tongyi/);
  assert.match(runtime, /if \(qwenHost\) return false/);
});

test('v053 regression 06: Qwen fallback intercepts a pasted URL before generic V0.5.3 runtime', () => {
  const listener = qwenBridge.slice(qwenBridge.indexOf("document.addEventListener('paste'"), qwenBridge.indexOf("document.addEventListener('keydown'"));
  assert.match(listener, /stopEvent\(event\)/);
  assert.match(qwenBridge, /stopImmediatePropagation/);
});

test('v053 regression 07: Qwen fallback jobs read persisted auto-send preference', () => {
  assert.match(qwenBridge, /autoSubmit: await autoSendEnabled\(\)/);
  assert.match(qwenBridge, /SEND_KEY/);
});

test('v053 regression 08: STOP dispatches local cancellation before legacy background cancellation', () => {
  const local = progress.indexOf("document.dispatchEvent(new CustomEvent('link2context:cancel'");
  const remote = progress.indexOf("chrome.runtime.sendMessage({ type: 'L2C_CANCEL_JOB'");
  assert.ok(local >= 0 && remote > local);
});

test('v053 regression 09: both fallback runtimes consume local cancellation', () => {
  assert.match(runtime, /document\.addEventListener\('link2context:cancel'/);
  assert.match(runtime, /activeJob\.cancelled = true/);
  assert.match(qwenBridge, /document\.addEventListener\('link2context:cancel'/);
  assert.match(qwenBridge, /activeJob\.cancelled = true/);
});

test('v053 regression 10: generic attachment wait remains cancellation-aware', () => {
  const fn = runtime.slice(runtime.indexOf('async function attachFile'), runtime.indexOf('function sendScore'));
  assert.match(fn, /assertActive\(job\)/);
  assert.match(fn, /sleep\(250, job\)/);
});

test('v053 regression 11: generic auto-send wait and verification remain cancellation-aware', () => {
  const fn = runtime.slice(runtime.indexOf('async function reliableSubmit'), runtime.indexOf('function stopEvent'));
  assert.match(fn, /assertActive\(job\)/);
  assert.match(fn, /sleep\(250, job\)/);
  assert.match(fn, /sleep\(200, job\)/);
});

test('v053 regression 12: disabled send controls are never force-enabled', () => {
  for (const source of [runtime, qwenBridge]) {
    assert.doesNotMatch(source, /\.disabled\s*=\s*false/);
    assert.doesNotMatch(source, /removeAttribute\(['"]disabled['"]\)/);
    assert.match(source, /aria-disabled/);
  }
});

test('v053 regression 13: type=submit inside composer remains strong send signal', () => {
  assert.match(runtime, /getAttribute\('type'\).*=== 'submit'/);
  assert.match(runtime, /score \+= 14/);
  assert.match(qwenBridge, /getAttribute\('type'\).*=== 'submit'/);
});

test('v053 regression 14: attachment/search/voice/stop controls remain excluded', () => {
  assert.match(runtime, /stop\|cancel\|attach\|upload\|image\|photo\|camera\|voice\|mic\|record\|search\|tool/);
  assert.match(qwenBridge, /stop\|cancel\|attach\|upload\|image\|photo\|camera\|voice\|mic\|record\|search\|tool/);
});

test('v053 regression 15: button click alone never equals send success', () => {
  const generic = runtime.slice(runtime.indexOf('async function reliableSubmit'), runtime.indexOf('function stopEvent'));
  const qwen = qwenBridge.slice(qwenBridge.indexOf('async function submitVerified'), qwenBridge.indexOf('function isImageOnlyInput'));
  for (const fn of [generic, qwen]) {
    assert.match(fn, /button\.click\(\)/);
    assert.match(fn, /generatingEvidence\(\)/);
    assert.doesNotMatch(fn, /button\.click\(\);\s*return true/);
  }
});

test('v053 regression 16: text send evidence requires message evidence outside composer', () => {
  assert.match(runtime, /function evidenceOutsideComposer/);
  assert.match(runtime, /signature\.every/);
  assert.match(runtime, /composerText/);
});

test('v053 regression 17: original binaries remain original attachments', () => {
  const fn = runtime.slice(runtime.indexOf('async function prepareDelivery'), runtime.indexOf('function controlText'));
  assert.match(fn, /const originalBinary = result\.kind === 'binary' && !result\.convertedFromText/);
  assert.match(fn, /base64ToFile\(result\.base64, result\.fileName, result\.mime\)/);
  assert.match(qwenBridge, /const originalBinary = result\.kind === 'binary' && !result\.convertedFromText/);
});

test('v053 regression 18: Qwen binary proof still requires visible filename and sendability', () => {
  const fn = qwenBridge.slice(qwenBridge.indexOf('async function attachBinaryWithStateProof'), qwenBridge.indexOf('function stopEvent'));
  assert.match(fn, /const filenameVisible =/);
  assert.match(fn, /const send = findSendButton/);
  assert.match(fn, /if \(filenameVisible && send\)/);
});

test('v053 regression 19: failed auto-send remains SEND_UNCONFIRMED', () => {
  assert.match(runtime, /SEND_UNCONFIRMED/);
  assert.match(qwenBridge, /SEND_UNCONFIRMED/);
});

test('v053 regression 20: user cancellation has dedicated terminal state', () => {
  assert.match(runtime, /code === 'USER_CANCELLED' \|\| job\.cancelled/);
  assert.match(qwenBridge, /code === 'USER_CANCELLED' \|\| job\.cancelled/);
});

test('v053 regression 21: data-url pagination buttons can advance a public article', () => {
  const html = '<button class="pager-next" data-url="?page=2">下一页</button>';
  const out = discoverNextPage(html, 'https://example.com/read?page=1');
  assert.equal(out.url, 'https://example.com/read?page=2');
  assert.equal(out.reason, 'data-semantic-next');
});

test('v053 regression 22: JS-style numeric data-page controls synthesize page query', () => {
  const html = '<span class="current">2</span><button data-page="3">3</button><button data-page="4">4</button>';
  assert.equal(extractNextPageUrl(html, 'https://example.com/read?page=2'), 'https://example.com/read?page=3');
});

test('v053 regression 23: onclick pagination stays same-origin', () => {
  const html = '<button class="next" onclick="location.href=\'/story?page=2\'">Next page</button>';
  assert.equal(extractNextPageUrl(html, 'https://example.com/story?page=1'), 'https://example.com/story?page=2');
});

test('v053 regression 24: dynamic pagination cannot escape source origin', () => {
  const html = '<button class="next" data-url="https://evil.example/page=2">下一页</button>';
  assert.equal(extractNextPageUrl(html, 'https://example.com/read?page=1'), null);
});

test('v053 regression 25: pagination remains bounded', () => {
  assert.equal(MAX_PAGINATION_PAGES, 8);
});

test('v053 regression 26: V0.6 syntax check keeps both V0.5.3 fallback files', () => {
  assert.match(pkg.scripts.check, /qwen-state-bridge-v053\.js/);
  assert.match(pkg.scripts.check, /content-script-v053\.js/);
});
