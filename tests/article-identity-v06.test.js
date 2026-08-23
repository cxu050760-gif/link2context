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

test('v0.6 pagination accepts matching canonical article pages with independent title support', () => {
  const first = doc({ title: 'A long investigation', canonicalUrl: 'https://example.com/story', text: 'opening facts and background' });
  const next = doc({ title: 'A long investigation - Page 2', canonicalUrl: 'https://example.com/story', text: 'continued evidence and interviews' });
  const evidence = assertSameArticle(first, next);
  assert.equal(evidence.sameArticle, true);
  assert.equal(evidence.canonicalMatch, true);
  assert.equal(evidence.independentSupport, true);
});

test('v0.6 pagination rejects a next-article link with unrelated identity', () => {
  const first = doc({ title: 'Mars mission timeline', author: 'A', text: 'launch vehicle mission orbit spacecraft' });
  const other = doc({ title: 'Local football transfer news', author: 'B', text: 'club striker league transfer contract' });
  const evidence = articleIdentityEvidence(first, other);
  assert.equal(evidence.sameArticle, false);
  assert.throws(() => assertSameArticle(first, other), /article identity check/);
});

test('v0.6 pagination rejects a generic same-title page when title is the only matching signal', () => {
  const first = doc({ title: 'News', text: 'space telescope galaxy orbit science mission' });
  const other = doc({ title: 'News', text: 'football striker transfer league contract club' });
  const evidence = articleIdentityEvidence(first, other);
  assert.equal(evidence.titleSimilarity, 1);
  assert.equal(evidence.bodySimilarity, 0);
  assert.equal(evidence.sameArticle, false);
});

test('v0.6 pagination does not trust canonical metadata as a sole identity proof', () => {
  const first = doc({ title: '', canonicalUrl: 'https://example.com/story', text: 'alpha beta gamma' });
  const other = doc({ title: '', canonicalUrl: 'https://example.com/story', text: 'delta epsilon zeta' });
  const evidence = articleIdentityEvidence(first, other);
  assert.equal(evidence.canonicalMatch, true);
  assert.equal(evidence.independentSupport, false);
  assert.equal(evidence.sameArticle, false);
});
