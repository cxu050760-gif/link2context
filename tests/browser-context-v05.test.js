import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('browser-context fallback is persistent opt-in and supports a deny list', () => {
  const background = read('extension/background.js');
  const popup = read('extension/popup.js');
  assert.match(background, /authorizedBrowserContext/);
  assert.match(background, /browserContextDeniedHosts/);
  assert.match(background, /data\[BROWSER_CONTEXT_KEY\] === true/);
  assert.match(background, /host\.endsWith\(`\.\$\{candidate\}`\)/);
  assert.match(popup, /window\.confirm/);
  assert.match(popup, /撤销浏览器上下文授权/);
});

test('authorized fallback is a router for 401, 403 and render-shell failures', () => {
  const background = read('extension/background.js');
  assert.match(background, /AUTH_REQUIRED_401/);
  assert.match(background, /FETCH_BLOCKED_403/);
  assert.match(background, /CLIENT_RENDER_CONTENT_MISSING/);
  assert.match(background, /readViaAuthorizedBrowser/);
  assert.match(background, /pagination-browser-fallback/);
});

test('generic browser navigation validates public URLs and pins final navigation to the requested origin', () => {
  const background = read('extension/background.js');
  const section = background.slice(background.indexOf('async function readViaAuthorizedBrowser'), background.indexOf('async function fetchResolved'));
  assert.match(section, /const target = validatePublicHttpUrl\(input\)/);
  assert.match(section, /expectedOrigin = target\.origin/);
  assert.match(section, /const checked = validatePublicHttpUrl\(value\)/);
  assert.match(section, /checked\.origin !== expectedOrigin/);
  assert.match(section, /BROWSER_CONTEXT_CROSS_ORIGIN_NAVIGATION/);
  assert.match(section, /requireExpectedOrigin\(page\.href \|\| tab\.url \|\| target\.href\)/);
});

test('authorized use is visibly reported and does not call the cookies API directly', () => {
  const background = read('extension/background.js');
  assert.match(background, /browser-context-authorized/);
  assert.match(background, /Using authorized browser context/);
  assert.doesNotMatch(background, /chrome\.cookies/);
});

test('binary fallback fetch happens inside the authorized target tab with credentials include and redirects disabled', () => {
  const background = read('extension/background.js');
  const start = background.indexOf('async function readBinaryInsideAuthorizedTab');
  const end = background.indexOf('async function readViaAuthorizedBrowser');
  const section = background.slice(start, end);
  assert.match(section, /credentials: 'include'/);
  assert.match(section, /redirect: 'error'/);
  assert.match(section, /MAX_FETCH_BYTES|limit/);
  assert.match(section, /response\.arrayBuffer\(\)/);
});

test('popup explains persistent authorization and per-site exclusion in Chinese and English', () => {
  const html = read('extension/popup.html');
  assert.match(html, /授权浏览器上下文 \/ Authorized browser context/);
  assert.match(html, /持续授权/);
  assert.match(html, /Never use browser context on these hosts/);
  assert.match(html, /STOP \/ 停止/);
});
