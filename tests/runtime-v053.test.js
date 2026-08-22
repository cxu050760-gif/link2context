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
const progress = read('extension/progress-ui.js');
const manifest = JSON.parse(read('extension/manifest.json'));
const pkg = JSON.parse(read('package.json'));
const scripts = manifest.content_scripts?.[0]?.js || [];

test('v053 01: package and manifest are V0.5.3', () => {
  assert.equal(pkg.version, '0.5.3');
  assert.equal(manifest.version, '0.5.3');
});

test('v053 02: manifest loads the V0.5.3 runtime instead of the V0.5.1 + V0.5.2 stacked runtime', () => {
  assert.ok(scripts.includes('content-script-v053.js'));
  assert.ok(!scripts.includes('content-script-v051.js'));
  assert.ok(!scripts.includes('handoff-reliability-v052.js'));
});

test('v053 03: progress UI is initialized before URL interception', () => {
  assert.equal(scripts[0], 'progress-ui.js');
  assert.ok(scripts.indexOf('progress-ui.js') < scripts.indexOf('content-script-v053.js'));
});

test('v053 04: Qwen/Tongyi text handoff is a state-safe document transport', () => {
  assert.match(runtime, /qwen-state-safe-document/);
  assert.match(runtime, /qwenTextFile/);
  assert.match(runtime, /type: 'text\/plain'/);
});

test('v053 05: Qwen safe handoff does not inject a composer note after attachment', () => {
  assert.match(runtime, /note: '',\n\s*qwenSafe: true/);
  assert.match(runtime, /if \(!prepared\.qwenSafe && prepared\.note\)/);
});

test('v053 06: direct DOM fallback is explicitly forbidden for Qwen', () => {
  assert.match(runtime, /Direct DOM replacement is intentionally forbidden for Qwen\/Tongyi/);
  assert.match(runtime, /if \(qwenHost\) return false/);
});

test('v053 07: pasted URLs are swallowed before Qwen can store the original URL', () => {
  const listener = runtime.slice(runtime.indexOf("document.addEventListener('paste'"), runtime.indexOf("document.addEventListener('keydown'"));
  assert.match(listener, /stopEvent\(event\)/);
  assert.match(listener, /trigger: 'paste'/);
});

test('v053 08: paste-triggered jobs read the persisted auto-send preference', () => {
  assert.match(runtime, /autoSubmit: await autoSendEnabled\(\)/);
  assert.match(runtime, /SEND_KEY/);
});

test('v053 09: manually typed Qwen URLs fail closed to manual send', () => {
  assert.match(runtime, /qwenHost && trigger !== 'paste'/);
  assert.match(runtime, /job\.autoSubmit = false/);
});

test('v053 10: STOP dispatches a local cancellation event before background cancellation', () => {
  const local = progress.indexOf("document.dispatchEvent(new CustomEvent('link2context:cancel'");
  const remote = progress.indexOf("chrome.runtime.sendMessage({ type: 'L2C_CANCEL_JOB'");
  assert.ok(local >= 0 && remote > local);
});

test('v053 11: runtime consumes the local cancellation event', () => {
  assert.match(runtime, /document\.addEventListener\('link2context:cancel'/);
  assert.match(runtime, /activeJob\.cancelled = true/);
});

test('v053 12: attachment wait is cancellation-aware', () => {
  const fn = runtime.slice(runtime.indexOf('async function attachFile'), runtime.indexOf('function sendScore'));
  assert.match(fn, /assertActive\(job\)/);
  assert.match(fn, /sleep\(250, job\)/);
});

test('v053 13: auto-send wait and verification are cancellation-aware', () => {
  const fn = runtime.slice(runtime.indexOf('async function reliableSubmit'), runtime.indexOf('function stopEvent'));
  assert.match(fn, /assertActive\(job\)/);
  assert.match(fn, /sleep\(250, job\)/);
  assert.match(fn, /sleep\(200, job\)/);
});

test('v053 14: disabled send controls are never force-enabled', () => {
  assert.doesNotMatch(runtime, /\.disabled\s*=\s*false/);
  assert.doesNotMatch(runtime, /removeAttribute\(['"]disabled['"]\)/);
  assert.match(runtime, /aria-disabled/);
});

test('v053 15: type=submit inside the composer is a strong send signal', () => {
  assert.match(runtime, /getAttribute\('type'\).*=== 'submit'/);
  assert.match(runtime, /score \+= 14/);
});

test('v053 16: icon-only local controls can be considered but require composer locality', () => {
  assert.match(runtime, /scope !== document && scope\.contains\(el\)/);
  assert.match(runtime, /el\.querySelector\?\.\('svg'\)/);
  assert.match(runtime, /item\.score >= 5/);
});

test('v053 17: document-wide send fallback requires a strong score', () => {
  assert.match(runtime, /item\.score >= 14/);
});

test('v053 18: attachment, search, voice and stop controls are excluded from send candidates', () => {
  assert.match(runtime, /stop\|cancel\|attach\|upload\|image\|photo\|camera\|voice\|mic\|record\|search\|tool/);
});

test('v053 19: clicking a send button is not itself considered success', () => {
  const fn = runtime.slice(runtime.indexOf('async function reliableSubmit'), runtime.indexOf('function stopEvent'));
  assert.match(fn, /button\.click\(\)/);
  assert.match(fn, /generatingEvidence\(\)/);
  assert.match(fn, /evidenceOutsideComposer/);
  assert.doesNotMatch(fn, /button\.click\(\);\s*return true/);
});

test('v053 20: text send evidence requires message evidence outside the composer', () => {
  assert.match(runtime, /function evidenceOutsideComposer/);
  assert.match(runtime, /signature\.every/);
  assert.match(runtime, /composerText/);
});

test('v053 21: attachment send evidence distinguishes composer chip from sent message', () => {
  assert.match(runtime, /const bodyHas = scopeHasFilename/);
  assert.match(runtime, /const composerHas = scopeHasFilename/);
  assert.match(runtime, /bodyHas && !composerHas/);
});

test('v053 22: original binary resources are still preserved as original attachments', () => {
  const fn = runtime.slice(runtime.indexOf('async function prepareDelivery'), runtime.indexOf('function controlText'));
  assert.match(fn, /const originalBinary = result\.kind === 'binary' && !result\.convertedFromText/);
  assert.match(fn, /base64ToFile\(result\.base64, result\.fileName, result\.mime\)/);
});

test('v053 23: Qwen text-file adaptation preserves content bytes as text instead of rewriting content', () => {
  assert.match(runtime, /new File\(\[markdown\], `\$\{cleanFileStem\(fromApi\)\}\.txt`/);
  assert.doesNotMatch(runtime, /markdown\.replace\(/);
});

test('v053 24: Qwen temporary accept widening is restored after synthetic file assignment', () => {
  assert.match(runtime, /const oldAccept = input\.getAttribute\('accept'\)/);
  assert.match(runtime, /input\.removeAttribute\('accept'\)/);
  assert.match(runtime, /input\.setAttribute\('accept', oldAccept\)/);
});

test('v053 25: image-only file inputs are not reused for document handoff', () => {
  assert.match(runtime, /function isImageOnlyInput/);
  assert.match(runtime, /filter\(\(input\) => !isImageOnlyInput\(input\)\)/);
});

test('v053 26: input.files assignment alone is not attachment success', () => {
  const fn = runtime.slice(runtime.indexOf('async function attachFile'), runtime.indexOf('function sendScore'));
  assert.match(fn, /input\.files = dt\.files/);
  assert.match(fn, /scopeHasFilename/);
  assert.match(fn, /15_000/);
});

test('v053 27: one active page handoff prevents overlapping auto-send races', () => {
  assert.match(runtime, /let activeJob = null/);
  assert.match(runtime, /if \(activeJob\?\.busy\)/);
});

test('v053 28: failed auto-send remains SEND_UNCONFIRMED instead of pretending success', () => {
  assert.match(runtime, /SEND_UNCONFIRMED/);
  assert.match(runtime, /自动发送未确认/);
});

test('v053 29: user cancellation has a dedicated terminal state', () => {
  assert.match(runtime, /code === 'USER_CANCELLED' \|\| job\.cancelled/);
  assert.match(runtime, /网络读取、附件交付和自动发送均已停止/);
});

test('v053 30: data-url pagination buttons can advance a public article', () => {
  const html = '<button class="pager-next" data-url="?page=2">下一页</button>';
  const out = discoverNextPage(html, 'https://example.com/read?page=1');
  assert.equal(out.url, 'https://example.com/read?page=2');
  assert.equal(out.reason, 'data-semantic-next');
});

test('v053 31: JS-style numeric data-page controls can synthesize the existing page query', () => {
  const html = '<span class="current">2</span><button data-page="3">3</button><button data-page="4">4</button>';
  assert.equal(extractNextPageUrl(html, 'https://example.com/read?page=2'), 'https://example.com/read?page=3');
});

test('v053 32: onclick location pagination can be followed when it stays same-origin', () => {
  const html = '<button class="next" onclick="location.href=\'/story?page=2\'">Next page</button>';
  assert.equal(extractNextPageUrl(html, 'https://example.com/story?page=1'), 'https://example.com/story?page=2');
});

test('v053 33: dynamic pagination declarations cannot escape the source origin', () => {
  const html = '<button class="next" data-url="https://evil.example/page=2">下一页</button>';
  assert.equal(extractNextPageUrl(html, 'https://example.com/read?page=1'), null);
});

test('v053 34: pagination remains bounded', () => {
  assert.equal(MAX_PAGINATION_PAGES, 8);
});

test('v053 35: package syntax check includes the current V0.5.3 runtime', () => {
  assert.match(pkg.scripts.check, /content-script-v053\.js/);
});
