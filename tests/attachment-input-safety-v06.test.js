import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

for (const rel of ['extension/content-script-v06.js', 'extension/qianwen-structured-v06.js']) {
  test(`${rel}: incompatible file inputs fail closed`, () => {
    const source = read(rel);
    const fileInputStart = source.indexOf('function fileInput(file)');
    const revealStart = source.indexOf('async function reveal', fileInputStart);
    assert.ok(fileInputStart >= 0 && revealStart > fileInputStart);
    const fileInput = source.slice(fileInputStart, revealStart);
    assert.match(fileInput, /find\(\(input\) => inputAccepts\(input, file\)\) \|\| null/);
    assert.doesNotMatch(fileInput, /\|\| (all|inputs)\[0\]/);

    const attachStart = source.indexOf('async function attachFile(file, editor, job)');
    const nextFunction = source.indexOf('\n  function ', attachStart);
    assert.ok(attachStart >= 0 && nextFunction > attachStart);
    const attach = source.slice(attachStart, nextFunction);
    assert.match(attach, /!input \|\| !inputAccepts\(input, file\)/);
    assert.doesNotMatch(attach, /removeAttribute\(['"]accept['"]\)/);
    assert.doesNotMatch(attach, /oldAccept/);
  });
}
