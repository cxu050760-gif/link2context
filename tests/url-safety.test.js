import test from 'node:test';
import assert from 'node:assert/strict';
import { safeDisplayUrl, validatePublicHttpUrl, validateRedirect } from '../extension/core/url-safety.js';

test('accepts public https URL', () => {
  assert.equal(validatePublicHttpUrl('https://example.com/a#x').href, 'https://example.com/a');
});

test('blocks non-http schemes', () => {
  assert.throws(() => validatePublicHttpUrl('file:///etc/passwd'));
  assert.throws(() => validatePublicHttpUrl('data:text/plain,hi'));
});

test('blocks credentials and local targets including odd IPv4 forms', () => {
  assert.throws(() => validatePublicHttpUrl('https://u:p@example.com/'));
  for (const u of ['http://localhost/', 'http://127.0.0.1/', 'http://10.0.0.1/', 'http://172.16.0.1/', 'http://172.31.255.1/', 'http://192.168.1.1/', 'http://169.254.169.254/', 'http://[::1]/', 'http://2130706433/', 'http://0x7f000001/']) {
    assert.throws(() => validatePublicHttpUrl(u), u);
  }
});

test('re-validates redirect destinations', () => {
  assert.throws(() => validateRedirect(new URL('https://example.com/a'), 'http://127.0.0.1/admin'));
  assert.equal(validateRedirect(new URL('https://example.com/a'), '/next').href, 'https://example.com/next');
});

test('redacts likely credentials from displayed source URL', () => {
  const out = safeDisplayUrl('https://example.com/a?api_key=SECRET&q=keep&token=ABC');
  assert.ok(!out.includes('SECRET'));
  assert.ok(!out.includes('ABC'));
  assert.ok(out.includes('q=keep'));
  assert.ok(out.includes('REDACTED'));
});
