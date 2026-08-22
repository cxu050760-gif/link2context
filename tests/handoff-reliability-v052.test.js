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
  const listener = helper.slice(helper.indexOf("document.addEventListener('paste'"), helper.indexOf("document.addEventListener('click'"));
  assert.match(listener, /pendingPaste\.push/);
  assert.doesNotMatch(listener, /stopImmediatePropagation/);
});

test('attack 04: reliable submit never force-enables disabled controls', () => {
  assert.doesNotMatch(helper, /\.disabled\s*=\s*false/);
  assert.doesNotMatch(helper, /removeAttribute\(['"]disabled['"]\)/);
  assert.match(helper, /aria-disabled/);
});

test('attack 05: send success requires independent page evidence, not button-click success alone', () => {
  assert.match(helper, /function submitEvidence/);
  assert.match(helper, /messageVisibleOutsideComposer/);
  assert.match(helper, /composerCleared && generatingEvidence\(\)/);
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

test('attack 17: auto-send re-resolves a rerendered composer while waiting for an enabled send control', () => {
  assert.match(helper, /enabledSendButton/);
  assert.match(helper, /for \(let i = 0; !button && i < 16/);
  assert.match(helper, /editor = newestComposer\(editor\)/);
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

test('attack 21: mirrored attachment proof expires and cannot poison a later upload with the same filename', () => {
  assert.match(helper, /ATTACHMENT_PROOF_TTL_MS/);
  assert.match(helper, /setTimeout\(\(\) => marker\.remove\(\), ATTACHMENT_PROOF_TTL_MS\)/);
});

test('attack 22: synthetic input and change events for the same adapted file are coalesced', () => {
  assert.match(helper, /item\.originalName === original\.name \|\| item\.actualName === original\.name/);
  assert.match(helper, /if \(alreadyTracked\) return/);
});

test('attack 23: Qwen accept widening guarantees both Markdown and plain-text fallback rules', () => {
  assert.match(helper, /\['\.md', 'text\/markdown', '\.txt', 'text\/plain'\]/);
  assert.match(helper, /rules\.some/);
});

test('attack 24: stale send snapshots cannot later manufacture a success', () => {
  assert.match(helper, /SUBMIT_EVIDENCE_TTL_MS/);
  assert.match(helper, /Date\.now\(\) - snapshot\.startedAt > SUBMIT_EVIDENCE_TTL_MS/);
});

test('attack 25: a global stop-generating button is insufficient unless the composer was actually cleared', () => {
  assert.match(helper, /composerCleared && generatingEvidence\(\)/);
  assert.doesNotMatch(helper, /composerChanged && \(messageVisible \|\| generatingEvidence/);
});

test('attack 26: failed paste auto-send is surfaced instead of silently pretending manual mode was intended', () => {
  assert.match(helper, /could not verify a safe auto-send/);
  assert.match(helper, /code: 'SEND_UNCONFIRMED'/);
  assert.match(helper, /自动发送未确认/);
});

test('attack 27: a paste can auto-send only after the handoff lifecycle actually started', () => {
  assert.match(helper, /stage === 'handoff-received'/);
  assert.match(helper, /handoffStarted = true/);
  assert.match(helper, /latestPendingPaste\(\{ requireStarted: true \}\)/);
});

test('attack 28: failed handoff consumes the active paste so it cannot be reused by a later unrelated success', () => {
  assert.match(helper, /stage\.startsWith\('error-'\)/);
  assert.match(helper, /consumeActivePasteOnError/);
});

test('attack 29: trusted manual send clicks do not overwrite the snapshot used for auto-send recovery', () => {
  const listener = helper.slice(helper.indexOf("document.addEventListener('click'"), helper.indexOf("document.addEventListener('keydown'"));
  assert.match(listener, /event\.isTrusted \|\| !looksLikeSend/);
});

test('attack 30: slow but valid fetches have a bounded paste lifecycle instead of a tiny race window', () => {
  assert.match(helper, /PENDING_PASTE_TTL_MS = 120_000/);
});

test('attack 31: Link2Context progress UI and toast are explicitly excluded from attachment evidence', () => {
  assert.match(helper, /#__link2context_progress_root/);
  assert.match(helper, /#__link2context_toast/);
  assert.match(helper, /ownedUiNode/);
});

test('attack 32: hidden mirrored proof nodes cannot recursively become fresh global attachment proof', () => {
  assert.match(helper, /\[data-l2c-attachment-proof\]/);
  const fn = helper.slice(helper.indexOf('function nodeShowsFile'), helper.indexOf('function composerScope'));
  assert.match(fn, /ownedUiNode\(node\)/);
});

test('attack 33: page-level send evidence strips extension-owned UI before message matching', () => {
  assert.match(helper, /function bodyTextWithoutOwnedUi/);
  assert.match(helper, /clone\.querySelectorAll\(OWNED_UI_SELECTORS\)/);
});

test('attack 34: document-wide fallback refuses arbitrary type=submit controls without send semantics', () => {
  const fn = helper.slice(helper.indexOf('function enabledSendButton'), helper.indexOf('function filenameHints'));
  assert.match(fn, /if \(form\)/);
  assert.match(fn, /strongSendSemantics\(el\) \|\|/);
  assert.match(fn, /document\.querySelectorAll/);
  assert.match(fn, /enabledControl\(el\) && strongSendSemantics\(el\)/);
});

test('attack 35: generic submit wording is not accepted as strong global send semantics', () => {
  const fn = helper.slice(helper.indexOf('function strongSendSemantics'), helper.indexOf('function looksLikeSend'));
  assert.doesNotMatch(fn, /submit\|/i);
  assert.match(fn, /send\|ask/);
});

test('attack 36: legacy sent status is suppressed until V0.5.2 independently verifies it', () => {
  assert.match(helper, /function verifyLegacySent/);
  assert.match(helper, /stage \|\| ''\) === 'sent'/);
  assert.match(helper, /success was suppressed fail-closed/);
});

test('attack 37: stale editor disconnection alone is not sufficient page-level send evidence', () => {
  const fn = helper.slice(helper.indexOf('function submitEvidence'), helper.indexOf('function successToast'));
  assert.match(fn, /const composerChanged = afterText !== beforeText/);
  assert.match(fn, /const composerCleared = Boolean\(editor && !afterText\)/);
  assert.doesNotMatch(fn, /!snapshot\.editor\?\.isConnected/);
});
