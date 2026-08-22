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

export function decodeBytes(bytes, contentType = '') {
  const match = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType);
  const requested = match?.[1] || 'utf-8';
  try {
    return new TextDecoder(requested, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}
