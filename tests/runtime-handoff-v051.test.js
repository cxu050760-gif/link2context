import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function loadDeliveryApi() {
  const context = { globalThis: {}, URL };
  vm.runInNewContext(read('extension/delivery-mode.js'), context);
  return context.globalThis.Link2ContextDelivery;
}

const api = loadDeliveryApi();
const content = read('extension/content-script-v051.js');
const popupHtml = read('extension/popup.html');
const popupJs = read('extension/popup.js');

test('attack 01: send preference fails safe to manual for missing or unknown values', () => {
  assert.equal(api.normalizeSendMode(undefined), 'manual');
  assert.equal(api.normalizeSendMode('garbage'), 'manual');
});

test('attack 02: explicit auto-send remains opt-in and case-insensitive', () => {
  assert.equal(api.normalizeSendMode('auto'), 'auto');
  assert.equal(api.normalizeSendMode('AUTO'), 'auto');
});

test('attack 03: attachment confirmation keeps the exact filename as the strongest hint', () => {
  const name = 'workbuddy.link-p-8yphOaKetKX8MnZow8EE4n.md';
  assert.ok(api.attachmentNameHints(name).includes(name));
});

test('attack 04: truncated attachment chips can be recognized by a distinctive filename prefix', () => {
  const hints = api.attachmentNameHints('workbuddy.link-p-8yphOaKetKX8MnZow8EE4n.md');
  assert.ok(hints.some((hint) => hint.startsWith('workbuddy.link-p-8y')));
  assert.ok(hints.some((hint) => hint.length >= 12 && hint.length <= 24));
});

test('attack 05: short generic fragments are not accepted as attachment proof', () => {
  assert.equal(api.attachmentNameHints('a.md').length, 0);
});

test('attack 06: popup exposes manual review and auto-send as separate choices', () => {
  assert.match(popupHtml, /id="sendPreference"/);
  assert.match(popupHtml, /value="manual"/);
  assert.match(popupHtml, /value="auto"/);
});

test('attack 07: manual review is presented as the default/recommended send behavior', () => {
  const manual = popupHtml.indexOf('<option value="manual">');
  const auto = popupHtml.indexOf('<option value="auto">自动发送');
  assert.ok(manual >= 0 && auto > manual);
  assert.match(popupHtml, /手动确认 \/ Manual（推荐，默认）/);
});

test('attack 08: popup persists send preference independently from handoff format', () => {
  assert.match(popupJs, /SEND_PREFERENCE_KEY/);
  assert.match(popupJs, /chrome\.storage\.local\.set\(\{ \[SEND_PREFERENCE_KEY\]: mode \}\)/);
  assert.match(popupJs, /refreshSendPreferenceUi/);
});

test('attack 09: runtime reads send preference from extension storage and fails safe to manual', () => {
  assert.match(content, /const SEND_KEY =/);
  assert.match(content, /async function getSendMode\(\)/);
  assert.match(content, /return 'manual';/);
});

test('attack 10: legacy V0.5.1 paste path still prepares only; V0.5.2 adds the independent reliability auto-send layer', () => {
  assert.match(content, /Paste only starts preparation\. It never sends immediately/);
  assert.match(content, /startJob\(editor, url\);/);
});

test('attack 11: Enter interception consults the send preference before setting autoSubmit', () => {
  assert.match(content, /document\.addEventListener\('keydown', async/);
  assert.match(content, /const autoSubmit = \(await getSendMode\(\)\) === 'auto';/);
  assert.match(content, /startJob\(editor, url, \{ autoSubmit \}\);/);
});

test('attack 12: click interception only preserves the original submit button in auto mode', () => {
  assert.match(content, /submitter: autoSubmit \? button : null/);
  assert.match(content, /if \(autoSubmit\) \{\s*existing\.autoSubmit = true;\s*existing\.submitter = button;/s);
});

test('attack 13: attachment readiness no longer requires the full filename to be visible', () => {
  assert.match(content, /scopeContainsAttachmentName\(scope, fileName\)/);
  assert.doesNotMatch(content, /if \(fileName && text\.includes\(fileName\)\) return true;/);
});

test('attack 14: a failed attachment confirmation reports handoff failure, not an auto-send failure', () => {
  assert.match(content, /已停止本次交付/);
  assert.doesNotMatch(content, /Attachment was not confirmed by the web AI; auto-send stopped/);
});

test('attack 15: Qwen can reveal a file input through a generic plus/more menu then a nested file action', () => {
  assert.match(content, /looksLikeAddMenu/);
  assert.match(content, /qwenHost\) attach = localControls\.find\(looksLikeAddMenu\)/);
  assert.match(content, /const nestedAttach = bestAttachmentControl/);
});

test('attack 16: attachment menu scoring prefers file/attachment actions over image-only actions', () => {
  assert.match(content, /attachmentControlScore/);
  assert.match(content, /\(file\|文件\).*score \+= 7/);
  assert.match(content, /\(image\|photo\|图片\|照片\).*score -= 4/);
});

test('attack 17: runtime still never force-enables a disabled send control', () => {
  assert.doesNotMatch(content, /removeAttribute\(['"]disabled['"]\)/);
  assert.doesNotMatch(content, /\.disabled\s*=\s*false/);
  assert.match(content, /no forced click was attempted/);
});

test('attack 18: manual completion is reported as success instead of a false send failure', () => {
  assert.match(content, /内容已准备好，等待手动发送 \/ Ready for manual send/);
  assert.match(content, /\{ state: 'success' \}/);
});

test('attack 19: package and extension manifest expose the same V0.5.2 revision', () => {
  const pkg = JSON.parse(read('package.json'));
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.equal(pkg.version, '0.5.2');
  assert.equal(manifest.version, '0.5.2');
});

test('attack 20: handoff format and send behavior remain orthogonal settings', () => {
  assert.notEqual(api.STORAGE_KEY, api.SEND_STORAGE_KEY);
  assert.equal(api.STORAGE_KEY, 'handoffPreference');
  assert.equal(api.SEND_STORAGE_KEY, 'sendPreference');
});
