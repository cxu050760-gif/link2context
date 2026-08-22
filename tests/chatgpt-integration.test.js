import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('ChatGPT recognized shares have a real browser-navigation parse fallback', () => {
  const background = read('extension/background.js');
  assert.match(background, /resolved\.kind === 'chatgpt-share'/);
  assert.match(background, /readChatGptViaBackgroundTab/);
  assert.match(background, /chatGptShareHtmlToMarkdown/);
  assert.match(background, /document\.documentElement\?\.outerHTML/);
  assert.match(background, /chrome\.tabs\.remove\(tabId\)/);
});

test('ChatGPT fallback is pinned to HTTPS chatgpt.com and the same share path', () => {
  const background = read('extension/background.js');
  assert.match(background, /CHATGPT_SHARE_HOST = 'chatgpt\.com'/);
  assert.match(background, /url\.protocol !== 'https:'/);
  assert.match(background, /url\.hostname\.toLowerCase\(\) !== CHATGPT_SHARE_HOST/);
  assert.match(background, /expectedPath = `\/share\/\$\{encodeURIComponent\(shareId\)\}`/);
  assert.match(background, /url\.pathname !== expectedPath/);
});

test('ChatGPT fallback keeps the global response byte cap', () => {
  const background = read('extension/background.js');
  const start = background.indexOf('async function readChatGptViaBackgroundTab');
  const end = background.indexOf('async function fetchResolved', start);
  const fn = background.slice(start, end);
  assert.match(fn, /MAX_FETCH_BYTES/);
  assert.match(fn, /bytes\.byteLength > MAX_FETCH_BYTES/);
});

test('manual popup and automatic bridge use the same clean ChatGPT extractor', () => {
  const popup = read('extension/popup.js');
  const background = read('extension/background.js');
  assert.match(popup, /resolveSourceUrl/);
  assert.match(popup, /resolved\.kind === 'chatgpt-share'/);
  assert.match(popup, /chatGptShareHtmlToMarkdown\(decoded, sourceUrl\.href\)/);
  assert.match(background, /chatGptShareHtmlToMarkdown/);
  assert.doesNotMatch(popup, /resolveSpecialUrl/);
});

test('long ChatGPT clean context gets a source-specific Markdown filename', () => {
  const background = read('extension/background.js');
  assert.match(background, /chatgpt-\$\{sanitizeAttachmentName\(resolved\.shareId\)\}\.md/);
  assert.match(background, /convertedFromText: true/);
});
