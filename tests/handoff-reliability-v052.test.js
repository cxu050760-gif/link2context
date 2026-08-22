import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const helper = read('extension/handoff-reliability-v052.js');
const manifest = JSON.parse(read('extension/manifest.json'));
const pkg = JSON.parse(read('package.json'));

const contentScripts = manifest.content_scripts?.[0]?.js || [];

test('attack 01: reliability helper is loaded before the legacy V0.5.1 handoff runtime', () => {
  assert.ok(contentScripts.indexOf('handoff-reliability-v052.js') >= 0);
  assert.ok(contentScripts.indexOf('handoff-reliability-v052.js') < contentScripts.indexOf('content-script-v051.js'));
});

test('attack 02: paste auto-send is opt-in through persisted sendPreference', () => {
  assert.match(helper, /sendModeIsAuto/);
  assert.match(helper, /SEND_KEY/);
  assert.match(helper, /stage === 'ready-in-composer'/);
});

test('attack 03: a paste-triggered job is tracked without directly swallowing the trusted paste event', () => {
  assert.match(helper, /document\.addEventListener\('paste'/);
  assert.match(helper, /pendingPaste\.push/);
  assert.doesNotMatch(helper, /document\.addEventListener\('paste'[\s\S]*stopImmediatePropagation/);
});

test('attack 04: reliable submit never force-enables disabled controls', () => {
  assert.doesNotMatch(helper, /\.disabled\s*=\s*false/);
  assert.doesNotMatch(helper, /removeAttribute\(['"]disabled['"]\)/);
  assert.match(helper, /aria-disabled/);
});

test('attack 05: send success requires page evidence instead of button-click success alone', () => {
  assert.match(helper, /function submitEvidence/);
  assert.match(helper, /composerChanged && \(messageVisible \|\| generatingEvidence\(\)\)/);
});

test('attack 06: a legacy send-unconfirmed result can be corrected only after independent evidence', () => {
  assert.match(helper, /stage === 'send-unconfirmed'/);
  assert.match(helper, /submitEvidence\(lastSubmitSnapshot\)/);
  assert.match(helper, /Recovered false-negative send status/);
});

test('attack 07: attachment proof is observed globally through MutationObserver', () => {
  assert.match(helper, /new MutationObserver/);
  assert.match(helper, /observeAttachmentNodes/);
  assert.match(helper, /record\.addedNodes/);
});

test('attack 08: attachment proof survives composer rerender by mirroring only observed proof into candidate scopes', () => {
  assert.match(helper, /mirrorAttachmentProof/);
  assert.match(helper, /dataset\.l2cAttachmentProof/);
  assert.match(helper, /candidateScopesForInput/);
});

test('attack 09: assigning input.files alone is not treated as confirmed attachment proof', () => {
  const handlerStart = helper.indexOf('function handleSyntheticFileEvent');
  const handler = helper.slice(handlerStart, helper.indexOf('function patchQwenFileInputs'));
  assert.ok(handlerStart >= 0);
  assert.doesNotMatch(handler, /mirrorAttachmentProof\(/);
});

test('attack 10: truncated chip hints retain a distinctive prefix but reject tiny fragments', () => {
  assert.match(helper, /stem\.slice\(0, 16\)/);
  assert.match(helper, /item\.length >= 12/);
});

test('attack 11: Qwen document fallback is gated by both target host and explicit document mode', () => {
  assert.match(helper, /qwenHost && qwenDocumentMode/);
  assert.match(helper, /data\[HANDOFF_KEY\] === 'document'/);
});

test('attack 12: Qwen fallback widens accept only temporarily and stores the original accept value', () => {
  assert.match(helper, /dataset\.l2cOriginalAccept/);
  assert.match(helper, /restoreQwenFileInputs/);
});

test('attack 13: only synthetic extension file events are eligible for md-to-txt adaptation', () => {
  assert.match(helper, /event\.isTrusted\) return/);
  assert.match(helper, /fileToPlainText/);
});

test('attack 14: Qwen md fallback preserves the original content while changing only filename and MIME', () => {
  assert.match(helper, /new File\(\[file\], name, \{ type: 'text\/plain'/);
  assert.match(helper, /\.txt/);
});

test('attack 15: actual Qwen txt chip proof maps back to the original md filename expected by legacy confirmation', () => {
  assert.match(helper, /originalName: original\.name/);
  assert.match(helper, /actualName: actual\.name/);
  assert.match(helper, /marker\.textContent = attempt\.originalName/);
});

test('attack 16: mutation tracking also handles text changes inside an existing attachment chip', () => {
  assert.match(helper, /characterData: true/);
  assert.match(helper, /record\.type === 'characterData'/);
});

test('attack 17: auto-send waits for a currently enabled visible send control instead of forcing stale submitters', () => {
  assert.match(helper, /enabledSendButton/);
  assert.match(helper, /for \(let i = 0; !button && i < 16/);
});

test('attack 18: package and manifest are both V0.5.2', () => {
  assert.equal(pkg.version, '0.5.2');
  assert.equal(manifest.version, '0.5.2');
});

test('attack 19: package check includes the V0.5.2 reliability helper', () => {
  assert.match(pkg.scripts.check, /handoff-reliability-v052\.js/);
});

test('attack 20: V0.5.2 remains an additive reliability layer and keeps the established V0.5.1 runtime loaded', () => {
  assert.ok(contentScripts.includes('content-script-v051.js'));
  assert.ok(contentScripts.includes('handoff-reliability-v052.js'));
});
