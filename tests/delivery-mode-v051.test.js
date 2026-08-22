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

test('delivery mode defaults unknown values to auto', () => {
  assert.equal(api.normalizeMode(undefined), 'auto');
  assert.equal(api.normalizeMode('garbage'), 'auto');
  assert.equal(api.normalizeMode('DOCUMENT'), 'document');
});

test('document mode turns inline text results into Markdown documents', () => {
  assert.equal(JSON.stringify(api.plan({ mode: 'document', resultKind: 'html', convertedFromText: false, textChars: 1000 })),
    JSON.stringify({ action: 'document', reason: 'user-document' }));
});

test('document mode does not re-wrap an already converted Markdown attachment', () => {
  assert.equal(JSON.stringify(api.plan({ mode: 'document', resultKind: 'binary', convertedFromText: true, textChars: 1000 })),
    JSON.stringify({ action: 'as-is', reason: 'already-markdown-document' }));
});

test('text mode restores converted text attachments below the safe editor limit', () => {
  assert.equal(JSON.stringify(api.plan({ mode: 'text', resultKind: 'binary', convertedFromText: true, textChars: 20_000 })),
    JSON.stringify({ action: 'text', reason: 'user-text' }));
});

test('text mode refuses to force huge converted text back into the editor', () => {
  assert.equal(JSON.stringify(api.plan({ mode: 'text', resultKind: 'binary', convertedFromText: true, textChars: api.TEXT_HARD_LIMIT_CHARS })),
    JSON.stringify({ action: 'as-is', reason: 'text-hard-limit-safety' }));
});

test('original binary resources are never converted into fake text', () => {
  for (const mode of ['auto', 'document', 'text']) {
    assert.equal(JSON.stringify(api.plan({ mode, resultKind: 'binary', convertedFromText: false, textChars: 100 })),
      JSON.stringify({ action: 'as-is', reason: 'original-binary' }));
  }
});

test('clean Markdown is extracted without Link2Context wrapper instructions', () => {
  const payload = api.buildInlinePayload('# 标题\n\n正文', 'https://example.com/a');
  assert.equal(api.extractMarkdown(payload), '# 标题\n\n正文');
});

test('inline payload preserves Unicode, code fences, and the original URL', () => {
  const md = '# 中文😀\n\n```js\nconsole.log("x")\n```';
  const payload = api.buildInlinePayload(md, 'https://example.com/路径?q=1');
  assert.match(payload, /中文😀/);
  assert.match(payload, /```js/);
  assert.match(payload, /Original URL: https:\/\/example\.com\/路径\?q=1/);
});

test('document filenames are sanitized and bounded', () => {
  const name = api.contextFileName('https://example.com/a%20b/c:d?x=1');
  assert.ok(name.endsWith('.md'));
  assert.ok(name.length <= 120);
  assert.doesNotMatch(name, /[\\/:*?"<>|]/);
});

test('manifest loads delivery policy before the active V0.5.1 content script', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  const scripts = manifest.content_scripts[0].js;
  assert.deepEqual(scripts, ['progress-ui.js', 'delivery-mode.js', 'content-script-v051.js']);
  assert.ok(scripts.indexOf('delivery-mode.js') < scripts.indexOf('content-script-v051.js'));
});

test('popup exposes explicit Auto, Markdown document, and long-text choices', () => {
  const html = read('extension/popup.html');
  assert.match(html, /id="handoffPreference"/);
  assert.match(html, /value="auto"/);
  assert.match(html, /value="document"/);
  assert.match(html, /value="text"/);
});

test('popup persists the delivery mode in extension storage', () => {
  const popup = read('extension/popup.js');
  assert.match(popup, /HANDOFF_PREFERENCE_KEY/);
  assert.match(popup, /chrome\.storage\.local\.set\(\{ \[HANDOFF_PREFERENCE_KEY\]: mode \}\)/);
  assert.match(popup, /refreshHandoffPreferenceUi/);
});
