import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const content = fs.readFileSync(path.join(root, 'extension/content-script-v051.js'), 'utf8');

test('attack 01: Qwen and Tongyi hosts are explicitly treated as managed editors', () => {
  assert.match(content, /chat\.qwen\.ai/);
  assert.match(content, /qwen\.ai/);
  assert.match(content, /tongyi\.aliyun\.com/);
  assert.match(content, /const qwenHost =/);
});

test('attack 02: managed rich editors use a ClipboardEvent paste path first', () => {
  const fn = content.slice(content.indexOf('async function pasteIntoManagedEditor'), content.indexOf('async function setEditorText'));
  assert.match(fn, /new DataTransfer\(\)/);
  assert.match(fn, /new ClipboardEvent\('paste'/);
  assert.match(fn, /text\/plain/);
});

test('attack 03: managed rich editors do not fall back to direct Range.insertNode mutation', () => {
  const fn = content.slice(content.indexOf('async function setEditorText'), content.indexOf('function controlMeta'));
  assert.match(fn, /if \(isManagedRichEditor\(editor\)\)/);
  assert.match(fn, /return pasteIntoManagedEditor\(editor, value\)/);
  const beforeGenericFallback = fn.slice(0, fn.indexOf('const range = selectEditorContents'));
  assert.doesNotMatch(beforeGenericFallback, /insertNode/);
});

test('attack 04: framework state insertion is verified before success is reported', () => {
  assert.match(content, /function looksInserted/);
  assert.match(content, /if \(looksInserted\(editor, value\)\)/);
  assert.match(content, /if \(inserted && looksInserted\(editor, value\)\)/);
});

test('attack 05: failed Qwen stateful insertion fails closed instead of corrupting the editor', () => {
  assert.match(content, /QWEN_EDITOR_STATE_REJECTED/);
  assert.match(content, /为避免再次把输入框写死/);
  assert.match(content, /return false;\n  }\n\n  async function setEditorText/);
});

test('attack 06: disabled send controls are detected but never force-clicked', () => {
  assert.match(content, /findSendButton\(editor, true\)/);
  assert.match(content, /它仍处于 disabled \/ aria-disabled 状态；未强行点击/);
  assert.doesNotMatch(content, /\.disabled\s*=\s*false/);
  assert.doesNotMatch(content, /removeAttribute\(['"]disabled/);
});

test('attack 07: Qwen gets a longer state-settle window before auto-submit', () => {
  assert.match(content, /qwenHost \? 260 : 120/);
  assert.match(content, /qwenHost \? 6000 : 3000/);
});

test('attack 08: forced Markdown mode uses a real File and never HTML injection', () => {
  assert.match(content, /new File\(\[markdown\], fileName, \{ type: 'text\/markdown' \}\)/);
  assert.doesNotMatch(content, /\.innerHTML\s*=/);
  assert.doesNotMatch(content, /insertAdjacentHTML/);
});

test('attack 09: forced long-text mode decodes UTF-8 instead of byte-to-string corruption', () => {
  assert.match(content, /new TextDecoder\('utf-8'/);
  assert.match(content, /base64ToUtf8/);
  assert.doesNotMatch(content, /decodeURIComponent\(escape/);
});

test('attack 10: original binary attachments remain attachments in every preference mode', () => {
  const prepare = content.slice(content.indexOf('async function prepareDelivery'), content.indexOf('async function waitForSendButton'));
  const originalBinaryBranch = prepare.indexOf("result.kind === 'binary' && !result.convertedFromText");
  const documentBranch = prepare.indexOf("selected === 'document'");
  const textBranch = prepare.indexOf("selected === 'text'");
  assert.ok(originalBinaryBranch >= 0);
  assert.ok(documentBranch > originalBinaryBranch);
  assert.ok(textBranch > originalBinaryBranch);
});

test('attack 11: huge converted text refuses unsafe forced-inline injection', () => {
  assert.match(content, /markdown\.length < TEXT_HARD_LIMIT_CHARS/);
  assert.match(content, /超过安全上限/);
});

test('attack 12: synthetic paste cannot recursively trigger Link2Context URL interception', () => {
  const listener = content.slice(content.indexOf("document.addEventListener('paste'"), content.indexOf("document.addEventListener('keydown'"));
  assert.match(listener, /!event\.isTrusted/);
});

test('attack 13: attachment send waits until the target UI visibly registers the filename', () => {
  assert.match(content, /async function waitForAttachmentReady/);
  assert.match(content, /if \(fileName && text\.includes\(fileName\)\) return true/);
  assert.match(content, /Attachment was not confirmed/);
});

test('attack 14: upstream failure stage is preserved instead of being mislabeled as Qwen handoff', () => {
  assert.match(content, /failure\.l2cStage = result\?\.errorStage \|\| 'PIPELINE'/);
  assert.match(content, /const errorStage = String\(error\?\.l2cStage \|\| 'HANDOFF'\)\.toUpperCase\(\)/);
});

test('attack 15: only a real user gesture can start URL interception from page events', () => {
  assert.match(content, /!event\.isTrusted/);
  assert.match(content, /userGesture: true/);
});

test('attack 16: non-Qwen generic contenteditable fallback stays isolated from managed-editor branch', () => {
  const setter = content.slice(content.indexOf('async function setEditorText'), content.indexOf('function controlMeta'));
  const managed = setter.indexOf('if (isManagedRichEditor(editor))');
  const range = setter.indexOf('const range = selectEditorContents(editor)');
  assert.ok(managed >= 0 && range > managed);
});
