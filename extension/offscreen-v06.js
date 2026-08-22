const PARSE_MESSAGE = 'L2C_PARSE_HTML_V06';
const MAX_BLOCKS = 3000;
const MAX_IMAGES = 120;

function cleanText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\t\f\v ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function safeHttpUrl(value, baseUrl = '') {
  const raw = String(value || '').trim();
  if (!raw || /^data:/i.test(raw) || /^blob:/i.test(raw) || /^javascript:/i.test(raw)) return '';
  try {
    const url = new URL(raw, baseUrl || undefined);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function parseSrcset(value, baseUrl) {
  const candidates = String(value || '').split(',').map((item) => {
    const parts = item.trim().split(/\s+/);
    const url = safeHttpUrl(parts[0], baseUrl);
    const descriptor = parts[1] || '';
    let weight = 1;
    if (/^[\d.]+w$/.test(descriptor)) weight = Number.parseFloat(descriptor);
    else if (/^[\d.]+x$/.test(descriptor)) weight = Number.parseFloat(descriptor) * 1000;
    return { url, weight: Number.isFinite(weight) ? weight : 1 };
  }).filter((item) => item.url);
  candidates.sort((a, b) => b.weight - a.weight);
  return candidates[0]?.url || '';
}

function imageUrl(img, baseUrl) {
  const attrs = ['src', 'data-src', 'data-original', 'data-lazy-src', 'data-url'];
  const current = safeHttpUrl(img.currentSrc, baseUrl);
  if (current) return current;
  const srcset = parseSrcset(img.getAttribute('srcset') || img.getAttribute('data-srcset'), baseUrl);
  if (srcset) return srcset;
  for (const name of attrs) {
    const url = safeHttpUrl(img.getAttribute(name), baseUrl);
    if (url) return url;
  }
  return '';
}

function metaContent(doc, selectors) {
  for (const selector of selectors) {
    const value = doc.querySelector(selector)?.getAttribute('content');
    if (value && cleanText(value)) return cleanText(value);
  }
  return '';
}

function publishedTime(doc) {
  return metaContent(doc, [
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[name="date"]',
    'meta[name="pubdate"]',
    'meta[itemprop="datePublished"]',
  ]) || cleanText(doc.querySelector('time[datetime]')?.getAttribute('datetime'));
}

function canonicalUrl(doc, baseUrl) {
  return safeHttpUrl(doc.querySelector('link[rel="canonical"]')?.getAttribute('href'), baseUrl);
}

function language(doc) {
  return cleanText(doc.documentElement?.getAttribute('lang')).slice(0, 40);
}

function classLanguage(node) {
  const raw = `${node.getAttribute('class') || ''} ${node.querySelector('code')?.getAttribute('class') || ''}`;
  const match = /(?:language|lang)-([a-z0-9_+.#-]{1,40})/i.exec(raw);
  return match?.[1] || '';
}

function directListItems(node) {
  return [...node.children]
    .filter((child) => child.tagName === 'LI')
    .map((child) => cleanText(child.innerText || child.textContent))
    .filter(Boolean);
}

function tableBlock(node, sourceUrl, page) {
  const rows = [...node.querySelectorAll('tr')];
  if (!rows.length) return null;
  const matrix = rows.map((row) => [...row.querySelectorAll(':scope > th, :scope > td')]
    .map((cell) => cleanText(cell.innerText || cell.textContent)));
  if (!matrix.some((row) => row.some(Boolean))) return null;
  const firstHasTh = Boolean(rows[0]?.querySelector(':scope > th'));
  const headers = firstHasTh ? matrix.shift() : [];
  return {
    type: 'table',
    caption: cleanText(node.querySelector('caption')?.innerText || node.querySelector('caption')?.textContent),
    headers,
    rows: matrix,
    provenance: { sourceUrl, page },
  };
}

function inlineLinks(node, baseUrl) {
  const links = [];
  for (const anchor of node.querySelectorAll('a[href]')) {
    const href = safeHttpUrl(anchor.getAttribute('href'), baseUrl);
    const label = cleanText(anchor.innerText || anchor.textContent);
    if (!href || !label) continue;
    links.push({ text: label.slice(0, 500), href });
    if (links.length >= 80) break;
  }
  return links;
}

function imageBlock(img, sourceUrl, baseUrl, page, caption = '') {
  const src = imageUrl(img, baseUrl);
  if (!src) return null;
  const width = Number(img.naturalWidth || img.getAttribute('width') || 0) || null;
  const height = Number(img.naturalHeight || img.getAttribute('height') || 0) || null;
  return {
    type: 'image',
    src,
    alt: cleanText(img.getAttribute('alt')).slice(0, 1000),
    caption: cleanText(caption).slice(0, 2000),
    width,
    height,
    provenance: { sourceUrl, page },
  };
}

function structuredWalk(root, { sourceUrl, baseUrl, page }) {
  const blocks = [];
  const seenImages = new Set();
  const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'NAV', 'FOOTER', 'ASIDE', 'FORM', 'BUTTON', 'SELECT', 'OPTION']);

  const push = (block) => {
    if (!block || blocks.length >= MAX_BLOCKS) return;
    if (block.type === 'image') {
      if (!block.src || seenImages.has(block.src) || seenImages.size >= MAX_IMAGES) return;
      seenImages.add(block.src);
    }
    blocks.push(block);
  };

  const visit = (node) => {
    if (!(node instanceof Element) || blocks.length >= MAX_BLOCKS || skip.has(node.tagName)) return;
    const tag = node.tagName;
    const provenance = { sourceUrl, page };

    if (/^H[1-6]$/.test(tag)) {
      const value = cleanText(node.innerText || node.textContent);
      if (value) push({ type: 'heading', level: Number(tag.slice(1)), text: value, links: inlineLinks(node, baseUrl), provenance });
      return;
    }
    if (tag === 'P') {
      const value = cleanText(node.innerText || node.textContent);
      if (value) push({ type: 'paragraph', text: value, links: inlineLinks(node, baseUrl), provenance });
      return;
    }
    if (tag === 'BLOCKQUOTE') {
      const value = cleanText(node.innerText || node.textContent);
      if (value) push({ type: 'blockquote', text: value, links: inlineLinks(node, baseUrl), provenance });
      return;
    }
    if (tag === 'PRE') {
      const value = String(node.innerText || node.textContent || '').replace(/\r\n?/g, '\n').trimEnd();
      if (value) push({ type: 'code', language: classLanguage(node), text: value, provenance });
      return;
    }
    if (tag === 'TABLE') {
      push(tableBlock(node, sourceUrl, page));
      return;
    }
    if (tag === 'UL' || tag === 'OL') {
      const items = directListItems(node);
      if (items.length) push({ type: 'list', ordered: tag === 'OL', items, provenance });
      return;
    }
    if (tag === 'FIGURE') {
      const caption = cleanText(node.querySelector('figcaption')?.innerText || node.querySelector('figcaption')?.textContent);
      for (const img of node.querySelectorAll('img')) push(imageBlock(img, sourceUrl, baseUrl, page, caption));
      if (caption && !node.querySelector('img')) push({ type: 'paragraph', text: caption, provenance });
      return;
    }
    if (tag === 'IMG') {
      push(imageBlock(node, sourceUrl, baseUrl, page, ''));
      return;
    }
    if (tag === 'HR') {
      push({ type: 'separator', provenance });
      return;
    }

    for (const child of node.children) visit(child);
  };

  visit(root);
  if (!blocks.length) {
    const fallback = cleanText(root.innerText || root.textContent);
    if (fallback) push({ type: 'paragraph', text: fallback, provenance: { sourceUrl, page } });
  }
  return blocks;
}

function chooseSemanticRoot(doc) {
  const candidates = [...doc.querySelectorAll('article, main, [role="main"]')];
  candidates.sort((a, b) => cleanText(b.innerText || b.textContent).length - cleanText(a.innerText || a.textContent).length);
  return candidates[0] || doc.body || doc.documentElement;
}

function parseWithReadability(sourceDoc, sourceUrl) {
  if (typeof globalThis.Readability !== 'function') return null;
  try {
    const clone = sourceDoc.cloneNode(true);
    const parsed = new globalThis.Readability(clone, {
      keepClasses: false,
      charThreshold: 120,
    }).parse();
    if (!parsed?.content) return null;
    const articleDoc = new DOMParser().parseFromString(`<!doctype html><html><body>${parsed.content}</body></html>`, 'text/html');
    return { parsed, articleDoc };
  } catch {
    return null;
  }
}

function parseHtml(html, sourceUrl, page = 1) {
  const baseUrl = safeHttpUrl(sourceUrl);
  if (!baseUrl) throw new Error('Invalid source URL for structured parsing');
  const sourceDoc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  if (!sourceDoc?.documentElement) throw new Error('DOMParser returned no document');

  const readability = parseWithReadability(sourceDoc, baseUrl);
  const workingDoc = readability?.articleDoc || sourceDoc;
  const root = readability ? workingDoc.body : chooseSemanticRoot(workingDoc);
  const blocks = structuredWalk(root, { sourceUrl: baseUrl, baseUrl, page });
  const title = cleanText(readability?.parsed?.title || sourceDoc.title || sourceDoc.querySelector('h1')?.textContent);
  const author = cleanText(readability?.parsed?.byline || metaContent(sourceDoc, ['meta[name="author"]', 'meta[property="article:author"]']));

  return {
    sourceUrl: baseUrl,
    canonicalUrl: canonicalUrl(sourceDoc, baseUrl),
    title,
    author,
    publishedAt: publishedTime(sourceDoc),
    language: language(sourceDoc),
    blocks,
    extraction: {
      strategy: readability ? 'mozilla-readability+structured-dom' : 'semantic-dom-fallback',
      readability: Boolean(readability),
      blockCount: blocks.length,
      imageCount: blocks.filter((block) => block.type === 'image').length,
    },
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object' || message.type !== PARSE_MESSAGE) return undefined;
  Promise.resolve()
    .then(() => parseHtml(message.html, message.sourceUrl, Number(message.page) || 1))
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});
