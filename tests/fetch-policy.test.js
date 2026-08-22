import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyContentType,
  decodeBytes,
  decodeBytesDetailed,
  detectTextEncoding,
  enforceContentLength,
  MAX_FETCH_BYTES,
  sniffTextKind,
  truncateText,
} from '../extension/core/fetch-policy.js';

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

test('decodes declared non-UTF8 text when the browser supports the charset', () => {
  const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9]);
  assert.equal(decodeBytes(bytes, 'text/plain; charset=iso-8859-1'), 'café');
  assert.deepEqual(detectTextEncoding(bytes, 'text/plain; charset=iso-8859-1'), {
    charset: 'iso-8859-1', source: 'http-header', confidence: 'high',
  });
});

test('V0.6 detects legacy HTML encoding from meta charset when HTTP omits it', () => {
  const prefix = new TextEncoder().encode('<!doctype html><meta charset="gbk"><p>');
  const suffix = new TextEncoder().encode('</p>');
  const bytes = new Uint8Array(prefix.length + 4 + suffix.length);
  bytes.set(prefix, 0);
  bytes.set([0xd6, 0xd0, 0xce, 0xc4], prefix.length); // 中文 in GBK
  bytes.set(suffix, prefix.length + 4);
  const decoded = decodeBytesDetailed(bytes, 'text/html');
  assert.equal(decoded.charset, 'gbk');
  assert.equal(decoded.source, 'document-declaration');
  assert.match(decoded.text, /中文/);
});

test('V0.6 BOM has priority over absent headers', () => {
  const body = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('hello')]);
  const decoded = decodeBytesDetailed(body, 'text/plain');
  assert.equal(decoded.charset, 'utf-8');
  assert.equal(decoded.source, 'bom');
  assert.match(decoded.text, /hello/);
});

test('falls back to UTF-8 validity for bogus charset labels', () => {
  const bytes = new TextEncoder().encode('中文');
  const decoded = decodeBytesDetailed(bytes, 'text/plain; charset=definitely-not-a-real-charset');
  assert.equal(decoded.text, '中文');
  assert.equal(decoded.charset, 'utf-8');
  assert.equal(decoded.source, 'utf8-validity');
});
