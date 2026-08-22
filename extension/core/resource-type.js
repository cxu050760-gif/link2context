const TEXT_MIME = new Set([
  'application/json', 'application/ld+json', 'application/xml', 'application/xhtml+xml',
  'application/javascript', 'application/x-javascript', 'application/sql', 'application/graphql',
  'image/svg+xml',
]);

const EXTENSION_MIME = new Map([
  ['pdf', 'application/pdf'],
  ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['gif', 'image/gif'], ['webp', 'image/webp'], ['bmp', 'image/bmp'], ['avif', 'image/avif'],
  ['zip', 'application/zip'], ['7z', 'application/x-7z-compressed'], ['rar', 'application/vnd.rar'], ['gz', 'application/gzip'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['doc', 'application/msword'], ['xls', 'application/vnd.ms-excel'], ['ppt', 'application/vnd.ms-powerpoint'],
  ['mp3', 'audio/mpeg'], ['wav', 'audio/wav'], ['ogg', 'audio/ogg'], ['m4a', 'audio/mp4'], ['flac', 'audio/flac'],
  ['mp4', 'video/mp4'], ['webm', 'video/webm'], ['mov', 'video/quicktime'], ['avi', 'video/x-msvideo'],
  ['json', 'application/json'], ['html', 'text/html'], ['htm', 'text/html'], ['txt', 'text/plain'], ['md', 'text/markdown'], ['csv', 'text/csv'], ['xml', 'application/xml'], ['js', 'application/javascript'], ['css', 'text/css'],
]);

function ascii(bytes, start, length) {
  if (!bytes || bytes.length < start + length) return '';
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function starts(bytes, values) {
  if (!bytes || bytes.length < values.length) return false;
  for (let i = 0; i < values.length; i += 1) if (bytes[i] !== values[i]) return false;
  return true;
}

function normalizeMime(contentType = '') {
  return String(contentType || '').split(';', 1)[0].trim().toLowerCase();
}

function extensionFromUrl(url = '') {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    const match = /\.([a-z0-9]{1,10})$/i.exec(name);
    return match?.[1]?.toLowerCase() || '';
  } catch { return ''; }
}

function kindForMime(mime = '') {
  const m = normalizeMime(mime);
  if (m === 'application/pdf') return 'pdf';
  if (m === 'application/json' || m.endsWith('+json')) return 'json';
  if (m === 'text/html' || m === 'application/xhtml+xml') return 'html';
  if (m.startsWith('text/') || TEXT_MIME.has(m) || m.endsWith('+xml')) return 'text';
  if (m.startsWith('image/')) return m === 'image/svg+xml' ? 'text' : 'image';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  if (/zip|rar|7z|gzip|tar/.test(m)) return 'archive';
  if (/officedocument|msword|ms-excel|ms-powerpoint|opendocument/.test(m)) return 'document';
  return 'binary';
}

function magicType(bytes) {
  if (!bytes?.length) return null;
  if (ascii(bytes, 0, 5) === '%PDF-') return { kind: 'pdf', mime: 'application/pdf', reason: 'magic:pdf' };
  if (starts(bytes, [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) return { kind: 'image', mime: 'image/png', reason: 'magic:png' };
  if (starts(bytes, [0xff,0xd8,0xff])) return { kind: 'image', mime: 'image/jpeg', reason: 'magic:jpeg' };
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return { kind: 'image', mime: 'image/gif', reason: 'magic:gif' };
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return { kind: 'image', mime: 'image/webp', reason: 'magic:webp' };
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return { kind: 'audio', mime: 'audio/wav', reason: 'magic:wav' };
  if (ascii(bytes, 0, 4) === 'OggS') return { kind: 'audio', mime: 'audio/ogg', reason: 'magic:ogg' };
  if (ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return { kind: 'audio', mime: 'audio/mpeg', reason: 'magic:mp3' };
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') return { kind: 'video', mime: 'video/mp4', reason: 'magic:mp4' };
  if (starts(bytes, [0x1a,0x45,0xdf,0xa3])) return { kind: 'video', mime: 'video/webm', reason: 'magic:webm' };
  if (starts(bytes, [0x50,0x4b,0x03,0x04]) || starts(bytes, [0x50,0x4b,0x05,0x06]) || starts(bytes, [0x50,0x4b,0x07,0x08])) return { kind: 'archive', mime: 'application/zip', reason: 'magic:zip' };
  if (starts(bytes, [0x1f,0x8b])) return { kind: 'archive', mime: 'application/gzip', reason: 'magic:gzip' };
  if (starts(bytes, [0x37,0x7a,0xbc,0xaf,0x27,0x1c])) return { kind: 'archive', mime: 'application/x-7z-compressed', reason: 'magic:7z' };
  if (starts(bytes, [0x52,0x61,0x72,0x21,0x1a,0x07,0x00]) || starts(bytes, [0x52,0x61,0x72,0x21,0x1a,0x07,0x01,0x00])) return { kind: 'archive', mime: 'application/vnd.rar', reason: 'magic:rar' };
  return null;
}

export function looksLikeTextBytes(bytes, sampleLimit = 8192) {
  if (!bytes?.length) return true;
  const sample = bytes.subarray(0, Math.min(bytes.length, sampleLimit));
  let nul = 0;
  let controls = 0;
  for (const byte of sample) {
    if (byte === 0) nul += 1;
    else if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) controls += 1;
  }
  if (nul > 0) return false;
  if (controls / sample.length > 0.02) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample);
    return true;
  } catch {
    return controls / sample.length < 0.005;
  }
}

function sniffText(bytes, mime) {
  let text = '';
  try { text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, Math.min(bytes.length, 32768))); }
  catch { return { kind: 'text', mime: mime || 'text/plain', reason: 'text-bytes' }; }
  const sample = text.replace(/^\ufeff/, '').trimStart();
  if (sample.startsWith('{') || sample.startsWith('[')) {
    try { JSON.parse(new TextDecoder('utf-8', { fatal: false }).decode(bytes)); return { kind: 'json', mime: 'application/json', reason: 'sniff:json' }; }
    catch { /* not valid JSON */ }
  }
  if (/^(<!doctype\s+html|<html\b)/i.test(sample) || /<(head|body|main|article)\b/i.test(sample.slice(0, 4096))) {
    return { kind: 'html', mime: 'text/html', reason: 'sniff:html' };
  }
  return { kind: 'text', mime: mime && kindForMime(mime) === 'text' ? mime : 'text/plain', reason: 'text-bytes' };
}

export function detectResourceType({ bytes, contentType = '', url = '' } = {}) {
  const declaredMime = normalizeMime(contentType);
  const ext = extensionFromUrl(url);
  const magic = magicType(bytes);

  if (magic) {
    if (magic.kind === 'archive' && ['docx','xlsx','pptx'].includes(ext)) {
      const mime = EXTENSION_MIME.get(ext);
      return { kind: 'document', mime, extension: ext, reason: `magic:zip+extension:${ext}`, declaredMime };
    }
    return { ...magic, extension: ext, declaredMime };
  }

  const extensionMime = EXTENSION_MIME.get(ext) || '';
  const extensionKind = kindForMime(extensionMime);
  const declaredKind = kindForMime(declaredMime);

  if (extensionMime && !['text','html','json'].includes(extensionKind)) {
    return { kind: extensionKind, mime: extensionMime, extension: ext, reason: `extension:${ext}`, declaredMime };
  }

  if (declaredMime && declaredKind !== 'binary') {
    if (declaredKind === 'json' || declaredKind === 'html') return { kind: declaredKind, mime: declaredMime, extension: ext, reason: `mime:${declaredMime}`, declaredMime };
    if (looksLikeTextBytes(bytes)) return sniffText(bytes, declaredMime);
    return { kind: 'binary', mime: 'application/octet-stream', extension: ext, reason: `binary-bytes-despite-mime:${declaredMime}`, declaredMime };
  }

  if (looksLikeTextBytes(bytes)) return { ...sniffText(bytes, declaredMime), extension: ext, declaredMime };

  const mime = declaredMime && declaredMime !== 'application/octet-stream' ? declaredMime : (extensionMime || 'application/octet-stream');
  return { kind: kindForMime(mime), mime, extension: ext, reason: declaredMime ? `mime:${declaredMime}` : 'unknown-binary', declaredMime };
}

export function isBinaryResourceKind(kind) {
  return !['text', 'html', 'json'].includes(String(kind || ''));
}

export function defaultExtensionForMime(mime = '') {
  const normalized = normalizeMime(mime);
  for (const [ext, candidate] of EXTENSION_MIME) if (candidate === normalized) return ext;
  if (normalized === 'application/octet-stream') return 'bin';
  return '';
}
