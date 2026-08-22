export const MAX_FETCH_BYTES = 12 * 1024 * 1024;
export const MAX_TEXT_CHARS = 1_500_000;
export const MAX_REDIRECTS = 5;

export function classifyContentType(contentType = '') {
  const ct = contentType.split(';', 1)[0].trim().toLowerCase();
  if (ct === 'application/pdf') return 'binary';
  if (ct === 'application/json' || ct.endsWith('+json')) return 'json';
  if (ct === 'text/html' || ct === 'application/xhtml+xml') return 'html';
  if (ct.startsWith('text/') || ct === 'application/xml' || ct.endsWith('+xml') || ct === 'application/javascript') return 'text';
  return 'binary';
}

export function sniffTextKind(contentType, text) {
  const declared = classifyContentType(contentType);
  if (declared !== 'binary') return declared;
  const sample = text.slice(0, 2048).trimStart();
  if (sample.startsWith('{') || sample.startsWith('[')) {
    try { JSON.parse(text); return 'json'; } catch { /* fall through */ }
  }
  if (/^(<!doctype\s+html|<html\b)/i.test(sample)) return 'html';
  const nulRatio = (sample.match(/\u0000/g) || []).length / Math.max(sample.length, 1);
  if (sample && nulRatio < 0.01) return 'text';
  return 'binary';
}

export function enforceContentLength(value) {
  if (!value) return;
  const n = Number(value);
  if (Number.isFinite(n) && n > MAX_FETCH_BYTES) {
    throw new Error(`File too large (${n} bytes) / 文件过大（${n} 字节）`);
  }
}

export function truncateText(text, max = MAX_TEXT_CHARS) {
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(0, max), truncated: true };
}

function charsetFromContentType(contentType = '') {
  return /charset\s*=\s*["']?([^;"'\s]+)/i.exec(String(contentType || ''))?.[1]?.trim() || '';
}

function bomCharset(bytes) {
  if (!bytes || bytes.length < 2) return '';
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return '';
}

function asciiProbe(bytes, limit = 16_384) {
  const sample = bytes?.subarray?.(0, Math.min(bytes.length, limit)) || [];
  let out = '';
  for (const byte of sample) out += byte < 0x80 ? String.fromCharCode(byte) : ' ';
  return out;
}

function declaredCharsetInsideDocument(bytes, contentType = '') {
  const mime = String(contentType || '').split(';', 1)[0].trim().toLowerCase();
  if (!(mime.includes('html') || mime.includes('xml') || mime.startsWith('text/') || !mime)) return '';
  const probe = asciiProbe(bytes);
  const html = /<meta\b[^>]*charset\s*=\s*["']?\s*([^\s"'/>;]+)/i.exec(probe)?.[1]
    || /<meta\b[^>]*http-equiv\s*=\s*["']?content-type["']?[^>]*content\s*=\s*["'][^"']*charset\s*=\s*([^\s"';>]+)/i.exec(probe)?.[1]
    || /<meta\b[^>]*content\s*=\s*["'][^"']*charset\s*=\s*([^\s"';>]+)[^"']*["'][^>]*http-equiv\s*=\s*["']?content-type/i.exec(probe)?.[1];
  if (html) return html.trim();
  return /<\?xml\b[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(probe)?.[1]?.trim() || '';
}

function canDecode(bytes, charset) {
  try {
    new TextDecoder(charset, { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function decodeWith(bytes, charset) {
  return new TextDecoder(charset, { fatal: false }).decode(bytes);
}

function normalizeCharsetLabel(label) {
  const value = String(label || '').trim().toLowerCase();
  const aliases = {
    utf8: 'utf-8',
    'utf_8': 'utf-8',
    gb2312: 'gbk',
    'gb-2312': 'gbk',
    cp936: 'gbk',
    ms936: 'gbk',
    sjis: 'shift_jis',
    'shift-jis': 'shift_jis',
    'windows-31j': 'shift_jis',
  };
  return aliases[value] || value;
}

export function detectTextEncoding(bytes, contentType = '') {
  const bom = bomCharset(bytes);
  if (bom) return { charset: bom, source: 'bom', confidence: 'high' };

  const http = normalizeCharsetLabel(charsetFromContentType(contentType));
  if (http) {
    try {
      // Construction validates support without consuming the source bytes.
      new TextDecoder(http);
      return { charset: http, source: 'http-header', confidence: 'high' };
    } catch { /* continue to document declaration */ }
  }

  const inside = normalizeCharsetLabel(declaredCharsetInsideDocument(bytes, contentType));
  if (inside) {
    try {
      new TextDecoder(inside);
      return { charset: inside, source: 'document-declaration', confidence: 'high' };
    } catch { /* continue */ }
  }

  if (canDecode(bytes, 'utf-8')) return { charset: 'utf-8', source: 'utf8-validity', confidence: 'medium' };

  // Do not silently pretend an unknown legacy encoding is UTF-8. Windows-1252
  // is the Encoding Standard's broad single-byte fallback, but confidence stays
  // explicitly low so callers/evidence can surface that the source was guessed.
  return { charset: 'windows-1252', source: 'legacy-fallback', confidence: 'low' };
}

export function decodeBytesDetailed(bytes, contentType = '') {
  const encoding = detectTextEncoding(bytes, contentType);
  try {
    return { text: decodeWith(bytes, encoding.charset), ...encoding };
  } catch {
    return {
      text: decodeWith(bytes, 'utf-8'),
      charset: 'utf-8',
      source: 'decoder-fallback',
      confidence: 'low',
    };
  }
}

export function decodeBytes(bytes, contentType = '') {
  return decodeBytesDetailed(bytes, contentType).text;
}
