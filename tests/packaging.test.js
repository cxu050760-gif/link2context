import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(here, '../extension');

test('extension is self-contained when extension/ is loaded unpacked', () => {
  const popup = fs.readFileSync(path.join(extensionRoot, 'popup.js'), 'utf8');
  const imports = [...popup.matchAll(/from\s+['"](\.\/[^'"]+)['"]/g)].map((m) => m[1]);
  assert.ok(imports.length >= 1);
  for (const specifier of imports) {
    const target = path.resolve(extensionRoot, specifier);
    assert.ok(target.startsWith(extensionRoot + path.sep));
    assert.ok(fs.existsSync(target), `missing ${specifier}`);
  }
  assert.ok(fs.existsSync(path.join(extensionRoot, 'manifest.json')));
});

test('original download does not bypass the bounded fetch path', () => {
  const popup = fs.readFileSync(path.join(extensionRoot, 'popup.js'), 'utf8');
  const fn = popup.slice(popup.indexOf('async function downloadOriginal'), popup.indexOf("$('convert').addEventListener"));
  assert.match(fn, /fetchBoundedWithRetry\(resolved\.fetchUrl/);
  assert.doesNotMatch(fn, /downloads\.download\(\{\s*url:\s*resolved\.fetchUrl\.href/);
});
