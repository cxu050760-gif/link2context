import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const background = fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
const content = fs.readFileSync(new URL('../extension/content-script.js', import.meta.url), 'utf8');

test('generic resources are classified from raw bytes before any generic decode', () => {
  const classifyAt = background.indexOf('detectResourceType({ bytes, contentType');
  const genericDecodeAt = background.indexOf('const decoded = decodeBytes(bytes, contentType);');
  assert.ok(classifyAt >= 0);
  assert.ok(genericDecodeAt > classifyAt);
  assert.doesNotMatch(background, /sniffTextKind/);
});

test('binary resources have one safe attachment exit and preserve detected MIME', () => {
  assert.match(background, /isBinaryResourceKind\(resource\.kind\)/);
  assert.match(background, /mime = resource\.mime \|\| 'application\/octet-stream'/);
  assert.match(background, /base64: bytesToBase64\(bytes\)/);
  assert.match(background, /handoffReason: `resource:\$\{resource\.kind\}`/);
});

test('PDF and image binaries cannot fall through to text normalization path', () => {
  assert.match(background, /if \(resolved\.kind === 'generic' && isBinaryResourceKind\(resource\.kind\)\)/);
  assert.match(background, /return \{[\s\S]*?ok: true, kind: 'binary'/);
});

test('fetch/auth/render/parse failures return structured machine-readable metadata', () => {
  assert.match(background, /errorCode: info\.code/);
  assert.match(background, /errorStage: info\.stage/);
  assert.match(background, /statusCode: info\.status/);
  assert.match(background, /AUTH: '需要登录或授权/);
  assert.match(background, /RENDER: '页面正文不可用/);
});

test('content script preserves background pipeline stage instead of relabeling everything as handoff', () => {
  assert.match(content, /failure\.l2cStage = result\?\.errorStage/);
  assert.match(content, /const errorStage = String\(error\?\.l2cStage \|\| 'HANDOFF'\)/);
  assert.match(content, /failureLabel\(errorStage\)/);
});

test('shell-only HTML has an explicit RENDER failure and does not silently reuse login cookies', () => {
  assert.match(background, /CLIENT_RENDER_CONTENT_MISSING/);
  assert.match(background, /will not silently reuse your logged-in browser session/);
});

test('pagination is bounded by page count, same-origin detection helper, and total byte budget', () => {
  assert.match(background, /pages\.length < MAX_PAGINATION_PAGES/);
  assert.match(background, /totalBytes < MAX_FETCH_BYTES/);
  assert.match(background, /PAGINATION_PAGE_MAX_BYTES/);
  assert.match(background, /visited\.has\(next\)/);
});

test('partial pagination keeps fetched article content instead of failing the whole URL', () => {
  assert.match(background, /后续分页读取失败，保留已获取正文/);
  assert.match(background, /> ⚠️ PARTIAL \/ 部分完成/);
});

test('resource classification is visible in progress diagnostics', () => {
  assert.match(background, /'classify-resource'/);
  assert.match(background, /resource\.reason/);
  assert.match(content, /result\.resourceKind \|\| 'binary'/);
});
