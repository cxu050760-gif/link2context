import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHATGPT_EDITOR_SOFT_LIMIT_CHARS,
  MAX_EDITOR_PAYLOAD_CHARS,
  planContextHandoff,
} from '../extension/core/auto-bridge.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function mode(args) {
  return planContextHandoff(args).mode;
}

test('ChatGPT receives WorkBuddy conversations as Markdown attachments even when short', () => {
  const plan = planContextHandoff({ targetHost: 'chatgpt.com', sourceKind: 'workbuddy', payloadChars: 1200 });
  assert.equal(plan.mode, 'attachment');
  assert.equal(plan.reason, 'chatgpt-conversation-file-first');
});

test('ChatGPT receives ChatGPT-share conversations through the same attachment path', () => {
  assert.equal(mode({ targetHost: 'chatgpt.com', sourceKind: 'chatgpt-share', payloadChars: 800 }), 'attachment');
});

test('ChatGPT subdomains inherit file-first conversation behavior', () => {
  assert.equal(mode({ targetHost: 'foo.chatgpt.com', sourceKind: 'workbuddy', payloadChars: 100 }), 'attachment');
});

test('normalized trailing-dot ChatGPT hostname still uses attachment path', () => {
  assert.equal(mode({ targetHost: 'CHATGPT.COM.', sourceKind: 'workbuddy', payloadChars: 100 }), 'attachment');
});

test('lookalike domains do not accidentally inherit ChatGPT policy', () => {
  assert.equal(mode({ targetHost: 'evilchatgpt.com', sourceKind: 'workbuddy', payloadChars: 100 }), 'text');
});

test('DeepSeek keeps short WorkBuddy context inline as observed working in real use', () => {
  const plan = planContextHandoff({ targetHost: 'chat.deepseek.com', sourceKind: 'workbuddy', payloadChars: 20_000 });
  assert.equal(plan.mode, 'text');
  assert.equal(plan.reason, 'inline-safe');
});

test('DeepSeek keeps short ChatGPT-share context inline too', () => {
  assert.equal(mode({ targetHost: 'chat.deepseek.com', sourceKind: 'chatgpt-share', payloadChars: 20_000 }), 'text');
});

test('generic short content on ChatGPT remains inline', () => {
  assert.equal(mode({ targetHost: 'chatgpt.com', sourceKind: 'generic', payloadChars: CHATGPT_EDITOR_SOFT_LIMIT_CHARS - 1 }), 'text');
});

test('generic content at ChatGPT soft limit becomes an attachment', () => {
  const plan = planContextHandoff({ targetHost: 'chatgpt.com', sourceKind: 'generic', payloadChars: CHATGPT_EDITOR_SOFT_LIMIT_CHARS });
  assert.equal(plan.mode, 'attachment');
  assert.equal(plan.reason, 'chatgpt-editor-soft-limit');
});

test('non-ChatGPT targets keep the existing global hard limit', () => {
  assert.equal(mode({ targetHost: 'chat.deepseek.com', sourceKind: 'generic', payloadChars: MAX_EDITOR_PAYLOAD_CHARS - 1 }), 'text');
  const plan = planContextHandoff({ targetHost: 'chat.deepseek.com', sourceKind: 'generic', payloadChars: MAX_EDITOR_PAYLOAD_CHARS });
  assert.equal(plan.mode, 'attachment');
  assert.equal(plan.reason, 'global-editor-hard-limit');
});

test('invalid or negative size values fail safely to zero-sized inline planning', () => {
  assert.equal(mode({ targetHost: 'chat.deepseek.com', sourceKind: 'generic', payloadChars: -1 }), 'text');
  assert.equal(mode({ targetHost: 'chat.deepseek.com', sourceKind: 'generic', payloadChars: Number.NaN }), 'text');
});

test('background passes the actual sender host into the handoff planner', () => {
  const background = read('extension/background.js');
  assert.match(background, /planContextHandoff\(\{ targetHost, sourceKind: resolved\.kind, payloadChars: payload\.length \}\)/);
  assert.match(background, /resolveForAi\(message\.url, report, \{ targetHost: senderHost\(sender\) \}\)/);
});

test('progress panel receives a concrete handoff-plan stage with target, source, size and mode', () => {
  const background = read('extension/background.js');
  assert.match(background, /report\('handoff-plan'/);
  assert.match(background, /目标 \/ Target:/);
  assert.match(background, /来源 \/ Source:/);
  assert.match(background, /方式 \/ Mode:/);
  assert.match(background, /原因 \/ Reason:/);
});

test('attachment and inline results expose handoff metadata for diagnostics', () => {
  const background = read('extension/background.js');
  assert.match(background, /handoffMode: 'attachment', handoffReason: handoff\.reason, targetHost/);
  assert.match(background, /handoffMode: 'text', handoffReason: handoff\.reason, targetHost/);
});
