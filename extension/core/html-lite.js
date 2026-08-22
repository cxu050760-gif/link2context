import { textToMarkdown } from './normalize.js';

const ACTIVE_BLOCKS = /<(script|style|noscript|template|svg|canvas|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const UI_BLOCKS = /<(nav|footer|aside|form|dialog|menu|button|select)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const COMMENT_RE = /<!--[\s\S]*?-->/g;
const UI_WORDS = '(?:nav(?:igation)?|menu|sidebar|footer|toolbar|breadcrumb|language|login|sign[-_ ]?in|sign[-_ ]?up|cookie|modal|popover|drawer|masthead)';
const UI_ATTR_BLOCK = new RegExp(`<([a-z][a-z0-9:-]*)\\b(?=[^>]*(?:id|class)\\s*=\\s*["'][^"']*${UI_WORDS}[^"']*["'])[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, 'gi');
const PAGE_QUERY_KEY = /^(?:page|p|pg|pn|pageno|pageindex)$/i;
const NEXT_LABEL = /(?:^|[\s\[（(>›»→:：_-])(?:下一页|下页|后一页|next(?:\s+page)?|older)(?:$|[\s\]）)<›»→:：.!！?？_-])/i;

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
  const shellOnly = bodyChars === 0
    || (explicitShell && bodyChars < 400)
    || (raw.length > 3000 && bodyChars < 80)
    || (raw.length > 8000 && bodyChars < 220 && ratio < 0.01);
  return { shellOnly, readableChars: readable.length, bodyChars, ratio, title, readable };
}

function attrValue(attrs, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = re.exec(attrs || '');
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}

function asUrl(value) {
  return value instanceof URL ? new URL(value.href) : new URL(String(value));
}

function pageFamily(value) {
  const u = asUrl(value);
  for (const key of [...u.searchParams.keys()]) {
    if (PAGE_QUERY_KEY.test(key)) u.searchParams.delete(key);
  }
  u.hash = '';
  u.pathname = u.pathname
    .replace(/([_-])\d+(?=\.(?:s?html?|php)$)/i, '')
    .replace(/\/page\/\d+\/?$/i, '/')
    .replace(/\/\d+\/?$/i, '/');
  return `${u.origin}${u.pathname}?${[...u.searchParams.entries()].sort().map(([k,v]) => `${k}=${v}`).join('&')}`;
}

function pageNumberFromUrl(value) {
  let u;
  try { u = asUrl(value); } catch { return null; }
  for (const [key, val] of u.searchParams) {
    if (PAGE_QUERY_KEY.test(key) && /^\d{1,4}$/.test(val)) return Number(val);
  }
  for (const re of [/[\/_-](\d{1,4})(?=\.(?:s?html?|php)$)/i, /\/page\/(\d{1,4})\/?$/i, /\/(\d{1,4})\/?$/]) {
    const match = re.exec(u.pathname);
    if (match) return Number(match[1]);
  }
  return null;
}

function safePaginationTarget(currentUrl, href, strongRelNext = false) {
  let current;
  let next;
  try {
    current = asUrl(currentUrl);
    next = new URL(decodeHtmlEntities(String(href || '').trim()), current);
  } catch { return null; }
  if (!['http:', 'https:'].includes(next.protocol) || next.username || next.password) return null;
  next.hash = '';
  current.hash = '';
  if (next.origin !== current.origin || next.href === current.href) return null;
  if (!strongRelNext && pageFamily(next) !== pageFamily(current)) return null;
  return next.href;
}

function markupCurrentPage(source) {
  const current = /<(?:a|span|li|strong|em|b)\b([^>]*(?:aria-current\s*=\s*["']?page|class\s*=\s*["'][^"']*(?:current|active|selected)[^"']*["'])[^>]*)>([\s\S]*?)<\/(?:a|span|li|strong|em|b)\s*>/gi;
  let match;
  while ((match = current.exec(source))) {
    const text = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, ' ').trim());
    if (/^\d{1,4}$/.test(text)) return Number(text);
  }
  return null;
}

function pushCandidate(map, url, score, reason, pageNumber = null) {
  if (!url) return;
  const prior = map.get(url);
  if (!prior || score > prior.score) map.set(url, { url, score, reason, pageNumber });
}

export function discoverNextPage(html, currentUrl) {
  const source = String(html || '');
  const candidates = new Map();

  const linkRe = /<link\b([^>]*)>/gi;
  let match;
  while ((match = linkRe.exec(source))) {
    const attrs = match[1] || '';
    const rel = attrValue(attrs, 'rel');
    if (!/(?:^|\s)next(?:\s|$)/i.test(rel)) continue;
    const target = safePaginationTarget(currentUrl, attrValue(attrs, 'href'), true);
    pushCandidate(candidates, target, 140, 'link-rel-next', pageNumberFromUrl(target));
  }

  const numeric = [];
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  while ((match = anchorRe.exec(source)) && candidates.size < 800) {
    const attrs = match[1] || '';
    const href = attrValue(attrs, 'href');
    if (!href) continue;
    const rel = attrValue(attrs, 'rel');
    const text = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    const aria = decodeHtmlEntities(attrValue(attrs, 'aria-label'));
    const title = decodeHtmlEntities(attrValue(attrs, 'title'));
    const classId = `${attrValue(attrs, 'class')} ${attrValue(attrs, 'id')}`;
    const label = `${text} ${aria} ${title}`.trim();
    const strongRelNext = /(?:^|\s)next(?:\s|$)/i.test(rel);
    const semanticNext = NEXT_LABEL.test(` ${label} `) || /(?:^|[-_\s])(next|pager-next|pagination-next)(?:$|[-_\s])/i.test(classId);
    const target = safePaginationTarget(currentUrl, href, strongRelNext);
    if (!target) continue;
    if (strongRelNext) pushCandidate(candidates, target, 130, 'anchor-rel-next', pageNumberFromUrl(target));
    else if (semanticNext) pushCandidate(candidates, target, 110, 'semantic-next', pageNumberFromUrl(target));

    if (/^\d{1,4}$/.test(text)) {
      const pageNumber = Number(text);
      if (pageNumber > 0) numeric.push({ url: target, pageNumber, family: pageFamily(target) });
    }
  }

  const family = pageFamily(currentUrl);
  const sameFamilyNumeric = numeric.filter((item) => item.family === family);
  const distinctNumbers = [...new Set(sameFamilyNumeric.map((item) => item.pageNumber))].sort((a, b) => a - b);
  let currentPage = pageNumberFromUrl(currentUrl) || markupCurrentPage(source);
  if (!currentPage && distinctNumbers.length >= 3 && distinctNumbers[0] === 2) currentPage = 1;
  if (currentPage && distinctNumbers.length >= 2) {
    const nextNumber = distinctNumbers.find((n) => n === currentPage + 1)
      ?? distinctNumbers.find((n) => n > currentPage);
    const target = sameFamilyNumeric.find((item) => item.pageNumber === nextNumber);
    if (target) pushCandidate(candidates, target.url, 80, 'numeric-pagination', target.pageNumber);
  }

  return [...candidates.values()].sort((a, b) => b.score - a.score || (a.pageNumber || Infinity) - (b.pageNumber || Infinity))[0] || null;
}

export function extractNextPageUrl(html, currentUrl) {
  return discoverNextPage(html, currentUrl)?.url || null;
}

export function htmlToMarkdown(html, sourceUrl) {
  return textToMarkdown(htmlToReadableText(html), sourceUrl, htmlTitle(html) || 'Web Page');
}
