import { textToMarkdown } from './normalize.js';

const ACTIVE_BLOCKS = /<(script|style|noscript|template|svg|canvas|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const UI_BLOCKS = /<(nav|footer|aside|form|dialog|menu|button|select)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const COMMENT_RE = /<!--[\s\S]*?-->/g;
const UI_WORDS = '(?:nav(?:igation)?|menu|sidebar|footer|toolbar|breadcrumb|language|login|sign[-_ ]?in|sign[-_ ]?up|cookie|modal|popover|drawer|masthead)';
const UI_ATTR_BLOCK = new RegExp(`<([a-z][a-z0-9:-]*)\\b(?=[^>]*(?:id|class)\\s*=\\s*["'][^"']*${UI_WORDS}[^"']*["'])[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, 'gi');

export const MAX_PAGINATION_PAGES = 8;

export function decodeHtmlEntities(text) {
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    ndash: '–', mdash: '—', hellip: '…', copy: '©', reg: '®', trade: '™',
    laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›',
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

function stripNoise(html) {
  let source = String(html || '')
    .replace(COMMENT_RE, ' ')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, ' ')
    .replace(ACTIVE_BLOCKS, ' ')
    .replace(UI_BLOCKS, ' ');
  // A couple of bounded passes remove common wrapper containers without becoming a full HTML parser.
  for (let i = 0; i < 2; i += 1) source = source.replace(UI_ATTR_BLOCK, ' ');
  return source;
}

function fragmentToText(fragment) {
  let text = stripNoise(fragment);
  text = text
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|main|header|h[1-6]|li|tr|blockquote|pre|figure|figcaption|details)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(text)
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function bestMainFragment(html) {
  const source = String(html || '');
  const full = fragmentToText(source);
  if (full.length < 200) return source;
  const candidates = [];
  for (const tag of ['article', 'main']) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'gi');
    let match;
    while ((match = re.exec(source)) && candidates.length < 32) {
      const text = fragmentToText(match[1]);
      if (text.length >= 200) candidates.push({ html: match[1], textLength: text.length });
    }
  }
  candidates.sort((a, b) => b.textLength - a.textLength);
  const best = candidates[0];
  if (!best) return source;
  // Prefer a semantic main/article when it contains a meaningful share of the readable page.
  return best.textLength >= Math.min(1200, Math.max(200, full.length * 0.18)) ? best.html : source;
}

export function htmlToReadableText(html) {
  return fragmentToText(bestMainFragment(html));
}

export function htmlTitle(html) {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(String(html || ''));
  return m ? decodeHtmlEntities(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()) : 'Web Page';
}

export function assessHtmlContent(html) {
  const raw = String(html || '');
  const readable = htmlToReadableText(raw);
  const title = htmlTitle(raw);
  const bodyChars = readable.replace(title, '').trim().length;
  const ratio = bodyChars / Math.max(raw.length, 1);
  const explicitShell = /<div\b[^>]*(?:id|class)=["'][^"']*(?:root|app|__next)[^"']*["'][^>]*>\s*<\/div>/i.test(raw)
    || /enable javascript|javascript is required|please turn on javascript/i.test(readable);
  const shellOnly = bodyChars < 80 || (bodyChars < 220 && raw.length > 4000 && ratio < 0.01) || (explicitShell && bodyChars < 400);
  return { shellOnly, readableChars: readable.length, bodyChars, ratio, title, readable };
}

function attrValue(attrs, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = re.exec(attrs || '');
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}

function pageFamily(url) {
  const u = new URL(url.href);
  for (const key of [...u.searchParams.keys()]) {
    if (/^(?:page|p|pg|pn|pageno|pageindex)$/i.test(key)) u.searchParams.delete(key);
  }
  u.hash = '';
  u.pathname = u.pathname
    .replace(/([_-])\d+(?=\.(?:s?html?|php)$)/i, '')
    .replace(/\/page\/\d+\/?$/i, '/')
    .replace(/\/\d+\/?$/i, '/');
  return `${u.origin}${u.pathname}?${[...u.searchParams.entries()].sort().map(([k,v]) => `${k}=${v}`).join('&')}`;
}

function safePaginationTarget(currentUrl, href, strongRelNext = false) {
  let current;
  let next;
  try {
    current = new URL(currentUrl);
    next = new URL(href, current);
  } catch { return null; }
  if (!['http:', 'https:'].includes(next.protocol) || next.username || next.password) return null;
  next.hash = '';
  current.hash = '';
  if (next.origin !== current.origin || next.href === current.href) return null;
  if (!strongRelNext && pageFamily(next) !== pageFamily(current)) return null;
  return next.href;
}

export function extractNextPageUrl(html, currentUrl) {
  const source = String(html || '');
  const links = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let match;
  while ((match = re.exec(source)) && links.length < 500) {
    const attrs = match[1] || '';
    const href = attrValue(attrs, 'href');
    if (!href) continue;
    const rel = attrValue(attrs, 'rel');
    const text = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    const strongRelNext = /(?:^|\s)next(?:\s|$)/i.test(rel);
    const nextText = /^(?:下一页|下页|next(?:\s+page)?|older|›|»|→)$/i.test(text);
    if (!strongRelNext && !nextText) continue;
    const target = safePaginationTarget(currentUrl, href, strongRelNext);
    if (target) links.push({ target, score: strongRelNext ? 100 : 80 });
  }
  links.sort((a, b) => b.score - a.score);
  return links[0]?.target || null;
}

export function htmlToMarkdown(html, sourceUrl) {
  return textToMarkdown(htmlToReadableText(html), sourceUrl, htmlTitle(html) || 'Web Page');
}
