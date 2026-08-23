import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const background = read('extension/background-v053.js');
const pipeline = read('extension/background-pipeline-v06.js');
const generic = read('extension/content-script-v06.js');
const qianwen = read('extension/qianwen-structured-v06.js');
const offscreen = read('extension/offscreen-v06.js');
const rendered = read('extension/core/rendered-acquisition-v06.js');
const images = read('extension/core/image-assets-v06.js');
const fetchUrl = read('extension/core/fetch-url.js');

test('v0.6 generic CDP surface cannot insert text and requires explicit auto-send', () => {
  const targetBranch = background.slice(background.indexOf("if (message.type === TARGET_DEBUGGER_MESSAGE)"));
  assert.match(targetBranch, /message\.action !== 'pressEnter'/);
  assert.match(targetBranch, /explicitAutoSendEnabled/);
  assert.match(targetBranch, /TARGET_DEBUGGER_HOST_DENIED/);
  assert.doesNotMatch(targetBranch, /message\.action === 'insertText'/);
});

test('v0.6 debugger revalidates the current tab host after attach and before each input command', () => {
  assert.match(background, /async function requireCurrentDebuggerHost/);
  assert.match(background, /chrome\.tabs\.get\(tabId\)/);
  assert.match(background, /QIANWEN_DEBUGGER_NAVIGATION_DENIED/);
  assert.match(background, /const navigationCode = String\(prefix\) \+ '_NAVIGATION_DENIED'/);
  assert.match(background, /pressEnterViaDebugger\(tabId, 'TARGET_DEBUGGER', isV06AutoSendFallbackHost\)/);
  const insert = background.slice(background.indexOf('async function insertTextViaDebugger'), background.indexOf('async function pressEnterViaDebugger'));
  assert.match(insert, /requireCurrentDebuggerHost[\s\S]*Input\.insertText/);
  const enter = background.slice(background.indexOf('async function pressEnterViaDebugger'), background.indexOf('async function explicitAutoSendEnabled'));
  assert.equal((enter.match(/requireCurrentDebuggerHost/g) || []).length, 2);
});

test('v0.6 generic auto-send is fail-closed and does not chain side effects after an unconfirmed attempt', () => {
  const start = generic.indexOf('async function autoSubmit');
  const end = generic.indexOf('async function preparePrimary', start);
  const section = generic.slice(start, end);
  assert.ok(section.indexOf("strategy: 'target-button'") < section.indexOf("strategy: 'form-submit'"));
  assert.ok(section.indexOf("strategy: 'form-submit'") < section.indexOf('L2C_TARGET_CDP_V06'));
  assert.match(section, /verifySent/);
  assert.match(section, /target-button-unconfirmed/);
  assert.match(section, /form-submit-unconfirmed/);
  assert.match(section, /cdp-enter-unconfirmed/);
  assert.match(section, /return \{ ok: false, strategy: 'none' \}/);
});

test('v0.6 upstream partial state disables auto-send before any page send attempt', () => {
  for (const source of [generic, qianwen]) {
    assert.match(source, /const upstreamPartial = Boolean\(result\.partial \|\| result\.sourcePartial \|\| result\.mediaPartial\)/);
    assert.match(source, /if \(upstreamPartial\) \{[\s\S]*job\.autoSubmit = false/);
    assert.match(source, /UPSTREAM_PARTIAL/);
  }
  assert.match(pipeline, /partialReasons/);
  assert.match(pipeline, /sourcePartial/);
  assert.match(pipeline, /mediaPartial/);
});

test('v0.6 page-handoff media failures disable auto-send instead of silently dropping images', () => {
  assert.match(generic, /failedAssets\.length[\s\S]*job\.autoSubmit = false/);
  assert.match(generic, /MEDIA_HANDOFF_PARTIAL/);
  assert.match(qianwen, /failedAssets\.length[\s\S]*job\.autoSubmit = false/);
  assert.match(qianwen, /MEDIA_HANDOFF_PARTIAL/);
});

test('v0.6 Qianwen text still uses the live-proven CDP insertText path', () => {
  assert.match(qianwen, /L2C_QIANWEN_CDP/);
  assert.match(qianwen, /await cdp\('insertText', text\)/);
  assert.match(qianwen, /blur\(\)/);
  assert.match(qianwen, /focus\(\)/);
  assert.match(qianwen, /await cdp\('pressEnter'\)/);
});

test('v0.6 content/background progress and STOP share the exact same job identity', () => {
  for (const source of [generic, qianwen]) {
    assert.match(source, /resolveUrl\(url, startedAt\)/);
    assert.match(source, /L2C_RESOLVE_URL_V06[\s\S]*startedAt/);
    assert.match(source, /startedAt: Number\(extra\.startedAt\) \|\| activeJob\?\.startedAt/);
    const cancelStart = source.indexOf("document.addEventListener('link2context:cancel'");
    const cancelEnd = source.indexOf("document.addEventListener('paste'", cancelStart);
    const cancel = source.slice(cancelStart, cancelEnd);
    assert.match(cancel, /const startedAt = activeJob\.startedAt/);
    assert.match(cancel, /L2C_CANCEL_JOB_V06['"][\s\S]*\{ startedAt \}/);
    assert.match(cancel, /L2C_CANCEL_JOB['"][\s\S]*\{ startedAt \}/);
  }
  assert.match(pipeline, /reportFor\(sender, requestedStartedAt = 0\)/);
  assert.match(pipeline, /Number\(message\.startedAt\) !== job\.startedAt/);
  assert.match(pipeline, /reason: 'stale-job'/);
});

test('v0.6 pipeline preserves proven special-source and original-binary fallbacks', () => {
  assert.match(pipeline, /special-source:\$\{resolved\.kind\}/);
  assert.match(pipeline, /original-binary:\$\{resource\.kind\}/);
  assert.match(pipeline, /fallbackToLegacy: true/);
});

test('v0.6 primary and image fetches keep the public targetAddressSpace guard by default', () => {
  assert.match(fetchUrl, /proxyCompatibilityFallback = options\.proxyCompatibilityFallback === true/);
  assert.doesNotMatch(images, /proxyCompatibilityFallback:\s*true/);
  assert.match(images, /proxyCompatibilityFallback:\s*false/);
});

test('v0.6 rendered acquisition is origin-pinned and will not auto-submit forms while loading more', () => {
  assert.match(rendered, /expectedOrigin/);
  assert.match(rendered, /BROWSER_CONTEXT_CROSS_ORIGIN_NAVIGATION/);
  assert.match(rendered, /el\.closest\('form'\)/);
  assert.match(rendered, /getAttribute\('type'\).*=== 'submit'/s);
});

test('v0.6 image cancellation remains cancellation rather than becoming a partial success', () => {
  assert.match(images, /function throwIfCancelled/);
  assert.match(images, /if \(signal\?\.aborted \|\| error\?\.code === 'USER_CANCELLED'\) throwIfCancelled\(signal\)/);
});

test('v0.6 HTML parser uses Readability with semantic fallback and bounded hostile structures', () => {
  assert.match(offscreen, /new globalThis\.Readability/);
  assert.match(offscreen, /mozilla-readability\+structured-dom/);
  assert.match(offscreen, /semantic-dom-fallback/);
  assert.match(offscreen, /MAX_TABLE_ROWS = 500/);
  assert.match(offscreen, /MAX_TABLE_COLUMNS = 80/);
  assert.match(offscreen, /MAX_TABLE_CELL_CHARS = 20_000/);
  assert.match(offscreen, /MAX_LIST_ITEMS = 1000/);
  assert.match(offscreen, /truncated: walked\.truncated/);
});
