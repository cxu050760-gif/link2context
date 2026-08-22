import { createContextDocument, renderContextMarkdown, contextStats } from './context-model.js';

const OFFSCREEN_URL = 'offscreen.html';
const PARSE_MESSAGE = 'L2C_PARSE_HTML_V06';
let offscreenCreating = null;

async function offscreenExists() {
  if (typeof chrome?.offscreen?.hasDocument === 'function') {
    try { return await chrome.offscreen.hasDocument(); } catch { /* continue */ }
  }
  if (typeof chrome?.runtime?.getContexts === 'function') {
    try {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
      });
      return Array.isArray(contexts) && contexts.length > 0;
    } catch { /* continue */ }
  }
  return false;
}

async function ensureOffscreen() {
  if (await offscreenExists()) return;
  if (offscreenCreating) return offscreenCreating;
  if (!chrome?.offscreen?.createDocument) throw new Error('Chrome offscreen document API unavailable / Chrome Offscreen API 不可用');
  offscreenCreating = chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['DOM_PARSER'],
    justification: 'Parse fetched HTML with Mozilla Readability and preserve structured context without executing page scripts.',
  }).finally(() => { offscreenCreating = null; });
  return offscreenCreating;
}

function sendParseMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: PARSE_MESSAGE, ...payload }, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (!response?.ok) reject(new Error(response?.error || 'Structured HTML parse failed / 结构化 HTML 解析失败'));
      else resolve(response.result);
    });
  });
}

export async function parseHtmlToContext({
  html,
  sourceUrl,
  page = 1,
  charset = '',
  charsetSource = '',
} = {}) {
  await ensureOffscreen();
  const parsed = await sendParseMessage({ html: String(html || ''), sourceUrl, page });
  return createContextDocument({
    sourceUrl: parsed.sourceUrl || sourceUrl,
    sourceType: 'web',
    title: parsed.title || '',
    author: parsed.author || '',
    publishedAt: parsed.publishedAt || '',
    canonicalUrl: parsed.canonicalUrl || '',
    language: parsed.language || '',
    charset,
    charsetSource,
    blocks: parsed.blocks || [],
    metadata: {
      extractionStrategy: parsed.extraction?.strategy || 'structured-dom',
      readabilityApplied: Boolean(parsed.extraction?.readability),
      sourcePage: Number(page) || 1,
      structuredTruncated: Boolean(parsed.extraction?.truncated),
    },
  });
}

function blockKey(block) {
  if (!block) return '';
  if (block.type === 'image') return block.src ? `image:${block.src}` : '';
  if (block.type === 'link') return block.href ? `link:${block.href}:${block.text || ''}` : '';
  if (block.type === 'paragraph' && String(block.text || '').length >= 48) return `p:${block.text}`;
  if (block.type === 'heading' && String(block.text || '').length >= 16) return `h:${block.level}:${block.text}`;
  return '';
}

export function mergeContextPages(documents, { sourceUrl = '' } = {}) {
  const docs = (Array.isArray(documents) ? documents : []).filter(Boolean);
  if (!docs.length) throw new TypeError('At least one structured context page is required');
  const first = docs[0];
  const seen = new Set();
  const blocks = [];
  for (const doc of docs) {
    for (const block of doc.blocks || []) {
      const key = blockKey(block);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      blocks.push(block);
    }
  }
  const strategies = [...new Set(docs.map((doc) => doc.metadata?.extractionStrategy).filter(Boolean))];
  return createContextDocument({
    sourceUrl: sourceUrl || first.source?.url,
    sourceType: first.source?.type || 'web',
    title: first.metadata?.title || '',
    author: first.metadata?.author || '',
    publishedAt: first.metadata?.publishedAt || '',
    canonicalUrl: first.source?.canonicalUrl || '',
    language: first.metadata?.language || '',
    charset: first.metadata?.charset || '',
    charsetSource: first.metadata?.charsetSource || '',
    blocks,
    metadata: {
      extractionStrategy: strategies.join(' + ') || 'structured-dom',
      pageCount: docs.length,
      readabilityApplied: docs.some((doc) => doc.metadata?.readabilityApplied === true),
      structuredTruncated: docs.some((doc) => doc.metadata?.structuredTruncated === true),
    },
  });
}

function imageScore(block) {
  const src = String(block?.src || '').toLowerCase();
  if (!src) return -Infinity;
  const width = Number(block.width) || 0;
  const height = Number(block.height) || 0;
  if ((width > 0 && width <= 4) || (height > 0 && height <= 4)) return -Infinity;
  if (/(?:tracking|tracker|pixel|spacer|blank\.gif|1x1)/i.test(src)) return -Infinity;
  let score = 0;
  if (width >= 240) score += 4;
  if (height >= 160) score += 4;
  if (width >= 640 || height >= 480) score += 3;
  if (block.caption) score += 5;
  if (block.alt && block.alt.length >= 8) score += 3;
  if (/(?:logo|avatar|emoji|icon|badge|sprite)/i.test(`${src} ${block.alt || ''}`)) score -= 4;
  return score;
}

export function selectContextImages(document, { limit = 8 } = {}) {
  const candidates = (document?.blocks || [])
    .filter((block) => block.type === 'image' && block.src)
    .map((block, index) => ({ block, index, score: imageScore(block) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return candidates.slice(0, Math.max(0, Number(limit) || 0)).map((item, rank) => ({
    ...item.block,
    assetId: item.block.assetId || `web-image-${rank + 1}`,
    relevanceScore: item.score,
  }));
}

export function structuredContextSummary(document) {
  const metadata = document?.metadata || {};
  return {
    ...contextStats(document),
    pageCount: Number(metadata.pageCount) || 1,
    extractionStrategy: metadata.extractionStrategy || '',
    partialReason: String(metadata.partialReason || ''),
    imageAssetsPartial: metadata.imageAssetsPartial === true,
    imageAssetsSelected: Math.max(0, Number(metadata.imageAssetsSelected) || 0),
    imageAssetsAcquired: Math.max(0, Number(metadata.imageAssetsAcquired) || 0),
    structuredTruncated: metadata.structuredTruncated === true,
  };
}

export function renderStructuredContext(document) {
  return renderContextMarkdown(document);
}
