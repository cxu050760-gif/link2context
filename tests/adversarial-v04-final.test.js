import test from 'node:test';
import assert from 'node:assert/strict';
import { detectResourceType } from '../extension/core/resource-type.js';
import { assessHtmlContent } from '../extension/core/html-lite.js';

const enc = new TextEncoder();

test('a .pdf URL returning a real HTML challenge page stays HTML instead of becoming a fake PDF', () => {
  const body = enc.encode('<!doctype html><html><head><title>Access denied</title></head><body><main>Please verify you are human.</main></body></html>');
  const out = detectResourceType({ bytes: body, contentType: 'text/html', url: 'https://example.com/report.pdf' });
  assert.equal(out.kind, 'html');
  assert.equal(out.mime, 'text/html');
});

test('a binary .pdf payload still uses the extension fallback when MIME is generic', () => {
  const out = detectResourceType({ bytes: new Uint8Array([1,2,3,4,5]), contentType: 'application/octet-stream', url: 'https://example.com/report.pdf' });
  assert.equal(out.kind, 'pdf');
  assert.equal(out.mime, 'application/pdf');
});

test('title-only HTML is shell-only even when the document is short', () => {
  const out = assessHtmlContent('<html><head><title>Instagram</title></head><body></body></html>');
  assert.equal(out.bodyChars, 0);
  assert.equal(out.shellOnly, true);
});

test('short HTML with actual body text is still accepted', () => {
  const out = assessHtmlContent('<html><head><title>Hello</title></head><body><main>Useful body text.</main></body></html>');
  assert.ok(out.bodyChars > 0);
  assert.equal(out.shellOnly, false);
});
