import { decodeBytes, sniffTextKind, truncateText } from './core/fetch-policy.js';
import { fetchBoundedWithRetry } from './core/fetch-url.js';
import { htmlToMarkdown } from './core/html-lite.js';
import { jsonTextToMarkdown, textToMarkdown } from './core/normalize.js';
import { resolveSpecialUrl } from './core/workbuddy.js';
import { safeDisplayUrl, validatePublicHttpUrl } from './core/url-safety.js';
import {
  buildBinaryNote,
  buildContextPayload,
  MAX_EDITOR_PAYLOAD_CHARS,
  isAllowedAiHost,
  sanitizeAttachmentName,
} from './core/auto-bridge.js';

const CUSTOM_HOSTS_KEY = 'customAiHosts';

async function customHosts() {
  const data = await chrome.storage.local.get(CUSTOM_HOSTS_KEY);
  return Array.isArray(data[CUSTOM_HOSTS_KEY]) ? data[CUSTOM_HOSTS_KEY] : [];
}

function senderHost(sender) {
  try { return new URL(sender?.tab?.url || sender?.url || '').hostname.toLowerCase(); }
  catch { return ''; }
}

async function senderIsAllowed(sender) {
  const host = senderHost(sender);
  if (!host || sender?.frameId > 0) return false;
  return isAllowedAiHost(host, await customHosts());
}

function contentDispositionName(value) {
  if (!value) return '';
  const utf = /filename\*=UTF-8''([^;]+)/i.exec(value);
  if (utf) {
    try { return decodeURIComponent(utf[1].trim().replace(/^"|"$/g, '')); } catch { /* ignore */ }
  }
  const plain = /filename\s*=\s*(?:"([^"]+)"|([^;]+))/i.exec(value);
  return (plain?.[1] || plain?.[2] || '').trim();
}

function deriveFileName(sourceUrl, disposition, contentType) {
  const fromHeader = contentDispositionName(disposition);
  if (fromHeader) return sanitizeAttachmentName(fromHeader);
  let pathName = '';
  try { pathName = decodeURIComponent(new URL(sourceUrl).pathname.split('/').filter(Boolean).pop() || ''); } catch { /* ignore */ }
  if (pathName) return sanitizeAttachmentName(pathName);
  const ext = contentType.includes('pdf') ? '.pdf'
    : contentType.startsWith('image/') ? `.${contentType.split('/')[1].split(/[;+]/)[0] || 'img'}`
      : '.bin';
  return `link2context-file${ext}`;
}

function bytesToBase64(bytes) {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + step, bytes.length)));
  }
  return btoa(binary);
}

async function resolveForAi(input) {
  const sourceUrl = validatePublicHttpUrl(input);
  const resolved = resolveSpecialUrl(sourceUrl);
  const { res, bytes, contentType } = await fetchBoundedWithRetry(resolved.fetchUrl, { attempts: 2 });
  const displayUrl = safeDisplayUrl(sourceUrl);
  const decoded = decodeBytes(bytes, contentType);
  const kind = resolved.kind === 'workbuddy' ? 'json' : sniffTextKind(contentType, decoded);

  if (kind === 'binary') {
    const fileName = deriveFileName(sourceUrl.href, res.headers.get('content-disposition'), contentType);
    return {
      ok: true,
      kind: 'binary',
      sourceUrl: displayUrl,
      fileName,
      mime: contentType.split(';', 1)[0] || 'application/octet-stream',
      size: bytes.byteLength,
      base64: bytesToBase64(bytes),
      note: buildBinaryNote(displayUrl, fileName, contentType.split(';', 1)[0]),
    };
  }

  let markdown;
  if (resolved.kind === 'workbuddy') {
    markdown = jsonTextToMarkdown(decoded, sourceUrl.href, 'workbuddy');
  } else if (kind === 'json') {
    try { markdown = jsonTextToMarkdown(decoded, sourceUrl.href, 'generic'); }
    catch { markdown = textToMarkdown(decoded, sourceUrl.href, 'Malformed JSON / 非标准 JSON'); }
  } else if (kind === 'html') {
    const input = truncateText(decoded);
    markdown = htmlToMarkdown(input.text, sourceUrl.href);
    if (input.truncated) markdown += '\n\n> ⚠️ Source HTML was truncated by the safety limit. / 原始 HTML 因安全上限被截断。';
  } else {
    const input = truncateText(decoded);
    markdown = textToMarkdown(input.text, sourceUrl.href);
    if (input.truncated) markdown += '\n\n> ⚠️ Source text was truncated by the safety limit. / 原始文本因安全上限被截断。';
  }

  const limited = truncateText(markdown);
  if (limited.truncated) limited.text += '\n\n> ⚠️ Output was truncated by the safety limit. / 输出因安全上限被截断。';
  const payload = buildContextPayload(limited.text, displayUrl);
  if (payload.length > MAX_EDITOR_PAYLOAD_CHARS) {
    const fileName = resolved.kind === 'workbuddy' && resolved.shareCode
      ? `workbuddy-${sanitizeAttachmentName(resolved.shareCode)}.md`
      : 'link2context-context.md';
    const encoded = new TextEncoder().encode(limited.text);
    return {
      ok: true, kind: 'binary', sourceUrl: displayUrl, fileName, mime: 'text/markdown',
      size: encoded.byteLength, base64: bytesToBase64(encoded),
      note: buildBinaryNote(displayUrl, fileName, 'text/markdown'),
      convertedFromText: true,
    };
  }
  return {
    ok: true,
    kind: resolved.kind === 'workbuddy' ? 'workbuddy' : kind,
    sourceUrl: displayUrl,
    size: bytes.byteLength,
    payload,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return undefined;

  if (message.type === 'L2C_SITE_STATUS') {
    senderIsAllowed(sender)
      .then((enabled) => sendResponse({ ok: true, enabled, host: senderHost(sender) }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'L2C_RESOLVE_URL') {
    (async () => {
      if (!(await senderIsAllowed(sender))) {
        throw new Error('This site is not enabled for automatic Link2Context access / 当前网站未启用自动 Link2Context');
      }
      if (message.userGesture !== true) {
        throw new Error('A real user gesture is required / 必须由真实用户操作触发');
      }
      return resolveForAi(message.url);
    })()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  return undefined;
});
