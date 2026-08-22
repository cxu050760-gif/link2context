import { decodeBytes, sniffTextKind, truncateText, MAX_FETCH_BYTES } from './core/fetch-policy.js';
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
const WORKBUDDY_STATIC_HOST = 'workbuddy-space-static.codebuddy.work';

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

function makeProgressReporter(sender) {
  const tabId = sender?.tab?.id;
  const startedAt = Date.now();
  return (stage, label, detail = '', extra = {}) => {
    if (!Number.isInteger(tabId)) return;
    const payload = {
      type: 'L2C_PROGRESS', stage, label, detail, startedAt,
      state: extra.state || 'running', level: extra.level || '', log: extra.log || label,
    };
    try {
      const pending = chrome.tabs.sendMessage(tabId, payload);
      pending?.catch?.(() => {});
    } catch { /* content script may be reloading */ }
  };
}

function humanBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
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

function validateWorkBuddyFallbackUrl(input) {
  const url = validatePublicHttpUrl(input);
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== WORKBUDDY_STATIC_HOST) {
    throw new Error('WorkBuddy browser fallback only allows the official static host / WorkBuddy 浏览器回退仅允许官方静态域名');
  }
  return url;
}

async function readWorkBuddyViaBackgroundTab(input, { timeoutMs = 30_000, report = () => {} } = {}) {
  const target = validateWorkBuddyFallbackUrl(input);
  report('fallback-open', '直接抓取失败，启用浏览器回退 / Opening browser fallback', '正在后台打开 WorkBuddy 官方 JSON，不会抢占当前页面。', { level: 'warn' });
  const created = await chrome.tabs.create({ url: target.href, active: false });
  const tabId = created?.id;
  if (!Number.isInteger(tabId)) throw new Error('Could not create background tab / 无法创建后台标签页');

  try {
    const deadline = Date.now() + timeoutMs;
    let lastReport = 0;
    while (Date.now() < deadline) {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.url?.startsWith('http://') || tab?.url?.startsWith('https://')) {
        validateWorkBuddyFallbackUrl(tab.url);
      }
      if (tab?.status === 'complete') {
        report('fallback-extract', '后台页面已加载，正在提取 JSON / Page loaded; extracting JSON', '浏览器导航成功，正在读取页面文本。');
        const injected = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => ({
            href: location.href,
            contentType: document.contentType || '',
            text: document.body?.textContent || document.documentElement?.textContent || '',
          }),
        });
        const page = injected?.[0]?.result;
        if (!page) throw new Error('Background tab returned no readable page / 后台标签页没有可读取内容');
        validateWorkBuddyFallbackUrl(page.href || target.href);
        const text = String(page.text || '').trim();
        if (!text) throw new Error('Background tab page was empty / 后台标签页内容为空');
        const bytes = new TextEncoder().encode(text);
        if (bytes.byteLength > MAX_FETCH_BYTES) {
          throw new Error(`Response exceeds ${MAX_FETCH_BYTES} bytes / 响应超过大小上限`);
        }
        report('fallback-extracted', '后台读取成功 / Browser fallback succeeded', `已读取 ${humanBytes(bytes.byteLength)}，准备解析。`);
        return {
          res: null,
          bytes,
          finalUrl: page.href || target.href,
          contentType: page.contentType || 'application/json',
          navigationFallback: true,
        };
      }
      if (Date.now() - lastReport >= 2000) {
        lastReport = Date.now();
        const remain = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        report('fallback-wait', '等待后台页面加载 / Waiting for background page', `页面状态：${tab?.status || 'unknown'}；剩余超时窗口约 ${remain}s。`);
      }
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
    throw new Error('Background-tab fallback timed out / 后台标签页读取超时');
  } finally {
    try { await chrome.tabs.remove(tabId); } catch { /* tab may already be gone */ }
  }
}

async function fetchResolved(resolved, report) {
  report('direct-fetch', '正在直接抓取链接 / Direct fetch', '先走扩展后台受限 fetch；网络错误时会自动安全重试。');
  try {
    const result = await fetchBoundedWithRetry(resolved.fetchUrl, {
      attempts: 2,
      onProgress: ({ stage, detail, level }) => {
        if (stage === 'compatibility-retry') {
          report('compatibility-retry', '严格抓取失败，正在兼容重试 / Compatibility retry', detail, { level: level || 'warn' });
        } else if (stage === 'retry') {
          report('direct-retry', '网络失败，正在重试 / Retrying fetch', detail, { level: level || 'warn' });
        }
      },
    });
    report('direct-ok', '直接抓取成功 / Direct fetch succeeded', `已读取 ${humanBytes(result.bytes?.byteLength)}。`);
    return result;
  } catch (directError) {
    const message = String(directError?.message || directError || 'direct fetch failed');
    report('direct-failed', '直接抓取失败 / Direct fetch failed', message, { level: 'warn' });
    if (resolved.kind !== 'workbuddy') throw directError;
    try {
      return await readWorkBuddyViaBackgroundTab(resolved.fetchUrl, { report });
    } catch (fallbackError) {
      const direct = String(directError?.message || directError || 'direct fetch failed');
      const fallback = String(fallbackError?.message || fallbackError || 'background-tab fallback failed');
      throw new Error(`${fallback}；原始 fetch 错误: ${direct}`);
    }
  }
}

async function resolveForAi(input, report) {
  report('validate', '正在检查链接 / Validating URL', '检查协议、目标地址和安全边界。');
  const sourceUrl = validatePublicHttpUrl(input);
  const resolved = resolveSpecialUrl(sourceUrl);
  if (resolved.kind === 'workbuddy') {
    report('resolve-workbuddy', '识别为 WorkBuddy 分享链接 / WorkBuddy link detected', '已转换到官方 conversation-data.json 数据地址。');
  } else {
    report('resolve-generic', '识别为普通链接 / Generic link detected', '将按网页、JSON、文本或文件类型自动处理。');
  }

  const { res, bytes, contentType } = await fetchResolved(resolved, report);
  report('decode', '正在识别内容类型 / Detecting content type', `响应大小 ${humanBytes(bytes.byteLength)}；Content-Type: ${contentType || '未提供 / unknown'}`);
  const displayUrl = safeDisplayUrl(sourceUrl);
  const decoded = decodeBytes(bytes, contentType);
  const kind = resolved.kind === 'workbuddy' ? 'json' : sniffTextKind(contentType, decoded);

  if (kind === 'binary') {
    report('prepare-file', '正在准备附件 / Preparing attachment', '链接返回的是二进制文件，将尝试直接附加到网页 AI。');
    const fileName = deriveFileName(sourceUrl.href, res?.headers?.get?.('content-disposition') || '', contentType);
    report('ready', '链接读取完成，正在交给网页 AI / Fetch complete; handing off', `已准备附件：${fileName}`, { state: 'success' });
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

  report('normalize', '正在解析并整理内容 / Parsing and normalizing', resolved.kind === 'workbuddy' ? '正在提取 user / assistant 对话并跳过大块图片与工具数据。' : `检测类型：${kind}。`);
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

  report('prepare-output', '正在准备给网页 AI 的内容 / Preparing AI context', `整理后约 ${humanBytes(new TextEncoder().encode(markdown).byteLength)}。`);
  const limited = truncateText(markdown);
  if (limited.truncated) limited.text += '\n\n> ⚠️ Output was truncated by the safety limit. / 输出因安全上限被截断。';
  const payload = buildContextPayload(limited.text, displayUrl);
  if (payload.length > MAX_EDITOR_PAYLOAD_CHARS) {
    const fileName = resolved.kind === 'workbuddy' && resolved.shareCode
      ? `workbuddy-${sanitizeAttachmentName(resolved.shareCode)}.md`
      : 'link2context-context.md';
    const encoded = new TextEncoder().encode(limited.text);
    report('ready', '内容较长，已转为 Markdown 附件 / Long content converted to attachment', `${fileName}，${humanBytes(encoded.byteLength)}；正在交给网页 AI。`, { state: 'success' });
    return {
      ok: true, kind: 'binary', sourceUrl: displayUrl, fileName, mime: 'text/markdown',
      size: encoded.byteLength, base64: bytesToBase64(encoded),
      note: buildBinaryNote(displayUrl, fileName, 'text/markdown'),
      convertedFromText: true,
    };
  }
  report('ready', '链接读取完成，正在交给网页 AI / Fetch complete; handing off', `最终上下文 ${payload.length.toLocaleString()} 字符。`, { state: 'success' });
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
    const report = makeProgressReporter(sender);
    report('start', '开始处理链接 / Starting', 'Link2Context 已接管这条链接。');
    (async () => {
      if (!(await senderIsAllowed(sender))) {
        throw new Error('This site is not enabled for automatic Link2Context access / 当前网站未启用自动 Link2Context');
      }
      if (message.userGesture !== true) {
        throw new Error('A real user gesture is required / 必须由真实用户操作触发');
      }
      return resolveForAi(message.url, report);
    })()
      .then(sendResponse)
      .catch((error) => {
        const messageText = String(error?.message || error);
        report('error', '处理失败 / Failed', messageText, { state: 'error' });
        sendResponse({ ok: false, error: messageText });
      });
    return true;
  }

  return undefined;
});
