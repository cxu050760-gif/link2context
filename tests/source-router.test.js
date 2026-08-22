import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChatGptShare, chatGptShareUrl, resolveSourceUrl } from '../extension/core/source-router.js';

test('recognizes ChatGPT public share links and canonicalizes away query data', () => {
  const url = new URL('https://chatgpt.com/share/abcDEF_123-xyz?token=SECRET#fragment');
  assert.equal(parseChatGptShare(url), 'abcDEF_123-xyz');
  const resolved = resolveSourceUrl(url);
  assert.equal(resolved.kind, 'chatgpt-share');
  assert.equal(resolved.fetchUrl.href, 'https://chatgpt.com/share/abcDEF_123-xyz');
  assert.ok(!resolved.fetchUrl.href.includes('SECRET'));
});

test('does not treat normal ChatGPT conversations as public share links', () => {
  assert.equal(parseChatGptShare(new URL('https://chatgpt.com/c/abcDEF123')), null);
  assert.equal(resolveSourceUrl(new URL('https://chatgpt.com/c/abcDEF123')).kind, 'generic');
});

test('dot segments normalize away and malformed share ids are rejected by constructors', () => {
  assert.equal(parseChatGptShare(new URL('https://chatgpt.com/share/%2e%2e')), null);
  assert.throws(() => chatGptShareUrl('../evil'));
  assert.throws(() => chatGptShareUrl('abc/def'));
});

test('encoded slash cannot become a ChatGPT share id', () => {
  assert.throws(() => parseChatGptShare(new URL('https://chatgpt.com/share/abc%2Fdef123')));
});

test('preserves WorkBuddy special routing', () => {
  const resolved = resolveSourceUrl(new URL('https://workbuddy.link/p/fqAaNqzcOZ0DzTS9JZGXsM?ext2=copy_link'));
  assert.equal(resolved.kind, 'workbuddy');
  assert.match(resolved.fetchUrl.href, /conversation-data\.json$/);
});

test('ordinary public URLs remain generic', () => {
  const url = new URL('https://example.com/article');
  const resolved = resolveSourceUrl(url);
  assert.equal(resolved.kind, 'generic');
  assert.equal(resolved.fetchUrl.href, url.href);
});
