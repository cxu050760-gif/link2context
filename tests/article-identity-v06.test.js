import test from 'node:test';
import assert from 'node:assert/strict';
import { createContextDocument } from '../extension/core/context-model.js';
import { articleIdentityEvidence, assertSameArticle } from '../extension/core/article-identity-v06.js';

function doc({ title, canonicalUrl = '', author = '', text = '' }) {
  return createContextDocument({
    sourceUrl: 'https://example.com/story',
    title,
    canonicalUrl,
    author,
    blocks: [{ type: 'paragraph', text }],
  });
}

test('v0.6 pagination accepts matching canonical article pages', () => {
  const first = doc({ title: 'A long investigation', canonicalUrl: 'https://example.com/story', text: 'opening facts and background' });
  const next = doc({ title: 'A long investigation - Page 2', canonicalUrl: 'https://example.com/story', text: 'continued evidence and interviews' });
  const evidence = assertSameArticle(first, next);
  assert.equal(evidence.sameArticle, true);
  assert.equal(evidence.canonicalMatch, true);
});

test('v0.6 pagination rejects a next-article link with unrelated identity', () => {
  const first = doc({ title: 'Mars mission timeline', author: 'A', text: 'launch vehicle mission orbit spacecraft' });
  const other = doc({ title: 'Local football transfer news', author: 'B', text: 'club striker league transfer contract' });
  const evidence = articleIdentityEvidence(first, other);
  assert.equal(evidence.sameArticle, false);
  assert.throws(() => assertSameArticle(first, other), /article identity check/);
});
