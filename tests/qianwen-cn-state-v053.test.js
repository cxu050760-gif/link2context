import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isKnownAiHost } from '../extension/core/auto-bridge.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const bridge = read('extension/qianwen-cdp-v053.js');
const background = read('extension/background-v053.js');
const manifest = JSON.parse(read('extension/manifest.json'));
const pkg = JSON.parse(read('package.json'));
const scripts = manifest.content_scripts?.[0]?.js || [];

test('qianwen-cn 01: current Chinese Qianwen and QwenWork hosts are built-in AI targets', () => {
  assert.equal(isKnownAiHost('qianwen.com'), true);
  assert.equal(isKnownAiHost('www.qianwen.com'), true);
  assert.equal(isKnownAiHost('qwenwork.cn'), true);
  assert.equal(isKnownAiHost('app.qwenwork.cn'), true);
});

test('qianwen-cn 02: manifest explicitly grants debugger and routes Chinese Qianwen through CDP before generic runtime', () => {
  assert.ok(manifest.permissions.includes('debugger'));
  assert.equal(manifest.background.service_worker, 'background-v053.js');
  assert.ok(scripts.includes('qianwen-cdp-v053.js'));
  assert.ok(scripts.indexOf('qianwen-cdp-v053.js') < scripts.indexOf('content-script-v053.js'));
  assert.ok(!scripts.includes('qianwen-cn-state-bridge-v053.js'));
});

test('qianwen-cn 03: debugger bridge is HTTPS-host-scoped, top-frame scoped, and detaches after each operation', () => {
  assert.match(background, /import '\.\/background\.js'/);
  assert.match(background, /message\.type === QIANWEN_DEBUGGER_MESSAGE/);
  assert.match(background, /sender\?\.frameId > 0/);
  assert.match(background, /qianwen\.com/);
  assert.match(background, /qwenwork\.cn/);
  assert.match(background, /url\.protocol === 'https:'/);
  assert.match(background, /current\?\.protocol === 'https:'/);
  assert.match(background, /chrome\.debugger\.attach/);
  assert.match(background, /chrome\.debugger\.detach/);
});

test('qianwen-cn 04: text uses CDP Input.insertText instead of DOM painting or execCommand', () => {
  const fn = bridge.slice(bridge.indexOf('async function writeViaDebugger'), bridge.indexOf('function controlText'));
  assert.match(background, /'Input\.insertText'/);
  assert.match(fn, /debuggerCommand\('insertText', text\)/);
  assert.doesNotMatch(fn, /execCommand/);
  assert.doesNotMatch(fn, /innerHTML\s*=/);
  assert.doesNotMatch(fn, /textContent\s*=/);
  assert.doesNotMatch(fn, /dispatchEvent\(new InputEvent/);
});

test('qianwen-cn 05: send uses real Enter through CDP and verifies page evidence instead of guessing a send button', () => {
  assert.match(background, /'Input\.dispatchKeyEvent'/);
  assert.match(background, /type: 'rawKeyDown'/);
  assert.match(background, /type: 'keyUp'/);
  assert.match(bridge, /debuggerCommand\('pressEnter'\)/);
  assert.match(bridge, /generatingEvidence\(\)/);
  assert.match(bridge, /bodyTextWithoutComposer\(\)/);
});

test('qianwen-cn 06: pasted URL is intercepted once and failed CDP state is fail-closed', () => {
  const listener = bridge.slice(bridge.indexOf("document.addEventListener('paste'"), bridge.indexOf("document.addEventListener('keydown'"));
  assert.match(listener, /event\.isTrusted/);
  assert.match(listener, /stopEvent\(event\)/);
  assert.match(bridge, /stopImmediatePropagation/);
  assert.match(bridge, /QIANWEN_CDP_STATE_UNCONFIRMED/);
  assert.match(background, /another debugger\|already attached/);
  assert.match(background, /String\(failurePrefix\) \+ '_BUSY'/);
  assert.match(background, /String\(failurePrefix\) \+ '_COMMAND_FAILED'/);
});

test('qianwen-cn 07: V0.6 keeps the proven Qianwen CDP binary/text fallback while the package version advances', () => {
  assert.match(bridge, /new File\(\[base64ToBytes\(result\.base64\)\]/);
  assert.match(bridge, /new DataTransfer\(\)/);
  assert.match(bridge, /QIANWEN_ATTACHMENT_STATE_UNCONFIRMED/);
  assert.match(pkg.scripts.check, /background-v053\.js/);
  assert.match(pkg.scripts.check, /qianwen-cdp-v053\.js/);
  assert.equal(pkg.version, '0.6.0');
  assert.equal(manifest.version, '0.6.0');
});
