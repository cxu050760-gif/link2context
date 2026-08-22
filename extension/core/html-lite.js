import { textToMarkdown } from './normalize.js';

const DROP_BLOCKS = /<(script|style|noscript|template|svg|canvas|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const COMMENT_RE = /<!--[\s\S]*?-->/g;

export function decodeHtmlEntities(text) {
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    ndash: '–', mdash: '—', hellip: '…', copy: '©', reg: '®', trade: '™',
  };
  return String(text).replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (m, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const raw = entity.slice(hex ? 2 : 1);
      const n = Number.parseInt(raw, hex ? 16 : 10);
      if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return m;
      try { return String.fromCodePoint(n); } catch { return m; }
    }
    return named[entity.toLowerCase()] ?? m;
  });
}

export function htmlToReadableText(html) {
  let text = String(html || '');
  text = text.replace(COMMENT_RE, ' ').replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, ' ').replace(DROP_BLOCKS, ' ');
  text = text
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|main|header|footer|aside|nav|h[1-6]|li|tr|blockquote|pre)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ');
  text = decodeHtmlEntities(text)
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
}

export function htmlTitle(html) {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(String(html || ''));
  return m ? decodeHtmlEntities(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()) : 'Web Page';
}

export function htmlToMarkdown(html, sourceUrl) {
  return textToMarkdown(htmlToReadableText(html), sourceUrl, htmlTitle(html) || 'Web Page');
}
