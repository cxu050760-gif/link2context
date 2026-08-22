import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

for (const rel of ['extension/content-script-v06.js', 'extension/qianwen-structured-v06.js']) {
  test(`${rel}: incompatible, disabled and unrelated file inputs fail closed`, () => {
    const source = read(rel);
    const helperStart = source.indexOf('function usableFileInput(input, file)');
    const helperEnd = source.indexOf('\n  function attachmentScore', helperStart);
    assert.ok(helperStart >= 0 && helperEnd > helperStart);
    const helper = source.slice(helperStart, helperEnd);
    assert.match(helper, /!input\.disabled/);
    assert.match(helper, /aria-disabled/);
    assert.match(helper, /inputAccepts\(input, file\)/);

    const fileInputStart = source.indexOf('function fileInput(editor, file, baseline = null)');
    const revealStart = source.indexOf('async function reveal', fileInputStart);
    assert.ok(fileInputStart >= 0 && revealStart > fileInputStart);
    const fileInput = source.slice(fileInputStart, revealStart);
    assert.match(fileInput, /attachmentScope\(editor\)/);
    assert.match(fileInput, /!baseline\.has\(input\)/);
    assert.match(fileInput, /if \(!baseline\) return null/);
    assert.match(fileInput, /!input\.disabled/);
    assert.match(fileInput, /inputAccepts\(input, file\)/);
    assert.doesNotMatch(fileInput, /return (?:all|inputs)\.find/);

    const revealEnd = source.indexOf('\n  function filename', revealStart);
    assert.ok(revealEnd > revealStart);
    const reveal = source.slice(revealStart, revealEnd);
    assert.match(reveal, /const baseline = new Set\(document\.querySelectorAll\('input\[type="file"\]'\)\)/);
    assert.match(reveal, /safeAttachmentControl/);
    assert.doesNotMatch(reveal, /\.\.\.document\.querySelectorAll\('button/);

    const controlStart = source.indexOf('function safeAttachmentControl');
    const controlEnd = source.indexOf('\n  function fileInput', controlStart);
    assert.ok(controlStart >= 0 && controlEnd > controlStart);
    const control = source.slice(controlStart, controlEnd);
    assert.match(control, /aria-disabled/);
    assert.match(control, /submit/);

    const attachStart = source.indexOf('async function attachFile(file, editor, job)');
    const nextFunction = source.indexOf('\n  function ', attachStart);
    assert.ok(attachStart >= 0 && nextFunction > attachStart);
    const attach = source.slice(attachStart, nextFunction);
    assert.match(attach, /!usableFileInput\(input, file\)/);
    assert.doesNotMatch(attach, /removeAttribute\(['"]accept['"]\)/);
    assert.doesNotMatch(attach, /oldAccept/);
  });

  test(`${rel}: attachment confirmation is scoped to the active composer`, () => {
    const source = read(rel);
    const fnStart = source.indexOf('function filenameVisible(name, editor)');
    const fnEnd = source.indexOf('\n  async function attachFile', fnStart);
    assert.ok(fnStart >= 0 && fnEnd > fnStart);
    const fn = source.slice(fnStart, fnEnd);
    assert.match(fn, /attachmentScope\(editor\)/);
    assert.doesNotMatch(fn, /document\.body\?\.innerText/);
  });
}
