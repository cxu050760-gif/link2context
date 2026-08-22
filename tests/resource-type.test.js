import test from 'node:test';
import assert from 'node:assert/strict';
import { detectResourceType, isBinaryResourceKind, looksLikeTextBytes } from '../extension/core/resource-type.js';

const enc = new TextEncoder();
const bytes = (...values) => new Uint8Array(values);

function detect(body, contentType = '', url = 'https://example.com/file') {
  return detectResourceType({ bytes: body, contentType, url });
}

test('PDF magic wins over lying text/plain Content-Type', () => {
  const out = detect(enc.encode('%PDF-1.7\n1 0 obj\n'), 'text/plain', 'https://example.com/download');
  assert.equal(out.kind, 'pdf');
  assert.equal(out.mime, 'application/pdf');
  assert.equal(isBinaryResourceKind(out.kind), true);
});

test('PDF extension prevents binary from becoming text when MIME is generic', () => {
  const out = detect(bytes(1,2,3,4,5), 'application/octet-stream', 'https://example.com/a.pdf');
  assert.equal(out.kind, 'pdf');
  assert.equal(out.mime, 'application/pdf');
});

test('PNG magic wins over missing or incorrect MIME', () => {
  const out = detect(bytes(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2), 'text/plain');
  assert.equal(out.kind, 'image');
  assert.equal(out.mime, 'image/png');
});

test('JPEG, GIF and WebP signatures are binary images', () => {
  assert.equal(detect(bytes(0xff,0xd8,0xff,0xe0), '').mime, 'image/jpeg');
  assert.equal(detect(enc.encode('GIF89a rest'), '').mime, 'image/gif');
  const webp = new Uint8Array(16); webp.set(enc.encode('RIFF'), 0); webp.set(enc.encode('WEBP'), 8);
  assert.equal(detect(webp, '').mime, 'image/webp');
});

test('ZIP magic plus DOCX/XLSX/PPTX extension preserves Office MIME', () => {
  const zip = bytes(0x50,0x4b,0x03,0x04,1,2,3);
  assert.equal(detect(zip, 'application/octet-stream', 'https://example.com/a.docx').mime, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(detect(zip, '', 'https://example.com/a.xlsx').mime, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(detect(zip, '', 'https://example.com/a.pptx').mime, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
});

test('ZIP, gzip, 7z and RAR remain archives', () => {
  assert.equal(detect(bytes(0x50,0x4b,0x03,0x04), '').kind, 'archive');
  assert.equal(detect(bytes(0x1f,0x8b,0x08), '').mime, 'application/gzip');
  assert.equal(detect(bytes(0x37,0x7a,0xbc,0xaf,0x27,0x1c), '').mime, 'application/x-7z-compressed');
  assert.equal(detect(bytes(0x52,0x61,0x72,0x21,0x1a,0x07,0x00), '').mime, 'application/vnd.rar');
});

test('MP3, WAV, OGG, MP4 and WebM signatures are not decoded as text', () => {
  assert.equal(detect(enc.encode('ID3more'), 'text/plain').kind, 'audio');
  const wav = new Uint8Array(16); wav.set(enc.encode('RIFF'), 0); wav.set(enc.encode('WAVE'), 8);
  assert.equal(detect(wav, '').mime, 'audio/wav');
  assert.equal(detect(enc.encode('OggS....'), '').mime, 'audio/ogg');
  const mp4 = new Uint8Array(16); mp4.set(enc.encode('ftyp'), 4);
  assert.equal(detect(mp4, '').mime, 'video/mp4');
  assert.equal(detect(bytes(0x1a,0x45,0xdf,0xa3,1,2), '').mime, 'video/webm');
});

test('octet-stream containing clean UTF-8 text is rescued as text', () => {
  const out = detect(enc.encode('hello world\nplain content'), 'application/octet-stream');
  assert.equal(out.kind, 'text');
});

test('mislabeled octet-stream JSON and HTML are sniffed safely', () => {
  assert.equal(detect(enc.encode('{"ok":true}'), 'application/octet-stream').kind, 'json');
  assert.equal(detect(enc.encode('<!doctype html><html><body>Hello</body></html>'), 'application/octet-stream').kind, 'html');
});

test('declared JSON/HTML remain textual only when bytes are not clearly binary', () => {
  assert.equal(detect(enc.encode('{"x":1}'), 'application/json').kind, 'json');
  assert.equal(detect(enc.encode('<html><body>x</body></html>'), 'text/html').kind, 'html');
  assert.equal(detect(bytes(0,1,2,3,4), 'text/html').kind, 'binary');
});

test('NUL and control-heavy payloads fail closed as binary', () => {
  const body = bytes(0,1,2,3,0,5,6,7,8,9);
  assert.equal(looksLikeTextBytes(body), false);
  assert.equal(detect(body, 'application/octet-stream').kind, 'binary');
});

test('binary extension beats misleading text MIME as a conservative safety fallback', () => {
  const out = detect(bytes(1,2,3,4), 'text/plain', 'https://example.com/movie.mp4');
  assert.equal(out.kind, 'video');
  assert.equal(out.mime, 'video/mp4');
});

test('CSV, XML and Markdown remain text-capable resources', () => {
  assert.equal(detect(enc.encode('a,b\n1,2'), 'text/csv', 'https://example.com/a.csv').kind, 'text');
  assert.equal(detect(enc.encode('<root>ok</root>'), 'application/xml', 'https://example.com/a.xml').kind, 'text');
  assert.equal(detect(enc.encode('# hello'), 'text/plain', 'https://example.com/a.md').kind, 'text');
});

test('empty body is treated as text-like but not fabricated into a binary type', () => {
  const out = detect(new Uint8Array(), '', 'https://example.com/empty');
  assert.equal(out.kind, 'text');
});
