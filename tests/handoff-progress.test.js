import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('progress UI exposes a local isolated-world reporter for the page-handoff phase', () => {
  const ui = read('extension/progress-ui.js');
  assert.match(ui, /globalThis\.__link2contextReportProgress\s*=/);
  assert.match(ui, /updateProgress\(\{/);
  assert.match(ui, /currentStartedAt \|\| startedAt \|\| Date\.now\(\)/);
});

test('content script continues progress after the background worker returns', () => {
  const content = read('extension/content-script.js');
  assert.match(content, /function reportLocalProgress/);
  assert.match(content, /globalThis\.__link2contextReportProgress\?\.\(/);
  assert.match(content, /'handoff-received'/);
});

test('attachment handoff reports upload start and confirmed registration separately', () => {
  const content = read('extension/content-script.js');
  const start = content.indexOf("reportLocalProgress('attachment-start'");
  const attach = content.indexOf('await attachBinary(result, editor)');
  const confirmed = content.indexOf("reportLocalProgress('attachment-confirmed'");
  assert.ok(start >= 0 && attach > start && confirmed > attach);
});

test('inline handoff reports injection and confirmation separately', () => {
  const content = read('extension/content-script.js');
  const start = content.indexOf("reportLocalProgress('inline-inject'");
  const inject = content.indexOf('setEditorText(editor, result.payload)');
  const confirmed = content.indexOf("reportLocalProgress('inline-confirmed'");
  assert.ok(start >= 0 && inject > start && confirmed > inject);
});

test('automatic send has a distinct attempt and terminal success state', () => {
  const content = read('extension/content-script.js');
  const attempt = content.indexOf("reportLocalProgress('send-attempt'");
  const submit = content.indexOf('const sent = await submit(editor, job.submitter)');
  const success = content.indexOf("reportLocalProgress('sent'");
  assert.ok(attempt >= 0 && submit > attempt && success > submit);
  assert.match(content, /'sent'.*state: 'success'/s);
});

test('unconfirmed automatic send becomes an explicit error instead of fake success', () => {
  const content = read('extension/content-script.js');
  assert.match(content, /'send-unconfirmed'.*state: 'error'/s);
  assert.match(content, /Content is ready, but send could not be confirmed/);
});

test('attachment/composer failures default to HANDOFF while upstream failures preserve their real stage', () => {
  const content = read('extension/content-script.js');
  assert.match(content, /failure\.l2cStage = result\?\.errorStage \|\| 'PIPELINE'/);
  assert.match(content, /const errorStage = String\(error\?\.l2cStage \|\| 'HANDOFF'\)\.toUpperCase\(\)/);
  assert.match(content, /failureLabel\(errorStage\)/);
  assert.match(content, /state: 'error'/);
  assert.match(content, /restoreFailedJob\(job, message\)/);
});

test('manual no-auto-submit path reports ready only after page handoff completes', () => {
  const content = read('extension/content-script.js');
  const ready = content.indexOf("reportLocalProgress('ready-in-composer'");
  const branch = content.indexOf('if (job.autoSubmit)');
  assert.ok(branch >= 0 && ready > branch);
  assert.match(content, /'ready-in-composer'.*state: 'success'/s);
});
