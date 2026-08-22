import test from 'node:test';
import assert from 'node:assert/strict';
import { assessHtmlContent, extractNextPageUrl, htmlToReadableText } from '../extension/core/html-lite.js';

const paragraph = 'Useful article sentence with enough detail for content extraction. '.repeat(12);

test('semantic main/article content is preferred over site chrome', () => {
  const html = `<!doctype html><html><head><title>Article</title></head><body>
    <nav>HOME LOGIN PRODUCTS SOLUTIONS RESOURCES ${'NAV '.repeat(80)}</nav>
    <main><article><h1>REAL TITLE</h1><p>${paragraph}</p></article></main>
    <footer>FOOTER LEGAL COOKIE ${'FOOT '.repeat(80)}</footer>
  </body></html>`;
  const text = htmlToReadableText(html);
  assert.match(text, /REAL TITLE/);
  assert.match(text, /Useful article sentence/);
  assert.doesNotMatch(text, /PRODUCTS SOLUTIONS/);
  assert.doesNotMatch(text, /FOOTER LEGAL/);
});

test('common sidebar/menu wrappers are stripped without deleting the article', () => {
  const html = `<body><div class="sidebar-menu">SIDEBAR ${'x '.repeat(100)}</div><article><p>${paragraph}</p></article><div id="toolbar">TOOLS</div></body>`;
  const text = htmlToReadableText(html);
  assert.doesNotMatch(text, /SIDEBAR/);
  assert.doesNotMatch(text, /TOOLS/);
  assert.match(text, /Useful article sentence/);
});

test('large JS shell with empty app root is classified as render-missing', () => {
  const html = `<html><head><title>SPA</title>${'<script>window.x=1</script>'.repeat(200)}</head><body><div id="root"></div></body></html>`;
  const result = assessHtmlContent(html);
  assert.equal(result.shellOnly, true);
  assert.ok(result.bodyChars < 400);
});

test('tiny legitimate static page is not rejected merely for being short', () => {
  const html = '<html><head><title>Hi</title></head><body><main><p>Hello world.</p></main></body></html>';
  const result = assessHtmlContent(html);
  assert.equal(result.shellOnly, false);
  assert.match(result.readable, /Hello world/);
});

test('rel=next follows a same-origin next page even with opaque page naming', () => {
  const html = '<a rel="next" href="/article/continuation-token">Continue</a>';
  assert.equal(extractNextPageUrl(html, 'https://news.example/article/start'), 'https://news.example/article/continuation-token');
});

test('Chinese 下一页 follows same article family with numeric suffix', () => {
  const html = '<a href="/qd/h/11583476_2.html">下一页</a>';
  assert.equal(extractNextPageUrl(html, 'https://mini.example/qd/h/11583476.html'), 'https://mini.example/qd/h/11583476_2.html');
});

test('query-based pagination is recognized for explicit Next text', () => {
  const html = '<a href="?page=2">Next</a>';
  assert.equal(extractNextPageUrl(html, 'https://example.com/story?page=1'), 'https://example.com/story?page=2');
});

test('cross-origin next links are rejected even when rel=next', () => {
  const html = '<a rel="next" href="https://evil.example/steal">Next</a>';
  assert.equal(extractNextPageUrl(html, 'https://example.com/story'), null);
});

test('generic Next link to another article is rejected without rel=next', () => {
  const html = '<a href="/another-story">Next</a>';
  assert.equal(extractNextPageUrl(html, 'https://example.com/story'), null);
});

test('self links and fragment-only pagination cannot loop', () => {
  assert.equal(extractNextPageUrl('<a rel="next" href="#more">Next</a>', 'https://example.com/story'), null);
  assert.equal(extractNextPageUrl('<a rel="next" href="/story">Next</a>', 'https://example.com/story'), null);
});
