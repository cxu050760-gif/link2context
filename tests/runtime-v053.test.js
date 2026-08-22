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

test('v053 01: package and manifest are V0.5.3', () => {
  assert.equal(pkg.version, '0.5.3');
  assert.equal(manifest.version, '0.5.3');
});

test('v053 02: manifest loads current V0.5.3 adapters instead of the V0.5.1 + V0.5.2 stacked runtime', () => {
  assert.ok(scripts.includes('qwen-state-bridge-v053.js'));
  assert.ok(scripts.includes('content-script-v053.js'));
  assert.ok(!scripts.includes('content-script-v051.js'));
  assert.ok(!scripts.includes('handoff-reliability-v052.js'));
});

test('v053 03: progress UI is initialized before URL interception', () => {
  assert.equal(scripts[0], 'progress-ui.js');
  assert.ok(scripts.indexOf('progress-ui.js') < scripts.indexOf('qwen-state-bridge-v053.js'));
  assert.ok(scripts.indexOf('progress-ui.js') < scripts.indexOf('content-script-v053.js'));
});

test('v053 04: Qwen/Tongyi ordinary text is owned by the state-verified browser-edit adapter', () => {
  assert.match(qwenBridge, /async function qwenBrowserEdit/);
  assert.match(qwenBridge, /execCommand\?\.\('insertText'/);
  assert.match(qwenBridge, /QWEN_EDITOR_STATE_UNCONFIRMED/);
});

test('v053 05: generic runtime still forbids direct DOM fallback for Qwen', () => {
  assert.match(runtime, /Direct DOM replacement is intentionally forbidden for Qwen\/Tongyi/);
  assert.match(runtime, /if \(qwenHost\) return false/);
});

test('v053 06: Qwen adapter intercepts a pasted URL before the generic runtime can own it', () => {
  const listener = qwenBridge.slice(qwenBridge.indexOf("document.addEventListener('paste'"), qwenBridge.indexOf("document.addEventListener('keydown'"));
  assert.match(listener, /stopEvent\(event\)/);
  assert.match(qwenBridge, /stopImmediatePropagation/);
});

test('v053 07: Qwen paste-triggered jobs read the persisted auto-send preference', () => {
  assert.match(qwenBridge, /autoSubmit: await autoSendEnabled\(\)/);
  assert.match(qwenBridge, /SEND_KEY/);
});

test('v053 08: STOP dispatches a local cancellation event before background cancellation', () => {
  const local = progress.indexOf("document.dispatchEvent(new CustomEvent('link2context:cancel'");
  const remote = progress.indexOf("chrome.runtime.sendMessage({ type: 'L2C_CANCEL_JOB'");
  assert.ok(local >= 0 && remote > local);
});

test('v053 09: both current runtimes consume the local cancellation event', () => {
  assert.match(runtime, /document\.addEventListener\('link2context:cancel'/);
  assert.match(runtime, /activeJob\.cancelled = true/);
  assert.match(qwenBridge, /document\.addEventListener\('link2context:cancel'/);
  assert.match(qwenBridge, /activeJob\.cancelled = true/);
});

test('v053 10: generic attachment wait is cancellation-aware', () => {
  const fn = runtime.slice(runtime.indexOf('async function attachFile'), runtime.indexOf('function sendScore'));
  assert.match(fn, /assertActive\(job\)/);
  assert.match(fn, /sleep\(250, job\)/);
});

test('v053 11: generic auto-send wait and verification are cancellation-aware', () => {
  const fn = runtime.slice(runtime.indexOf('async function reliableSubmit'), runtime.indexOf('function stopEvent'));
  assert.match(fn, /assertActive\(job\)/);
  assert.match(fn, /sleep\(250, job\)/);
  assert.match(fn, /sleep\(200, job\)/);
});

test('v053 12: disabled send controls are never force-enabled', () => {
  for (const source of [runtime, qwenBridge]) {
    assert.doesNotMatch(source, /\.disabled\s*=\s*false/);
    assert.doesNotMatch(source, /removeAttribute\(['"]disabled['"]\)/);
    assert.match(source, /aria-disabled/);
  }
});

test('v053 13: type=submit inside the composer is a strong send signal', () => {
  assert.match(runtime, /getAttribute\('type'\).*=== 'submit'/);
  assert.match(runtime, /score \+= 14/);
  assert.match(qwenBridge, /getAttribute\('type'\).*=== 'submit'/);
});

test('v053 14: attachment, search, voice and stop controls are excluded from send candidates', () => {
  assert.match(runtime, /stop\|cancel\|attach\|upload\|image\|photo\|camera\|voice\|mic\|record\|search\|tool/);
  assert.match(qwenBridge, /stop\|cancel\|attach\|upload\|image\|photo\|camera\|voice\|mic\|record\|search\|tool/);
});

test('v053 15: clicking a send button is not itself considered success', () => {
  const generic = runtime.slice(runtime.indexOf('async function reliableSubmit'), runtime.indexOf('function stopEvent'));
  const qwen = qwenBridge.slice(qwenBridge.indexOf('async function submitVerified'), qwenBridge.indexOf('function isImageOnlyInput'));
  for (const fn of [generic, qwen]) {
    assert.match(fn, /button\.click\(\)/);
    assert.match(fn, /generatingEvidence\(\)/);
    assert.doesNotMatch(fn, /button\.click\(\);\s*return true/);
  }
});

test('v053 16: generic text send evidence requires message evidence outside the composer', () => {
  assert.match(runtime, /function evidenceOutsideComposer/);
  assert.match(runtime, /signature\.every/);
  assert.match(runtime, /composerText/);
});

test('v053 17: original binary resources are still preserved as original attachments', () => {
  const fn = runtime.slice(runtime.indexOf('async function prepareDelivery'), runtime.indexOf('function controlText'));
  assert.match(fn, /const originalBinary = result\.kind === 'binary' && !result\.convertedFromText/);
  assert.match(fn, /base64ToFile\(result\.base64, result\.fileName, result\.mime\)/);
  assert.match(qwenBridge, /const originalBinary = result\.kind === 'binary' && !result\.convertedFromText/);
});

test('v053 18: Qwen binary attachment proof requires both visible filename and Qwen sendability', () => {
  const fn = qwenBridge.slice(qwenBridge.indexOf('async function attachBinaryWithStateProof'), qwenBridge.indexOf('function stopEvent'));
  assert.match(fn, /const filenameVisible =/);
  assert.match(fn, /const send = findSendButton/);
  assert.match(fn, /if \(filenameVisible && send\)/);
});

test('v053 19: failed auto-send remains SEND_UNCONFIRMED instead of pretending success', () => {
  assert.match(runtime, /SEND_UNCONFIRMED/);
  assert.match(qwenBridge, /SEND_UNCONFIRMED/);
});

test('v053 20: user cancellation has a dedicated terminal state', () => {
  assert.match(runtime, /code === 'USER_CANCELLED' \|\| job\.cancelled/);
  assert.match(qwenBridge, /code === 'USER_CANCELLED' \|\| job\.cancelled/);
});

test('v053 21: data-url pagination buttons can advance a public article', () => {
  const html = '<button class="pager-next" data-url="?page=2">下一页</button>';
  const out = discoverNextPage(html, 'https://example.com/read?page=1');
  assert.equal(out.url, 'https://example.com/read?page=2');
  assert.equal(out.reason, 'data-semantic-next');
});

test('v053 22: JS-style numeric data-page controls can synthesize the existing page query', () => {
  const html = '<span class="current">2</span><button data-page="3">3</button><button data-page="4">4</button>';
  assert.equal(extractNextPageUrl(html, 'https://example.com/read?page=2'), 'https://example.com/read?page=3');
});

test('v053 23: onclick location pagination can be followed when it stays same-origin', () => {
  const html = '<button class="next" onclick="location.href=\'/story?page=2\'">Next page</button>';
  assert.equal(extractNextPageUrl(html, 'https://example.com/story?page=1'), 'https://example.com/story?page=2');
});

test('v053 24: dynamic pagination declarations cannot escape the source origin', () => {
  const html = '<button class="next" data-url="https://evil.example/page=2">下一页</button>';
  assert.equal(extractNextPageUrl(html, 'https://example.com/read?page=1'), null);
});

test('v053 25: pagination remains bounded', () => {
  assert.equal(MAX_PAGINATION_PAGES, 8);
});

test('v053 26: package syntax check includes both current V0.5.3 runtime files', () => {
  assert.match(pkg.scripts.check, /qwen-state-bridge-v053\.js/);
  assert.match(pkg.scripts.check, /content-script-v053\.js/);
});
