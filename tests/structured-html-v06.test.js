import test from 'node:test';
import assert from 'node:assert/strict';
import { createContextDocument } from '../extension/core/context-model.js';
import {
  mergeContextPages,
  selectContextImages,
  structuredContextSummary,
} from '../extension/core/structured-html-v06.js';

function page(pageNumber, blocks) {
  return createContextDocument({
    sourceUrl: `https://example.com/article?page=${pageNumber}`,
    canonicalUrl: 'https://example.com/article',
    title: 'Article',
    blocks: blocks.map((block) => ({ ...block, provenance: { sourceUrl: `https://example.com/article?page=${pageNumber}`, page: pageNumber } })),
    metadata: { extractionStrategy: 'mozilla-readability+structured-dom', readabilityApplied: true },
  });
}

test('v0.6 structured merge deduplicates repeated long body while preserving page provenance', () => {
  const repeated = 'This paragraph is deliberately long enough to be an exact repeated navigation-like paragraph across pages.';
  const merged = mergeContextPages([
    page(1, [{ type: 'paragraph', text: repeated }, { type: 'paragraph', text: 'first page unique' }]),
    page(2, [{ type: 'paragraph', text: repeated }, { type: 'paragraph', text: 'second page unique' }]),
  ], { sourceUrl: 'https://example.com/article' });
  assert.equal(merged.metadata.pageCount, 2);
  assert.equal(merged.blocks.filter((block) => block.text === repeated).length, 1);
  assert.equal(merged.blocks.some((block) => block.text === 'second page unique' && block.provenance.page === 2), true);
});

test('v0.6 image selector rejects trackers and prioritizes captioned content images', () => {
  const doc = page(1, [
    { type: 'image', src: 'https://cdn.example.com/tracking-pixel.gif', width: 1, height: 1, alt: '' },
    { type: 'image', src: 'https://cdn.example.com/logo.png', width: 120, height: 40, alt: 'site logo' },
    { type: 'image', src: 'https://cdn.example.com/chart.png', width: 900, height: 600, alt: 'Quarterly revenue chart', caption: 'Revenue rose in Q4' },
    { type: 'image', src: 'https://cdn.example.com/photo.jpg', width: 700, height: 500, alt: 'Factory floor' },
  ]);
  const picked = selectContextImages(doc, { limit: 2 });
  assert.equal(picked.length, 2);
  assert.equal(picked[0].src, 'https://cdn.example.com/chart.png');
  assert.equal(picked.some((item) => /tracking-pixel/.test(item.src)), false);
  assert.equal(picked[0].assetId, 'web-image-1');
});

test('v0.6 structured summary exposes fidelity signals instead of only char count', () => {
  const doc = mergeContextPages([
    page(1, [
      { type: 'heading', text: 'H' },
      { type: 'paragraph', text: 'P' },
      { type: 'table', headers: ['A'], rows: [['1']] },
      { type: 'image', src: 'https://example.com/i.png', width: 500, height: 300 },
    ]),
  ], { sourceUrl: 'https://example.com/article' });
  const summary = structuredContextSummary(doc);
  assert.equal(summary.blocks, 4);
  assert.equal(summary.tables, 1);
  assert.equal(summary.images, 1);
  assert.equal(summary.pageCount, 1);
  assert.match(summary.extractionStrategy, /readability/);
});
