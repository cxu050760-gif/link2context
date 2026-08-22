import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isKnownAiHost } from '../extension/core/auto-bridge.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const bridge = read('extension/qianwen-cn-state-bridge-v053.js');
const manifest = JSON.parse(read('extension/manifest.json'));
const pkg = JSON.parse(read('package.json'));
const scripts = manifest.content_scripts?.[0]?.js || [];

test('qianwen-cn 01: current Chinese Qwen and QwenWork hosts are built-in AI targets', () => {
  assert.equal(isKnownAiHost('qianwen.com'), true);
  assert.equal(isKnownAiHost('www.qianwen.com'), true);
  assert.equal(isKnownAiHost('qwenwork.cn'), true);
  assert.equal(isKnownAiHost('app.qwenwork.cn'), true);
});

test('qianwen-cn 02: dedicated Chinese adapter owns qianwen.com and qwenwork.cn before generic runtime', () => {
  assert.match(bridge, /host === 'qianwen\.com'/);
  assert.match(bridge, /host === 'qwenwork\.cn'/);
  assert.ok(scripts.includes('qianwen-cn-state-bridge-v053.js'));
  assert.ok(scripts.indexOf('qianwen-cn-state-bridge-v053.js') < scripts.indexOf('content-script-v053.js'));
});

test('qianwen-cn 03: pasted URL is intercepted once before the managed editor receives it', () => {
  const listener = bridge.slice(bridge.indexOf("document.addEventListener('paste'"), bridge.indexOf("document.addEventListener('keydown'"));
  assert.match(listener, /event\.isTrusted/);
  assert.match(listener, /stopEvent\(event\)/);
  assert.match(bridge, /stopImmediatePropagation/);
});

test('qianwen-cn 04: text handoff forbids DOM-paint fallback and requires site sendability', () => {
  const fn = bridge.slice(bridge.indexOf('async function writeRealEditorState'), bridge.indexOf('function generatingEvidence'));
  assert.match(fn, /execCommand\?\.\('insertText'/);
  assert.doesNotMatch(fn, /innerHTML\s*=/);
  assert.doesNotMatch(fn, /textContent\s*=/);
  assert.doesNotMatch(fn, /dispatchEvent\(new InputEvent/);
  assert.match(fn, /const button = findSendButton\(current\)/);
  assert.match(fn, /if \(!button\) return null/);
});

test('qianwen-cn 05: unconfirmed editor state fails closed with the live regression code', () => {
  assert.match(bridge, /QIANWEN_EDITOR_STATE_UNCONFIRMED/);
  assert.match(bridge, /删不掉但发不出去的假文本/);
});

test('qianwen-cn 06: binary attachments remain files and also require a real send state', () => {
  assert.match(bridge, /new File\(\[base64ToBytes\(result\.base64\)\]/);
  assert.match(bridge, /QIANWEN_ATTACHMENT_STATE_UNCONFIRMED/);
  assert.match(bridge, /const button = findSendButton\(current \|\| editor\)/);
});

test('qianwen-cn 07: package syntax gate includes the adapter without bumping past V0.5.3', () => {
  assert.match(pkg.scripts.check, /qianwen-cn-state-bridge-v053\.js/);
  assert.equal(pkg.version, '0.5.3');
  assert.equal(manifest.version, '0.5.3');
});
