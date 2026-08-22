import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptsAttachment,
  buildBinaryNote,
  buildContextPayload,
  extractSingleHttpUrl,
  isAllowedAiHost,
  isKnownAiHost,
  looksLikeAttachmentControl,
  MAX_EDITOR_PAYLOAD_CHARS,
  looksLikeSendControl,
  sanitizeAttachmentName,
  shouldAutoExpand,
} from '../extension/core/auto-bridge.js';

test('strict single URL detection accepts only one clean HTTP(S) URL', () => {
  assert.equal(extractSingleHttpUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(extractSingleHttpUrl('  https://example.com/x  '), 'https://example.com/x');
  assert.equal(extractSingleHttpUrl('https://a.test\nhttps://b.test'), null);
  assert.equal(extractSingleHttpUrl('see https://example.com'), null);
  assert.equal(extractSingleHttpUrl('javascript:alert(1)'), null);
  assert.equal(extractSingleHttpUrl('file:///etc/passwd'), null);
  assert.equal(extractSingleHttpUrl('https://u:p@example.com/x'), null);
});

test('known AI hosts and subdomains are recognized without suffix confusion', () => {
  assert.equal(isKnownAiHost('chatgpt.com'), true);
  assert.equal(isKnownAiHost('foo.chatgpt.com'), true);
  assert.equal(isKnownAiHost('chatgpt.com.evil.test'), false);
  assert.equal(isKnownAiHost('www.doubao.com'), true);
  assert.equal(isKnownAiHost('chat.deepseek.com'), true);
});

test('custom AI host is exact and does not leak to lookalikes', () => {
  assert.equal(isAllowedAiHost('my-ai.example', ['my-ai.example']), true);
  assert.equal(isAllowedAiHost('evil.my-ai.example', ['my-ai.example']), false);
});

test('auto expansion requires empty editor, allowed host, and URL-only candidate', () => {
  assert.equal(shouldAutoExpand({ editorText: '', candidateText: 'https://example.com', host: 'chatgpt.com' }), true);
  assert.equal(shouldAutoExpand({ editorText: 'hello', candidateText: 'https://example.com', host: 'chatgpt.com' }), false);
  assert.equal(shouldAutoExpand({ editorText: '', candidateText: 'not-a-url', host: 'chatgpt.com' }), false);
  assert.equal(shouldAutoExpand({ editorText: '', candidateText: 'https://example.com', host: 'example.com' }), false);
});

test('send-control heuristic accepts multilingual send labels but not attachment labels', () => {
  assert.equal(looksLikeSendControl({ tagName: 'BUTTON', ariaLabel: 'Send message' }), true);
  assert.equal(looksLikeSendControl({ tagName: 'BUTTON', textContent: '发送' }), true);
  assert.equal(looksLikeSendControl({ tagName: 'BUTTON', type: 'submit' }), true);
  assert.equal(looksLikeSendControl({ tagName: 'BUTTON', ariaLabel: 'Attach file' }), false);
});

test('attachment heuristic recognizes common labels', () => {
  assert.equal(looksLikeAttachmentControl({ ariaLabel: 'Upload file' }), true);
  assert.equal(looksLikeAttachmentControl({ title: '添加附件' }), true);
  assert.equal(looksLikeAttachmentControl({ textContent: 'Send' }), false);
});

test('attachment filenames are Windows-safe and bounded', () => {
  assert.equal(sanitizeAttachmentName('a:b/c\\d?.pdf'), 'a-b-c-d-.pdf');
  assert.ok(sanitizeAttachmentName('x'.repeat(200)).length <= 120);
  assert.equal(sanitizeAttachmentName('\u0000'), 'download.bin');
});

test('text payload explicitly tells web AI to use extracted content and preserves URL', () => {
  const payload = buildContextPayload('# Hello\nworld', 'https://example.com/x');
  assert.match(payload, /不要再声称/);
  assert.match(payload, /https:\/\/example\.com\/x/);
  assert.match(payload, /# Hello/);
  assert.match(payload, /BEGIN LINK2CONTEXT CONTENT/);
});

test('binary note tells AI a file was attached', () => {
  const note = buildBinaryNote('https://e.test/a.pdf', 'a.pdf', 'application/pdf');
  assert.match(note, /自动附加/);
  assert.match(note, /a\.pdf/);
  assert.match(note, /application\/pdf/);
});

test('attachment accept rules prevent selecting unrelated upload inputs', () => {
  assert.equal(acceptsAttachment('image/*', 'photo.png', 'image/png'), true);
  assert.equal(acceptsAttachment('image/*', 'report.pdf', 'application/pdf'), false);
  assert.equal(acceptsAttachment('.pdf,.docx', 'REPORT.PDF', 'application/octet-stream'), true);
  assert.equal(acceptsAttachment('application/pdf', 'report.bin', 'application/pdf; charset=binary'), true);
});

test('inline payload threshold is bounded so huge context can become an attachment', () => {
  assert.ok(MAX_EDITOR_PAYLOAD_CHARS >= 100_000);
  assert.ok(MAX_EDITOR_PAYLOAD_CHARS <= 500_000);
});
