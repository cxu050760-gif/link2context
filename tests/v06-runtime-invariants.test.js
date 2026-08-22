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

test('v0.6 generic CDP surface cannot insert text and requires explicit auto-send', () => {
  const targetBranch = background.slice(background.indexOf("if (message.type === TARGET_DEBUGGER_MESSAGE)"));
  assert.match(targetBranch, /message\.action !== 'pressEnter'/);
  assert.match(targetBranch, /explicitAutoSendEnabled/);
  assert.match(targetBranch, /TARGET_DEBUGGER_HOST_DENIED/);
  assert.doesNotMatch(targetBranch, /message\.action === 'insertText'/);
});

test('v0.6 generic auto-send is fail-closed with button, form, then bounded CDP Enter', () => {
  const start = generic.indexOf('async function autoSubmit');
  const end = generic.indexOf('async function preparePrimary', start);
  const section = generic.slice(start, end);
  assert.ok(section.indexOf("strategy: 'target-button'") < section.indexOf("strategy: 'form-submit'"));
  assert.ok(section.indexOf("strategy: 'form-submit'") < section.indexOf('L2C_TARGET_CDP_V06'));
  assert.match(section, /verifySent/);
  assert.match(section, /return \{ ok: false, strategy: 'none' \}/);
});

test('v0.6 partial media handoff disables auto-send instead of silently dropping images', () => {
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

test('v0.6 pipeline preserves proven special-source and original-binary fallbacks', () => {
  assert.match(pipeline, /special-source:\$\{resolved\.kind\}/);
  assert.match(pipeline, /original-binary:\$\{resource\.kind\}/);
  assert.match(pipeline, /fallbackToLegacy: true/);
});

test('v0.6 HTML parser uses Readability with a semantic DOM fallback and structured media', () => {
  assert.match(offscreen, /new globalThis\.Readability/);
  assert.match(offscreen, /mozilla-readability\+structured-dom/);
  assert.match(offscreen, /semantic-dom-fallback/);
  assert.match(offscreen, /type: 'table'/);
  assert.match(offscreen, /type: 'image'/);
  assert.match(offscreen, /srcset/);
  assert.match(offscreen, /data-lazy-src/);
});
