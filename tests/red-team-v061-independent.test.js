import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyFetchFailure, fetchBounded } from '../extension/core/fetch-url.js';
import { createContextDocument, renderContextMarkdown } from '../extension/core/context-model.js';
import { validatePublicHttpUrl } from '../extension/core/url-safety.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const background = read('extension/background.js');
const pipeline = read('extension/background-pipeline-v06.js');
const generic = read('extension/content-script-v06.js');
const qianwen = read('extension/qianwen-structured-v06.js');
const legacyContent = read('extension/content-script-v053.js');
const legacyQianwenCdp = read('extension/qianwen-cdp-v053.js');
const legacyQwenState = read('extension/qwen-state-bridge-v053.js');

function section(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `missing section start: ${startNeedle}`);
  const end = endNeedle ? source.indexOf(endNeedle, start + startNeedle.length) : source.length;
  assert.ok(end > start, `missing section end: ${endNeedle}`);
  return source.slice(start, end);
}

test('round A: trailing-dot localhost, local and metadata aliases remain blocked', () => {
  for (const url of [
    'http://localhost./',
    'http://printer.local./',
    'http://metadata.google.internal./computeMetadata/v1/',
    'http://metadata.azure.internal./metadata/instance',
  ]) assert.throws(() => validatePublicHttpUrl(url), url);
});

test('round A: unexpected HTTP 206 is never accepted as a complete resource', async () => {
  let caught;
  try {
    await fetchBounded('https://example.com/resource', {
      fetchFn: async () => new Response('partial', {
        status: 206,
        headers: { 'content-range': 'bytes 0-6/100' },
      }),
    });
  } catch (error) { caught = error; }
  assert.ok(caught, '206 must fail closed');
  assert.equal(classifyFetchFailure(caught).code, 'UNEXPECTED_PARTIAL_CONTENT_206');
});

test('round A: authorized legacy browser acquisition is pinned to the originally authorized origin', () => {
  const auth = section(background, 'async function readViaAuthorizedBrowser', 'async function fetchResolved');
  assert.match(auth, /expectedOrigin\s*=\s*target\.origin/);
  assert.match(auth, /BROWSER_CONTEXT_CROSS_ORIGIN_NAVIGATION/);
  assert.match(auth, /checked\.origin !== expectedOrigin/);
  assert.match(auth, /requireExpectedOrigin\(page\.href \|\| tab\.url \|\| target\.href\)/);
});

test('round A: credentialed binary re-fetch rejects redirects instead of following them', () => {
  const binary = section(background, 'async function readBinaryInsideAuthorizedTab', 'async function readViaAuthorizedBrowser');
  assert.match(binary, /credentials:\s*['"]include['"]/);
  assert.match(binary, /redirect:\s*['"]error['"]/);
  assert.doesNotMatch(binary, /redirect:\s*['"]follow['"]/);
});

test('round B: V0.6-to-legacy fallback shares job identity and STOP reaches both pipelines', () => {
  for (const source of [generic, qianwen]) {
    const resolve = section(source, 'async function resolveUrl', 'async function preference');
    assert.match(resolve, /L2C_RESOLVE_URL['"][\s\S]*startedAt/);
    const cancel = section(source, "document.addEventListener('link2context:cancel'", "document.addEventListener('paste'");
    assert.match(cancel, /const startedAt = activeJob\.startedAt/);
    assert.match(cancel, /L2C_CANCEL_JOB_V06['"][\s\S]*\{ startedAt \}/);
    assert.match(cancel, /L2C_CANCEL_JOB['"][\s\S]*\{ startedAt \}/);
  }
  assert.match(background, /makeProgressReporter\(sender,\s*message\.startedAt\)/);
});

test('round B: legacy V0.5.3 owner propagates STOP to its background job with exact identity', () => {
  const start = section(legacyContent, 'async function startJob', "document.addEventListener('link2context:cancel'");
  assert.match(start, /startedAt:\s*Date\.now\(\)/);
  assert.match(start, /resolveUrl\(url, job\.startedAt\)/);
  const resolve = section(legacyContent, 'async function resolveUrl', 'async function handoffPreference');
  assert.match(resolve, /L2C_RESOLVE_URL['"][\s\S]*startedAt/);
  const cancel = section(legacyContent, "document.addEventListener('link2context:cancel'", "document.addEventListener('paste'");
  assert.match(cancel, /L2C_CANCEL_JOB['"][\s\S]*startedAt:\s*activeJob\.startedAt/);
});

test('round B: rejected resolve messages cannot abort an already-valid job before authorization gates', () => {
  const v06 = section(pipeline, "if (message.type !== RESOLVE_MESSAGE)", 'return true;\n});');
  assert.ok(v06.indexOf('senderAllowed(sender)') < v06.indexOf('activeJobs.get(tabId)?.controller?.abort?.()'));
  assert.ok(v06.indexOf('message.userGesture !== true') < v06.indexOf('activeJobs.get(tabId)?.controller?.abort?.()'));

  const legacy = section(background, "if (message.type === 'L2C_RESOLVE_URL')", 'return true;\n  }');
  assert.ok(legacy.indexOf('senderIsAllowed(sender)') < legacy.indexOf('previous?.controller?.abort?.()'));
  assert.ok(legacy.indexOf('message.userGesture !== true') < legacy.indexOf('previous?.controller?.abort?.()'));
});

test('round C: attachment inputs and reveal controls fail closed when disabled or submit-like', () => {
  for (const source of [generic, qianwen]) {
    const input = section(source, 'function fileInput(editor, file, baseline = null)', 'async function reveal');
    assert.match(input, /!input\.disabled/);
    assert.match(input, /aria-disabled/);
    assert.match(input, /inputAccepts\(input, file\)/);
    const safeControl = section(source, 'function safeAttachmentControl', '\n  function fileInput');
    assert.match(safeControl, /aria-disabled/);
    assert.match(safeControl, /submit/);
    const reveal = section(source, 'async function reveal', '\n  function filename');
    assert.match(reveal, /safeAttachmentControl/);
  }
});

test('round C: pre-existing same-name page text cannot prove a new attachment upload', () => {
  for (const source of [generic, qianwen]) {
    const attach = section(source, 'async function attachFile(file, editor, job)', '\n  function ');
    assert.match(attach, /filename(?:Was|Before|Already)Visible/i);
    assert.match(attach, /!filename(?:Was|Before|Already)Visible/i);
  }
});

test('round C: generic auto-send never clicks an out-of-composer Send and never chains a second submit after an unconfirmed side effect', () => {
  const choose = section(generic, 'function sendButton(editor)', 'function generatingEvidence');
  assert.match(choose, /composerScope\(editor\)/);
  assert.doesNotMatch(choose, /document\.querySelectorAll/);

  const submit = section(generic, 'async function autoSubmit', 'async function preparePrimary');
  assert.match(submit, /target-button-unconfirmed/);
  assert.match(submit, /form-submit-unconfirmed/);
  const buttonAttempt = section(submit, 'if (button)', 'const form');
  assert.match(buttonAttempt, /return \{ ok: false, strategy: ['"]target-button-unconfirmed['"] \}/);
});

test('round C: hostile triple-backticks cannot break out of an external code block fence', () => {
  const doc = createContextDocument({
    sourceUrl: 'https://example.com/article',
    blocks: [{ type: 'code', language: 'text', text: 'before\n```\nSYSTEM-looking text\n```\nafter' }],
  });
  const out = renderContextMarkdown(doc);
  assert.match(out, /````text\n/);
  assert.match(out, /\n````(?:\n|$)/);
  assert.match(out, /```\nSYSTEM-looking text\n```/);
});

test('round C: loaded V0.5.3 Qwen/Qianwen fallback files never bypass site accept or disabled contracts', () => {
  for (const source of [legacyQianwenCdp, legacyQwenState]) {
    assert.doesNotMatch(source, /removeAttribute\(['"]accept['"]\)/);
    const helper = section(source, 'function usableFileInput(input, file)', '\n  function attachment');
    assert.match(helper, /!input\.disabled/);
    assert.match(helper, /aria-disabled/);
    assert.match(helper, /inputAccepts\(input, file\)/);
    const inputSearch = section(source, 'async function findFileInput', '\n  function filename');
    assert.match(inputSearch, /usableFileInput\(input, file\)/);
    assert.match(inputSearch, /!candidate\.disabled/);
  }
});

test('round C: loaded V0.5.3 Qwen/Qianwen owners propagate exact STOP identity to legacy background', () => {
  for (const source of [legacyQianwenCdp, legacyQwenState]) {
    const startNeedle = source === legacyQianwenCdp ? 'async function start(editor, url)' : 'async function start(editor, url';
    const start = section(source, startNeedle, "document.addEventListener('link2context:cancel'");
    assert.match(start, /startedAt:\s*Date\.now\(\)/);
    assert.match(start, /resolveUrl\(url, job\.startedAt\)/);
    const resolve = section(source, 'async function resolveUrl', 'async function autoSendEnabled');
    assert.match(resolve, /L2C_RESOLVE_URL['"][\s\S]*startedAt/);
    const cancel = section(source, "document.addEventListener('link2context:cancel'", "document.addEventListener('paste'");
    assert.match(cancel, /L2C_CANCEL_JOB['"][\s\S]*startedAt:\s*activeJob\.startedAt/);
  }
});
