import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const bridge = read('extension/qwen-state-bridge-v053.js');
const manifest = JSON.parse(read('extension/manifest.json'));
const pkg = JSON.parse(read('package.json'));
const scripts = manifest.content_scripts?.[0]?.js || [];

test('qwen-state 01: V0.5.3 Qwen adapter owns Qwen gestures before the generic runtime', () => {
  assert.ok(scripts.includes('qwen-state-bridge-v053.js'));
  assert.ok(scripts.indexOf('qwen-state-bridge-v053.js') < scripts.indexOf('content-script-v053.js'));
  assert.match(bridge, /stopImmediatePropagation/);
});

test('qwen-state 02: text handoff uses browser editing instead of DOM replacement or synthetic input', () => {
  const fn = bridge.slice(bridge.indexOf('async function qwenBrowserEdit'), bridge.indexOf('function generatingEvidence'));
  assert.match(fn, /execCommand\?\.\('insertText'/);
  assert.doesNotMatch(fn, /innerHTML\s*=/);
  assert.doesNotMatch(fn, /textContent\s*=/);
  assert.doesNotMatch(fn, /dispatchEvent\(new InputEvent/);
});

test('qwen-state 03: visible text is not enough; focus reconciliation and an enabled send control are required', () => {
  const fn = bridge.slice(bridge.indexOf('async function qwenBrowserEdit'), bridge.indexOf('function generatingEvidence'));
  assert.match(fn, /current\.blur\(\)/);
  assert.match(fn, /current\.focus\(\)/);
  assert.match(fn, /signature\.every/);
  assert.match(fn, /const send = findSendButton\(current\)/);
  assert.match(fn, /if \(!send\) return null/);
});

test('qwen-state 04: the old synthetic text-file route is no longer used for ordinary Qwen text', () => {
  const startIndex = bridge.indexOf('async function start(');
  const endIndex = bridge.indexOf("  document.addEventListener('link2context:cancel'", startIndex);
  assert.ok(startIndex >= 0 && endIndex > startIndex);
  const flow = bridge.slice(startIndex, endIndex);
  assert.match(flow, /const originalBinary = result\.kind === 'binary' && !result\.convertedFromText/);
  assert.match(flow, /qwenBrowserEdit/);
  assert.doesNotMatch(flow, /qwenTextFile/);
  assert.doesNotMatch(flow, /new File\(\[text\]/);
});

test('qwen-state 05: a ghost attachment filename is not accepted without real sendability', () => {
  const fn = bridge.slice(bridge.indexOf('async function attachBinaryWithStateProof'), bridge.indexOf('function stopEvent'));
  assert.match(fn, /const filenameVisible =/);
  assert.match(fn, /const send = findSendButton/);
  assert.match(fn, /if \(filenameVisible && send\)/);
});

test('qwen-state 06: auto-send remains fail-closed and requires post-click evidence', () => {
  const fn = bridge.slice(bridge.indexOf('async function submitVerified'), bridge.indexOf('function isImageOnlyInput'));
  assert.match(fn, /button\.click\(\)/);
  assert.match(fn, /generatingEvidence\(\)/);
  assert.match(fn, /bodyTextWithoutComposer/);
  assert.doesNotMatch(fn, /button\.click\(\);\s*return true/);
});

test('qwen-state 07: package syntax check includes the new adapter and version stays V0.5.3', () => {
  assert.match(pkg.scripts.check, /qwen-state-bridge-v053\.js/);
  assert.equal(pkg.version, '0.5.3');
  assert.equal(manifest.version, '0.5.3');
});
