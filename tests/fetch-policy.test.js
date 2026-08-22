import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyContentType, enforceContentLength, MAX_FETCH_BYTES, sniffTextKind, truncateText } from '../extension/core/fetch-policy.js';

test('classifies common content types', () => {
  assert.equal(classifyContentType('application/json; charset=utf-8'), 'json');
  assert.equal(classifyContentType('text/html'), 'html');
  assert.equal(classifyContentType('text/plain'), 'text');
  assert.equal(classifyContentType('application/pdf'), 'binary');
  assert.equal(classifyContentType('application/octet-stream'), 'binary');
});

test('sniffs JSON and HTML when servers omit/mislabel content type', () => {
  assert.equal(sniffTextKind('', '{"ok":true}'), 'json');
  assert.equal(sniffTextKind('application/octet-stream', '<!doctype html><html></html>'), 'html');
  assert.equal(sniffTextKind('', 'plain words'), 'text');
});

test('does not misclassify NUL-heavy binary as text', () => {
  assert.equal(sniffTextKind('', '\u0000\u0000\u0000abc'), 'binary');
});

test('rejects advertised oversized responses', () => {
  assert.throws(() => enforceContentLength(String(MAX_FETCH_BYTES + 1)));
});

test('truncation is explicit', () => {
  const out = truncateText('abcdef', 3);
  assert.equal(out.text, 'abc');
  assert.equal(out.truncated, true);
});

test('decodes declared non-UTF8 text when the browser supports the charset', async () => {
  const { decodeBytes } = await import('../extension/core/fetch-policy.js');
  const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9]);
  assert.equal(decodeBytes(bytes, 'text/plain; charset=iso-8859-1'), 'café');
});

test('falls back to UTF-8 for bogus charset labels', async () => {
  const { decodeBytes } = await import('../extension/core/fetch-policy.js');
  const bytes = new TextEncoder().encode('中文');
  assert.equal(decodeBytes(bytes, 'text/plain; charset=definitely-not-a-real-charset'), '中文');
});
