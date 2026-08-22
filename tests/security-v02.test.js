import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validatePublicHttpUrl } from '../extension/core/url-safety.js';
import { workBuddyJsonToMarkdown } from '../extension/core/normalize.js';
import { MAX_EDITOR_PAYLOAD_CHARS, planContextHandoff } from '../extension/core/auto-bridge.js';

test('IPv4 unusual numeric notation normalizes into blocked loopback', () => {
  assert.throws(() => validatePublicHttpUrl('http://2130706433/'), /blocked|禁止/);
  assert.throws(() => validatePublicHttpUrl('http://0x7f000001/'), /blocked|禁止/);
});

test('WorkBuddy extraction omits image base64, reasoning bodies and tool arguments', () => {
  const md = workBuddyJsonToMarkdown({ name: 'T', messages: [{ messageType: 'assistant', createTime: 1, content: [
    { type: 'text', text: 'VISIBLE' },
    { type: 'image', data: 'SECRET_BASE64' },
    { type: 'reasoning', reasoning: 'PRIVATE_REASONING' },
    { type: 'tool-call', name: 'shell', arguments: { token: 'SECRET_TOKEN' } },
  ] }] }, 'https://workbuddy.link/p/abcdef');
  assert.match(md, /VISIBLE/);
  assert.doesNotMatch(md, /SECRET_BASE64|PRIVATE_REASONING|SECRET_TOKEN/);
});

test('manifest wires service worker and automatic content script on HTTP(S)', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.deepEqual(manifest.content_scripts[0].matches, ['http://*/*', 'https://*/*']);
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(manifest.permissions.includes('activeTab'));
});

test('content script requires real trusted browser events before automatic interception', () => {
  const src = fs.readFileSync(new URL('../extension/content-script.js', import.meta.url), 'utf8');
  assert.match(src, /event\.isTrusted/);
  assert.doesNotMatch(src, /window\.addEventListener\(['"]message/);
  assert.doesNotMatch(src, /innerHTML\s*=/);
});

test('background checks sender site and explicit user gesture before arbitrary URL fetch', () => {
  const src = fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  assert.match(src, /senderIsAllowed\(sender\)/);
  assert.match(src, /message\.userGesture !== true/);
});

test('synthetic auto-submit cannot recursively trigger URL interception because click handler rejects untrusted events', () => {
  const src = fs.readFileSync(new URL('../extension/content-script.js', import.meta.url), 'utf8');
  assert.match(src, /!event\.isTrusted \|\| !looksLikeSend/);
});

test('IPv4-mapped IPv6 and special-purpose IPv4 ranges are blocked', () => {
  for (const url of [
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:10.0.0.1]/',
    'http://100.64.0.1/',
    'http://198.18.0.1/',
    'http://192.0.2.1/',
    'http://203.0.113.1/',
    'http://[2001:db8::1]/',
  ]) assert.throws(() => validatePublicHttpUrl(url), /blocked|禁止/, url);
});

test('built-in AI sites activate synchronously before background status round-trip', () => {
  const src = fs.readFileSync(new URL('../extension/content-script.js', import.meta.url), 'utf8');
  assert.match(src, /let siteEnabled = isBuiltInAiHost\(location\.hostname\.toLowerCase\(\)\)/);
});

test('contenteditable replacement preserves editor root instead of replaceChildren destruction', () => {
  const src = fs.readFileSync(new URL('../extension/content-script.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /editor\.replaceChildren/);
  assert.match(src, /range\.selectNodeContents\(editor\)/);
  assert.match(src, /execCommand\?\.\('insertText'/);
});

test('single-line fields require nearby send control before paste interception', () => {
  const src = fs.readFileSync(new URL('../extension/content-script.js', import.meta.url), 'utf8');
  assert.match(src, /function isLikelyComposer\(editor\)/);
  assert.match(src, /!isLikelyComposer\(editor\)/);
});

test('background still converts globally oversized text context into Markdown attachment', () => {
  const plan = planContextHandoff({ targetHost: 'chat.deepseek.com', sourceKind: 'generic', payloadChars: MAX_EDITOR_PAYLOAD_CHARS });
  assert.equal(plan.mode, 'attachment');
  assert.equal(plan.reason, 'global-editor-hard-limit');
  const src = fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  assert.match(src, /if \(handoff\.mode === 'attachment'\)/);
  assert.match(src, /mime: 'text\/markdown'/);
});

test('auto-submit verifies composer changed before claiming success', () => {
  const src = fs.readFileSync(new URL('../extension/content-script.js', import.meta.url), 'utf8');
  assert.match(src, /async function submitChanged/);
  assert.match(src, /if \(await submitChanged\(editor, beforeText\)\) return true/);
});

test('binary attachment waits for page registration before send attempt', () => {
  const src = fs.readFileSync(new URL('../extension/content-script.js', import.meta.url), 'utf8');
  assert.match(src, /async function waitForAttachmentReady/);
  assert.match(src, /const ready = await waitForAttachmentReady\(editor, result\.fileName\)/);
  assert.match(src, /if \(!ready\) throw new Error/);
});

test('remembered submit button must also respect aria-disabled state', () => {
  const source = fs.readFileSync(new URL('../extension/content-script.js', import.meta.url), 'utf8');
  assert.match(source, /preferredButton\.getAttribute\('aria-disabled'\) !== 'true'/);
});

test('ordinary web pages are not externally connectable to the extension', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.externally_connectable, undefined);
  const content = fs.readFileSync(new URL('../extension/content-script.js', import.meta.url), 'utf8');
  assert.doesNotMatch(content, /window\.addEventListener\(['"]message/);
});