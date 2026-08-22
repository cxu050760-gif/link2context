import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverNextPage, extractNextPageUrl } from '../extension/core/html-lite.js';

test('head link rel=next is the strongest generic pagination signal', () => {
  const html = '<html><head><link rel="next" href="/story/2"></head><body>page one</body></html>';
  const out = discoverNextPage(html, 'https://example.com/story/1');
  assert.equal(out.url, 'https://example.com/story/2');
  assert.equal(out.reason, 'link-rel-next');
});

test('semantic next labels tolerate nested tags, punctuation and aria labels', () => {
  const html = '<a class="pager next" href="article_2.shtml"><span>下一页</span> &gt;</a>';
  assert.equal(extractNextPageUrl(html, 'https://news.example.com/article.shtml'), 'https://news.example.com/article_2.shtml');

  const aria = '<a href="?page=2" aria-label="Next page"><svg></svg></a>';
  assert.equal(extractNextPageUrl(aria, 'https://example.com/read?page=1'), 'https://example.com/read?page=2');
});

test('HTML entities inside pagination hrefs are decoded before URL resolution', () => {
  const html = '<a rel="next" href="/read?id=9&amp;page=2">Next</a>';
  assert.equal(extractNextPageUrl(html, 'https://example.com/read?id=9&page=1'), 'https://example.com/read?id=9&page=2');
});

test('numeric 1/8 style pagination can advance when page one is not an anchor', () => {
  const html = `
    <div class="pagination">
      <span class="current">1</span>
      <a href="/story_2.html">2</a>
      <a href="/story_3.html">3</a>
      <a href="/story_4.html">4</a>
      <a href="/story_5.html">5</a>
      <a href="/story_6.html">6</a>
      <a href="/story_7.html">7</a>
      <a href="/story_8.html">8</a>
    </div>`;
  const out = discoverNextPage(html, 'https://example.com/story.html');
  assert.equal(out.url, 'https://example.com/story_2.html');
  assert.equal(out.reason, 'numeric-pagination');
  assert.equal(out.pageNumber, 2);
});

test('numeric pagination follows current URL page number without a current marker', () => {
  const html = '<a href="?page=1">1</a><a href="?page=3">3</a><a href="?page=4">4</a><a href="?page=5">5</a>';
  assert.equal(extractNextPageUrl(html, 'https://example.com/read?page=2'), 'https://example.com/read?page=3');
});

test('cross-origin and unrelated article links never become numeric pagination', () => {
  const cross = '<span class="current">1</span><a href="https://evil.example/x_2.html">2</a><a href="https://evil.example/x_3.html">3</a><a href="https://evil.example/x_4.html">4</a>';
  assert.equal(extractNextPageUrl(cross, 'https://example.com/story.html'), null);

  const unrelated = '<span class="current">1</span><a href="/other_2.html">2</a><a href="/third_3.html">3</a><a href="/fourth_4.html">4</a>';
  assert.equal(extractNextPageUrl(unrelated, 'https://example.com/story.html'), null);
});
