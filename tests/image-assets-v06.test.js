import test from 'node:test';
import assert from 'node:assert/strict';
import { createContextDocument } from '../extension/core/context-model.js';
import {
  acquireContextImages,
  bindContextImageAssets,
} from '../extension/core/image-assets-v06.js';

const PNG = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3,4]);

function response(bytes, type = 'image/png') {
  return new Response(bytes, { status: 200, headers: { 'content-type': type, 'content-length': String(bytes.byteLength) } });
}

test('v0.6 image acquisition fetches only selected real images and binds asset ids', async () => {
  const doc = createContextDocument({
    sourceUrl: 'https://example.com/article',
    blocks: [
      { type: 'image', src: 'https://cdn.example.com/chart.png', width: 800, height: 600, caption: 'Chart' },
      { type: 'image', src: 'https://cdn.example.com/pixel.gif', width: 1, height: 1 },
    ],
  });
  const calls = [];
  const result = await acquireContextImages(doc, {
    maxCount: 4,
    fetchFn: async (url) => {
      calls.push(url);
      return response(PNG);
    },
  });
  assert.equal(result.acquiredCount, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /chart\.png/);
  assert.equal(result.assets[0].mime, 'image/png');
  bindContextImageAssets(doc, result.assets);
  assert.equal(doc.blocks[0].assetId, result.assets[0].assetId);
  assert.equal(doc.blocks[1].assetId, '');
});

test('v0.6 image acquisition skips resources that are not actually images', async () => {
  const doc = createContextDocument({
    sourceUrl: 'https://example.com/article',
    blocks: [{ type: 'image', src: 'https://cdn.example.com/fake.png', width: 800, height: 600 }],
  });
  const result = await acquireContextImages(doc, {
    fetchFn: async () => new Response(new TextEncoder().encode('<html>blocked</html>'), {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
  });
  assert.equal(result.acquiredCount, 0);
  assert.equal(result.partial, true);
});

test('v0.6 image acquisition respects total byte budget', async () => {
  const doc = createContextDocument({
    sourceUrl: 'https://example.com/article',
    blocks: [
      { type: 'image', src: 'https://cdn.example.com/a.png', width: 800, height: 600 },
      { type: 'image', src: 'https://cdn.example.com/b.png', width: 800, height: 600 },
    ],
  });
  const result = await acquireContextImages(doc, {
    maxTotalBytes: PNG.byteLength,
    maxPerImageBytes: PNG.byteLength,
    fetchFn: async () => response(PNG),
  });
  assert.equal(result.acquiredCount, 1);
  assert.equal(result.totalBytes, PNG.byteLength);
});
