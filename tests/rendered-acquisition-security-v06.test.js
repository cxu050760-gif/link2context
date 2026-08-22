import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const source = fs.readFileSync(path.join(root, 'extension/core/rendered-acquisition-v06.js'), 'utf8');

test('v0.6 rendered acquisition rechecks browser-context authorization after navigation', () => {
  assert.match(source, /async function requireAuthorizedLocation/);
  assert.match(source, /const expectedOrigin = policy\.target\.origin/);
  assert.match(source, /await requireAuthorizedLocation\(tab\.url, expectedOrigin\)/);
  assert.match(source, /await requireAuthorizedLocation\(current\.href \|\| tab\.url \|\| policy\.target\.href, expectedOrigin\)/);
  assert.match(source, /BROWSER_CONTEXT_DENIED_FOR_SITE/);
  assert.match(source, /BROWSER_CONTEXT_CROSS_ORIGIN_NAVIGATION/);
});

test('v0.6 load-more anchor candidates cannot navigate cross-origin', () => {
  assert.match(source, /destination\.origin !== location\.origin/);
  assert.match(source, /if \(el\.tagName === 'A'\)/);
});
