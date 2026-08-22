import { decodeBytes, truncateText, MAX_FETCH_BYTES } from './core/fetch-policy.js';
import { fetchBoundedWithRetry, classifyFetchFailure } from './core/fetch-url.js';
import {
  assessHtmlContent,
  discoverNextPage,
  htmlTitle,
  MAX_PAGINATION_PAGES,
} from './core/html-lite.js';
import { detectResourceType, defaultExtensionForMime, isBinaryResourceKind } from './core/resource-type.js';
import { jsonTextToMarkdown, textToMarkdown } from './core/normalize.js';
import { chatGptShareHtmlToMarkdown } from './core/chatgpt-share.js';
import { resolveSourceUrl } from './core/source-router.js';
import { safeDisplayUrl, validatePublicHttpUrl } from './core/url-safety.js';
import {
  buildBinaryNote,
  buildContextPayload,
  isAllowedAiHost,
  planContextHandoff,
  sanitizeAttachmentName,
} from './core/auto-bridge.js';

const CUSTOM_HOSTS_KEY = 'customAiHosts';
const BROWSER_CONTEXT_KEY = 'authorizedBrowserContext';
const BROWSER_CONTEXT_DENY_KEY = 'browserContextDeniedHosts';
const WORKBUDDY_STATIC_HOST = 'workbuddy-space-static.codebuddy.work';
const CHATGPT_SHARE_HOST = 'chatgpt.com';
const PAGINATION_PAGE_MAX_BYTES = 3 * 1024 * 1024;
const GENERIC_BROWSER_TIMEOUT_MS = 30_000;
const activeJobs = new Map();

class PipelineFailure extends Error {
  constructor(code, stage, message, { status = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PipelineFailure';
    this.code = code;
    this.stage = stage;
    this.status = Number.isInteger(status) ? status : null;
  }
}

function pipelineInfo(error) {
  if (error?.code && error?.stage) {
    return {
      code: String(error.code), stage: String(error.stage),
      status: Number.isInteger(error.status) ? error.status : null,
      message: String(error.message || error),
    };
  }
  const fetchInfo = classifyFetchFailure(error);
  if (fetchInfo.code !== 'FETCH_ERROR') return fetchInfo;
  return { code: 'PIPELINE_ERROR', stage: 'PIPELINE', status: null, message: String(error?.message || error || 'Unknown error') };
}

function stageLabel(stage) {
  const labels = {
    FETCH: '获取失败 / Fetch failed',
    AUTH: '需要登录或授权 / Authentication required',
    TYPE: '类型识别失败 / Content type failed',
    RENDER: '页面正文不可用 / Rendered content unavailable',
    PARSE: '内容解析失败 / Parse failed',
    HANDOFF: '页面交付失败 / Handoff failed',
    PIPELINE: '处理失败 / Processing failed',
  };
  return labels[String(stage || '').toUpperCase()] || labels.PIPELINE;
}

function cancelledFailure() {
  return new PipelineFailure('USER_CANCELLED', 'PIPELINE', 'Cancelled by user / 用户已停止当前 Link2Context 任务');
}

function throwIfCancelled(signal) {
  if (signal?.aborted) throw cancelledFailure();
}

function sleep(ms, signal) {
  throwIfCancelled(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelledFailure());
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

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

function normalizeHost(value) {
  return String(value || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
}

async function browserContextPolicy(input) {
  const url = validatePublicHttpUrl(input);
  const data = await chrome.storage.local.get([BROWSER_CONTEXT_KEY, BROWSER_CONTEXT_DENY_KEY]);
  const deniedHosts = Array.isArray(data[BROWSER_CONTEXT_DENY_KEY])
    ? data[BROWSER_CONTEXT_DENY_KEY].map(normalizeHost).filter(Boolean)
    : [];
  const host = normalizeHost(url.hostname);
  const deniedBy = deniedHosts.find((candidate) => host === candidate || host.endsWith(`.${candidate}`)) || '';
  return {
    enabled: data[BROWSER_CONTEXT_KEY] === true && !deniedBy,
    globallyEnabled: data[BROWSER_CONTEXT_KEY] === true,
    denied: Boolean(deniedBy),
    deniedBy,
    host,
  };
}

function makeProgressReporter(sender, requestedStartedAt = 0) {
  const tabId = sender?.tab?.id;
  const requested = Number(requestedStartedAt);
  const startedAt = Number.isSafeInteger(requested) && requested > 0 ? requested : Date.now();
  const report = (stage, label, detail = '', extra = {}) => {
    if (!Number.isInteger(tabId)) return;
    const payload = {
      type: 'L2C_PROGRESS', stage, label, detail, startedAt,
      state: extra.state || 'running', level: extra.level || '', log: extra.log || label,
      code: extra.code || '', errorStage: extra.errorStage || '',
    };
    try {
      const pending = chrome.tabs.sendMessage(tabId, payload);
      pending?.catch?.(() => {});
    } catch { /* content script may be reloading */ }
  };
  report.startedAt = startedAt;
  report.tabId = tabId;
  return report;
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

function deriveFileName(sourceUrl, disposition, detectedMime) {
  const fromHeader = contentDispositionName(disposition);
  if (fromHeader) return sanitizeAttachmentName(fromHeader);
  let pathName = '';
  try { pathName = decodeURIComponent(new URL(sourceUrl).pathname.split('/').filter(Boolean).pop() || ''); } catch { /* ignore */ }
  if (pathName) {
    const safe = sanitizeAttachmentName(pathName);
    if (/\.[a-z0-9]{1,10}$/i.test(safe)) return safe;
    const ext = defaultExtensionForMime(detectedMime);
    return ext ? sanitizeAttachmentName(`${safe}.${ext}`) : safe;
  }
  const ext = defaultExtensionForMime(detectedMime) || 'bin';
  return `link2context-file.${ext}`;
}

function bytesToBase64(bytes) {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + step, bytes.length)));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(String(base64 || ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function validateWorkBuddyFallbackUrl(input) {
  const url = validatePublicHttpUrl(input);
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== WORKBUDDY_STATIC_HOST) {
    throw new PipelineFailure('FALLBACK_SCOPE_VIOLATION', 'FETCH', 'WorkBuddy browser fallback only allows the official static host / WorkBuddy 浏览器回退仅允许官方静态域名');
  }
  return url;
}

function validateChatGptFallbackUrl(input, shareId) {
  const url = validatePublicHttpUrl(input);
  const expectedPath = `/share/${encodeURIComponent(shareId)}`;
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== CHATGPT_SHARE_HOST || url.pathname !== expectedPath) {
    throw new PipelineFailure('FALLBACK_SCOPE_VIOLATION', 'FETCH', 'ChatGPT browser fallback left the expected public share URL / ChatGPT 浏览器回退离开了预期公开分享地址');
  }
  return url;
}

async function readWorkBuddyViaBackgroundTab(input, { timeoutMs = 30_000, report = () => {}, signal = null, windowId = null } = {}) {
  const target = validateWorkBuddyFallbackUrl(input);
  report('fallback-open', '直接抓取失败，启用浏览器回退 / Opening browser fallback', '正在后台打开 WorkBuddy 官方 JSON，不会抢占当前页面。', { level: 'warn' });
  const createOptions = { url: target.href, active: false };
  if (Number.isInteger(windowId)) createOptions.windowId = windowId;
  const created = await chrome.tabs.create(createOptions);
  const tabId = created?.id;
  if (!Number.isInteger(tabId)) throw new PipelineFailure('FALLBACK_TAB_CREATE_FAILED', 'FETCH', 'Could not create background tab / 无法创建后台标签页');

  try {
    const deadline = Date.now() + timeoutMs;
    let lastReport = 0;
    while (Date.now() < deadline) {
      throwIfCancelled(signal);
      const tab = await chrome.tabs.get(tabId);
      if (tab?.url?.startsWith('http://') || tab?.url?.startsWith('https://')) validateWorkBuddyFallbackUrl(tab.url);
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
        if (!page) throw new PipelineFailure('FALLBACK_EMPTY', 'FETCH', 'Background tab returned no readable page / 后台标签页没有可读取内容');
        validateWorkBuddyFallbackUrl(page.href || target.href);
        const text = String(page.text || '').trim();
        if (!text) throw new PipelineFailure('FALLBACK_EMPTY', 'FETCH', 'Background tab page was empty / 后台标签页内容为空');
        const bytes = new TextEncoder().encode(text);
        if (bytes.byteLength > MAX_FETCH_BYTES) throw new PipelineFailure('RESPONSE_TOO_LARGE', 'FETCH', `Response exceeds ${MAX_FETCH_BYTES} bytes / 响应超过大小上限`);
        report('fallback-extracted', '后台读取成功 / Browser fallback succeeded', `已读取 ${humanBytes(bytes.byteLength)}，准备解析。`);
        return { res: null, bytes, finalUrl: page.href || target.href, contentType: page.contentType || 'application/json', navigationFallback: true };
      }
      if (Date.now() - lastReport >= 2000) {
        lastReport = Date.now();
        const remain = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        report('fallback-wait', '等待后台页面加载 / Waiting for background page', `页面状态：${tab?.status || 'unknown'}；剩余超时窗口约 ${remain}s。`);
      }
      await sleep(180, signal);
    }
    throw new PipelineFailure('FALLBACK_TIMEOUT', 'FETCH', 'Background-tab fallback timed out / 后台标签页读取超时');
  } finally {
    try { await chrome.tabs.remove(tabId); } catch { /* tab may already be gone */ }
  }
}

async function readChatGptViaBackgroundTab(resolved, { timeoutMs = 35_000, report = () => {}, signal = null, windowId = null } = {}) {
  const target = validateChatGptFallbackUrl(resolved.fetchUrl, resolved.shareId);
  report('chatgpt-fallback-open', '启用 ChatGPT 浏览器回退 / Opening ChatGPT browser fallback', '后台打开公开分享页并读取渲染后的原始 HTML。', { level: 'warn' });
  const createOptions = { url: target.href, active: false };
  if (Number.isInteger(windowId)) createOptions.windowId = windowId;
  const created = await chrome.tabs.create(createOptions);
  const tabId = created?.id;
  if (!Number.isInteger(tabId)) throw new PipelineFailure('FALLBACK_TAB_CREATE_FAILED', 'FETCH', 'Could not create ChatGPT background tab / 无法创建 ChatGPT 后台标签页');
  try {
    const deadline = Date.now() + timeoutMs;
    let lastReport = 0;
    while (Date.now() < deadline) {
      throwIfCancelled(signal);
      const tab = await chrome.tabs.get(tabId);
      if (tab?.url?.startsWith('http://') || tab?.url?.startsWith('https://')) validateChatGptFallbackUrl(tab.url, resolved.shareId);
      if (tab?.status === 'complete') {
        report('chatgpt-fallback-extract', 'ChatGPT 分享页已加载 / ChatGPT share page loaded', '正在读取包含对话 hydration 数据的 HTML。');
        const injected = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => ({ href: location.href, html: document.documentElement?.outerHTML || '' }),
        });
        const page = injected?.[0]?.result;
        if (!page) throw new PipelineFailure('FALLBACK_EMPTY', 'FETCH', 'ChatGPT background tab returned no page / ChatGPT 后台标签页没有返回页面');
        validateChatGptFallbackUrl(page.href || target.href, resolved.shareId);
        const html = String(page.html || '');
        if (!html) throw new PipelineFailure('FALLBACK_EMPTY', 'FETCH', 'ChatGPT share page HTML was empty / ChatGPT 分享页 HTML 为空');
        const bytes = new TextEncoder().encode(html);
        if (bytes.byteLength > MAX_FETCH_BYTES) throw new PipelineFailure('RESPONSE_TOO_LARGE', 'FETCH', `Response exceeds ${MAX_FETCH_BYTES} bytes / 响应超过大小上限`);
        report('chatgpt-fallback-extracted', 'ChatGPT 后台读取成功 / ChatGPT fallback succeeded', `已读取 ${humanBytes(bytes.byteLength)}，准备解码对话。`);
        return { res: null, bytes, finalUrl: page.href || target.href, contentType: 'text/html; charset=utf-8', navigationFallback: true };
      }
      if (Date.now() - lastReport >= 2000) {
        lastReport = Date.now();
        const remain = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        report('chatgpt-fallback-wait', '等待 ChatGPT 分享页加载 / Waiting for ChatGPT share page', `页面状态：${tab?.status || 'unknown'}；剩余约 ${remain}s。`);
      }
      await sleep(180, signal);
    }
    throw new PipelineFailure('FALLBACK_TIMEOUT', 'FETCH', 'ChatGPT background-tab fallback timed out / ChatGPT 后台标签页读取超时');
  } finally {
    try { await chrome.tabs.remove(tabId); } catch { /* tab may already be gone */ }
  }
}

function looksLikeAccessGate(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value || value.length > 2400) return false;
  return /(sign in to continue|log in to continue|please log in|please sign in|subscribe to continue|subscription required|access denied|verify you are human|captcha|登录后继续|请登录|订阅后继续|访问被拒绝|验证您是人类)/i.test(value);
}

function isLikelyBinaryDocument(contentType) {
  const mime = String(contentType || '').split(';', 1)[0].trim().toLowerCase();
  if (!mime) return false;
  return !(mime.startsWith('text/') || /(?:json|xml|javascript|html|xhtml|svg)/.test(mime));
}

async function readBinaryInsideAuthorizedTab(tabId, maxBytes = MAX_FETCH_BYTES) {
  const injected = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (limit) => {
      try {
        // This request carries the user's browser credentials. Never allow an
        // HTTP redirect to choose a second origin after that credentialed request
        // has begun; fail closed and let the outer acquisition report the error.
        const response = await fetch(location.href, { credentials: 'include', cache: 'no-store', redirect: 'error' });
        if (!response.ok) return { ok: false, status: response.status, statusText: response.statusText || '' };
        const announced = Number(response.headers.get('content-length') || 0);
        if (Number.isFinite(announced) && announced > limit) return { ok: false, tooLarge: true, announced };
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > limit) return { ok: false, tooLarge: true, announced: buffer.byteLength };
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const step = 0x8000;
        for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + step, bytes.length)));
        return {
          ok: true,
          href: response.url || location.href,
          contentType: response.headers.get('content-type') || document.contentType || '',
          contentDisposition: response.headers.get('content-disposition') || '',
          base64: btoa(binary),
        };
      } catch (error) {
        return { ok: false, error: String(error?.message || error) };
      }
    },
    args: [maxBytes],
  });
  return injected?.[0]?.result || null;
}

async function readViaAuthorizedBrowser(input, {
  timeoutMs = GENERIC_BROWSER_TIMEOUT_MS,
  report = () => {},
  signal = null,
  windowId = null,
  failureStage = 'RENDER',
  reason = 'render',
} = {}) {
  const target = validatePublicHttpUrl(input);
  const expectedOrigin = target.origin;
  const requireExpectedOrigin = (value) => {
    const checked = validatePublicHttpUrl(value);
    if (checked.origin !== expectedOrigin) {
      throw new PipelineFailure(
        'BROWSER_CONTEXT_CROSS_ORIGIN_NAVIGATION',
        failureStage,
        `Authorized browser navigation left ${expectedOrigin} for ${checked.origin}; refusing to reuse browser credentials across origins. / 授权浏览器已从 ${expectedOrigin} 跳转到 ${checked.origin}，已拒绝跨来源继续使用浏览器登录态。`,
      );
    }
    return checked;
  };
  const policy = await browserContextPolicy(target);
  if (policy.denied) {
    throw new PipelineFailure('BROWSER_CONTEXT_DENIED_FOR_SITE', failureStage, `Browser-session fallback is disabled for ${policy.deniedBy}. / 已禁止对 ${policy.deniedBy} 使用浏览器登录态回退。`);
  }
  if (!policy.globallyEnabled) {
    throw new PipelineFailure(
      'BROWSER_CONTEXT_AUTHORIZATION_REQUIRED',
      failureStage,
      'A browser-render/session fallback could continue this task, but it is not authorized yet. Enable “Authorized browser context” once in the Link2Context popup to allow future automatic fallbacks. / 可以继续尝试浏览器渲染或登录态回退，但尚未授权。请在 Link2Context 弹窗中一次性开启“授权浏览器上下文”。',
    );
  }

  report(
    'browser-context-authorized',
    '正在使用你已授权的浏览器上下文 / Using authorized browser context',
    `目标 / Target: ${target.hostname}；原因 / Reason: ${reason}。可能使用当前浏览器 Session / Cookie / JS 渲染；无需再次确认，可随时停止或撤销。`,
    { level: 'warn' },
  );

  const createOptions = { url: target.href, active: false };
  if (Number.isInteger(windowId)) createOptions.windowId = windowId;
  const created = await chrome.tabs.create(createOptions);
  const tabId = created?.id;
  if (!Number.isInteger(tabId)) throw new PipelineFailure('BROWSER_CONTEXT_TAB_CREATE_FAILED', failureStage, 'Could not create authorized background tab / 无法创建授权后台标签页');

  const started = Date.now();
  let lastGateText = '';
  try {
    while (Date.now() - started < timeoutMs) {
      throwIfCancelled(signal);
      const tab = await chrome.tabs.get(tabId);
      if (tab?.url?.startsWith('http://') || tab?.url?.startsWith('https://')) requireExpectedOrigin(tab.url);
      if (tab?.status !== 'complete') {
        await sleep(220, signal);
        continue;
      }

      let injected;
      try {
        injected = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => ({
            href: location.href,
            contentType: document.contentType || '',
            title: document.title || '',
            html: document.documentElement?.outerHTML || '',
            text: document.body?.innerText || document.body?.textContent || '',
          }),
        });
      } catch (error) {
        throw new PipelineFailure('BROWSER_CONTEXT_SCRIPT_FAILED', failureStage, `Could not read rendered page: ${String(error?.message || error)} / 无法读取渲染后的页面`, { cause: error });
      }
      const page = injected?.[0]?.result;
      if (!page) {
        await sleep(300, signal);
        continue;
      }
      const finalUrl = requireExpectedOrigin(page.href || tab.url || target.href);

      if (isLikelyBinaryDocument(page.contentType)) {
        report('browser-context-binary', '浏览器已打开资源，正在读取原文件 / Reading original resource in authorized context', `${page.contentType || 'binary'} · ${finalUrl.hostname}`);
        const raw = await readBinaryInsideAuthorizedTab(tabId, MAX_FETCH_BYTES);
        if (raw?.tooLarge) throw new PipelineFailure('RESPONSE_TOO_LARGE', 'FETCH', `Authorized browser response exceeds ${MAX_FETCH_BYTES} bytes / 授权浏览器响应超过大小上限`);
        if (!raw?.ok) {
          if (raw?.status === 401) throw new PipelineFailure('AUTH_REQUIRED_401', 'AUTH', `HTTP 401 ${raw.statusText || ''} / 即使使用授权浏览器上下文仍需要登录`, { status: 401 });
          if (raw?.status === 403) throw new PipelineFailure('FETCH_BLOCKED_403', 'FETCH', `HTTP 403 ${raw.statusText || ''} / 即使使用授权浏览器上下文仍被服务器拒绝`, { status: 403 });
          throw new PipelineFailure('BROWSER_CONTEXT_BINARY_FETCH_FAILED', 'FETCH', raw?.error || 'Authorized browser could not read original resource / 授权浏览器无法读取原文件');
        }
        const rawUrl = requireExpectedOrigin(raw.href || finalUrl.href);
        const bytes = base64ToBytes(raw.base64);
        report('browser-context-success', '授权浏览器资源读取成功 / Authorized browser resource acquired', `${humanBytes(bytes.byteLength)} · ${raw.contentType || page.contentType || 'binary'}`);
        return {
          res: null,
          bytes,
          finalUrl: rawUrl.href,
          contentType: raw.contentType || page.contentType || 'application/octet-stream',
          contentDisposition: raw.contentDisposition || '',
          authorizedBrowserContext: true,
          browserFallbackReason: reason,
        };
      }

      const html = String(page.html || '');
      const assessment = assessHtmlContent(html);
      lastGateText = String(page.text || '');
      if (!assessment.shellOnly && !looksLikeAccessGate(lastGateText)) {
        const bytes = new TextEncoder().encode(html);
        if (bytes.byteLength > MAX_FETCH_BYTES) throw new PipelineFailure('RESPONSE_TOO_LARGE', 'FETCH', `Rendered page exceeds ${MAX_FETCH_BYTES} bytes / 渲染页面超过大小上限`);
        report('browser-context-success', '浏览器渲染读取成功 / Browser render succeeded', `${assessment.bodyChars.toLocaleString()} chars · ${humanBytes(bytes.byteLength)} · ${finalUrl.hostname}`);
        return {
          res: null,
          bytes,
          finalUrl: finalUrl.href,
          contentType: page.contentType || 'text/html; charset=utf-8',
          authorizedBrowserContext: true,
          browserFallbackReason: reason,
        };
      }

      if (looksLikeAccessGate(lastGateText) && Date.now() - started > 5000) {
        throw new PipelineFailure('BROWSER_CONTEXT_AUTH_INSUFFICIENT', 'AUTH', 'The authorized browser reached a login/paywall/challenge page instead of the requested content. / 授权浏览器仍停在登录、付费墙或验证页面，未取得目标内容。');
      }
      report('browser-context-wait', '等待页面 JavaScript 渲染正文 / Waiting for rendered content', `当前可用正文约 ${assessment.bodyChars} chars；继续等待。`);
      await sleep(450, signal);
    }
    if (looksLikeAccessGate(lastGateText)) {
      throw new PipelineFailure('BROWSER_CONTEXT_AUTH_INSUFFICIENT', 'AUTH', 'Authorized browser context did not pass the site access gate. / 已授权浏览器上下文仍未通过站点访问限制。');
    }
    throw new PipelineFailure('BROWSER_RENDER_CONTENT_MISSING', 'RENDER', 'Browser render completed but useful content still did not appear before timeout. / 浏览器渲染完成，但超时前仍未出现可用正文。');
  } finally {
    try { await chrome.tabs.remove(tabId); } catch { /* tab may already be gone */ }
  }
}

async function fetchResolved(resolved, report, { signal = null, windowId = null } = {}) {
  report('direct-fetch', '正在直接抓取链接 / Direct fetch', '先走扩展后台受限 fetch；仅网络/超时/5xx 会安全重试。');
  try {
    const result = await fetchBoundedWithRetry(resolved.fetchUrl, {
      attempts: 2,
      signal,
      onProgress: ({ stage, detail, level, code }) => {
        if (stage === 'compatibility-retry') report('compatibility-retry', '严格抓取失败，正在兼容重试 / Compatibility retry', detail, { level: level || 'warn', code });
        else if (stage === 'retry') report('direct-retry', '网络失败，正在重试 / Retrying fetch', detail, { level: level || 'warn', code });
      },
    });
    report('direct-ok', '直接抓取成功 / Direct fetch succeeded', `已读取 ${humanBytes(result.bytes?.byteLength)}。`);
    return result;
  } catch (directError) {
    const info = classifyFetchFailure(directError);
    report(`fetch-${info.code.toLowerCase()}`, stageLabel(info.stage), `[${info.code}] ${info.message}`, { level: 'warn', code: info.code, errorStage: info.stage });
    if (info.code === 'USER_CANCELLED') throw directError;
    if (resolved.kind === 'workbuddy' && info.stage !== 'AUTH') return readWorkBuddyViaBackgroundTab(resolved.fetchUrl, { report, signal, windowId });
    if (resolved.kind === 'chatgpt-share' && info.stage !== 'AUTH') return readChatGptViaBackgroundTab(resolved, { report, signal, windowId });
    if (resolved.kind === 'generic' && ['AUTH_REQUIRED_401', 'FETCH_BLOCKED_403'].includes(info.code)) {
      const policy = await browserContextPolicy(resolved.fetchUrl);
      if (policy.enabled) {
        return readViaAuthorizedBrowser(resolved.fetchUrl, {
          report, signal, windowId,
          failureStage: info.stage,
          reason: info.code,
        });
      }
      if (!policy.globallyEnabled) {
        throw new PipelineFailure(
          info.code,
          info.stage,
          `${info.message}. Authorized browser fallback is available but disabled; enable it once in the Link2Context popup if you want Link2Context to try your browser session automatically. / ${info.message}；可在 Link2Context 弹窗中一次性授权浏览器上下文，之后自动尝试登录态回退。`,
          { status: info.status, cause: directError },
        );
      }
    }
    throw directError;
  }
}

async function parseRecognizedConversation(resolved, fetched, sourceUrl, report, { signal = null, windowId = null } = {}) {
  const decoded = decodeBytes(fetched.bytes, fetched.contentType);
  if (resolved.kind === 'workbuddy') {
    try {
      return jsonTextToMarkdown(decoded, sourceUrl.href, 'workbuddy');
    } catch (parseError) {
      if (fetched.navigationFallback) throw new PipelineFailure('PARSE_WORKBUDDY_FAILED', 'PARSE', String(parseError?.message || parseError), { cause: parseError });
      report('workbuddy-parse-fallback', 'WorkBuddy 数据解析失败，改走浏览器回退 / WorkBuddy parse fallback', String(parseError?.message || parseError), { level: 'warn' });
      try {
        const fallback = await readWorkBuddyViaBackgroundTab(resolved.fetchUrl, { report, signal, windowId });
        return jsonTextToMarkdown(decodeBytes(fallback.bytes, fallback.contentType), sourceUrl.href, 'workbuddy');
      } catch (error) {
        if (error?.stage) throw error;
        throw new PipelineFailure('PARSE_WORKBUDDY_FAILED', 'PARSE', String(error?.message || error), { cause: error });
      }
    }
  }
  if (resolved.kind === 'chatgpt-share') {
    try {
      return chatGptShareHtmlToMarkdown(decoded, sourceUrl.href);
    } catch (parseError) {
      if (fetched.navigationFallback) throw new PipelineFailure('PARSE_CHATGPT_SHARE_FAILED', 'PARSE', String(parseError?.message || parseError), { cause: parseError });
      report('chatgpt-parse-fallback', 'ChatGPT 原始页无法解码，改走浏览器回退 / ChatGPT parse fallback', String(parseError?.message || parseError), { level: 'warn' });
      try {
        const fallback = await readChatGptViaBackgroundTab(resolved, { report, signal, windowId });
        return chatGptShareHtmlToMarkdown(decodeBytes(fallback.bytes, fallback.contentType), sourceUrl.href);
      } catch (error) {
        if (error?.stage) throw error;
        throw new PipelineFailure('PARSE_CHATGPT_SHARE_FAILED', 'PARSE', String(error?.message || error), { cause: error });
      }
    }
  }
  throw new PipelineFailure('PARSE_UNSUPPORTED_SOURCE', 'PARSE', 'Unsupported recognized source / 不支持的专用来源');
}

function contextFileName(resolved) {
  if (resolved.kind === 'workbuddy' && resolved.shareCode) return `workbuddy-${sanitizeAttachmentName(resolved.shareCode)}.md`;
  if (resolved.kind === 'chatgpt-share' && resolved.shareId) return `chatgpt-${sanitizeAttachmentName(resolved.shareId)}.md`;
  return 'link2context-context.md';
}

async function ensureRenderedHtml(html, fetched, url, report, { signal = null, windowId = null } = {}) {
  let assessment = assessHtmlContent(html);
  if (!assessment.shellOnly) return { html, fetched, assessment };

  const policy = await browserContextPolicy(url);
  if (!policy.enabled) {
    if (policy.denied) {
      throw new PipelineFailure('CLIENT_RENDER_CONTENT_MISSING', 'RENDER', `HTML fetched successfully, but useful body content is missing (${assessment.bodyChars} chars). Browser-session fallback is disabled for ${policy.deniedBy}. / HTML 已获取但正文为空；该站点已禁止使用浏览器登录态回退。`);
    }
    throw new PipelineFailure(
      'BROWSER_CONTEXT_AUTHORIZATION_REQUIRED',
      'RENDER',
      `HTML fetched successfully, but useful body content is missing (${assessment.bodyChars} chars). A browser-render fallback can continue after one-time authorization in the Link2Context popup. / HTML 已成功获取，但正文近乎为空（${assessment.bodyChars} 字符）；在 Link2Context 弹窗一次性授权浏览器上下文后，可自动继续 Browser Render（浏览器渲染）回退。`,
    );
  }

  const rendered = await readViaAuthorizedBrowser(url, { report, signal, windowId, failureStage: 'RENDER', reason: 'CLIENT_RENDER_CONTENT_MISSING' });
  const renderedType = detectResourceType({ bytes: rendered.bytes, contentType: rendered.contentType, url: rendered.finalUrl || url });
  if (renderedType.kind !== 'html') {
    throw new PipelineFailure('BROWSER_RENDER_TYPE_CHANGED', 'RENDER', `Browser render returned ${renderedType.kind}, not HTML. / 浏览器渲染后资源类型变为 ${renderedType.kind}，不是 HTML。`);
  }
  const renderedHtml = decodeBytes(rendered.bytes, rendered.contentType);
  assessment = assessHtmlContent(renderedHtml);
  if (assessment.shellOnly) throw new PipelineFailure('BROWSER_RENDER_CONTENT_MISSING', 'RENDER', 'Browser render still produced only a shell / 浏览器渲染后仍只有页面壳');
  return { html: renderedHtml, fetched: rendered, assessment };
}

async function fetchPaginationPage(url, report, { signal = null, windowId = null, maxBytes } = {}) {
  try {
    return await fetchBoundedWithRetry(url, { attempts: 2, maxBytes, signal });
  } catch (error) {
    const info = classifyFetchFailure(error);
    if (!['AUTH_REQUIRED_401', 'FETCH_BLOCKED_403'].includes(info.code)) throw error;
    const policy = await browserContextPolicy(url);
    if (!policy.enabled) throw error;
    report('pagination-browser-fallback', '分页直接抓取受限，改用已授权浏览器 / Pagination using authorized browser', `[${info.code}] ${url}`, { level: 'warn', code: info.code });
    return readViaAuthorizedBrowser(url, { report, signal, windowId, failureStage: info.stage, reason: `pagination-${info.code}` });
  }
}

async function htmlPagesToMarkdown(firstHtml, firstFetched, sourceUrl, report, { signal = null, windowId = null } = {}) {
  let prepared = await ensureRenderedHtml(firstHtml, firstFetched, firstFetched.finalUrl || sourceUrl.href, report, { signal, windowId });
  let firstAssessment = prepared.assessment;
  firstHtml = prepared.html;
  firstFetched = prepared.fetched;

  const pages = [{ url: firstFetched.finalUrl || sourceUrl.href, html: firstHtml, text: firstAssessment.readable }];
  const visited = new Set([pages[0].url]);
  let totalBytes = firstFetched.bytes.byteLength;
  let nextInfo = discoverNextPage(firstHtml, pages[0].url);
  let partialReason = '';

  while (nextInfo && pages.length < MAX_PAGINATION_PAGES && totalBytes < MAX_FETCH_BYTES) {
    throwIfCancelled(signal);
    const next = nextInfo.url;
    if (visited.has(next)) {
      partialReason = 'pagination loop prevented / 已阻止分页循环';
      break;
    }
    const remaining = MAX_FETCH_BYTES - totalBytes;
    if (remaining <= 0) break;
    report('pagination-fetch', '检测到下一页，正在继续读取 / Following next page', `第 ${pages.length + 1} 页：${next}；发现依据 / Discovery: ${nextInfo.reason}`);
    try {
      let pageFetched = await fetchPaginationPage(next, report, {
        signal, windowId,
        maxBytes: Math.min(PAGINATION_PAGE_MAX_BYTES, remaining),
      });
      let pageType = detectResourceType({ bytes: pageFetched.bytes, contentType: pageFetched.contentType, url: pageFetched.finalUrl || next });
      if (pageType.kind !== 'html') {
        partialReason = `next page was ${pageType.kind}, not HTML / 下一页不是 HTML（${pageType.kind}）`;
        break;
      }
      let pageHtml = decodeBytes(pageFetched.bytes, pageFetched.contentType);
      const rendered = await ensureRenderedHtml(pageHtml, pageFetched, pageFetched.finalUrl || next, report, { signal, windowId });
      pageFetched = rendered.fetched;
      pageHtml = rendered.html;
      const assessment = rendered.assessment;
      pageType = detectResourceType({ bytes: pageFetched.bytes, contentType: pageFetched.contentType, url: pageFetched.finalUrl || next });
      const finalUrl = pageFetched.finalUrl || next;
      if (visited.has(finalUrl)) {
        partialReason = 'pagination redirect loop prevented / 已阻止分页重定向循环';
        break;
      }
      pages.push({ url: finalUrl, html: pageHtml, text: assessment.readable });
      visited.add(finalUrl);
      totalBytes += pageFetched.bytes.byteLength;
      nextInfo = discoverNextPage(pageHtml, finalUrl);
    } catch (error) {
      const info = pipelineInfo(error);
      if (info.code === 'USER_CANCELLED') throw error;
      partialReason = `[${info.code}] ${info.message}`;
      report('pagination-partial', '后续分页读取失败，保留已获取正文 / Pagination stopped; keeping fetched pages', partialReason, { level: 'warn', code: info.code });
      break;
    }
  }

  if (nextInfo && pages.length >= MAX_PAGINATION_PAGES) partialReason = `pagination capped at ${MAX_PAGINATION_PAGES} pages / 分页最多读取 ${MAX_PAGINATION_PAGES} 页`;
  if (pages.length > 1) report('pagination-ok', '多页正文已合并 / Multi-page article merged', `共 ${pages.length} 页，合计 ${humanBytes(totalBytes)}。`);

  const title = htmlTitle(firstHtml) || 'Web Page';
  const body = pages.length === 1
    ? pages[0].text
    : pages.map((page, index) => `## Page ${index + 1} / 第 ${index + 1} 页\n\n${page.text}`).join('\n\n---\n\n');
  let markdown = textToMarkdown(body, sourceUrl.href, title);
  if (partialReason) markdown += `\n\n> ⚠️ PARTIAL / 部分完成：${partialReason}`;
  return markdown;
}

async function resolveForAi(input, report, { targetHost = '', signal = null, windowId = null } = {}) {
  report('validate', '正在检查链接 / Validating URL', '检查协议、目标地址和安全边界。');
  throwIfCancelled(signal);
  const sourceUrl = validatePublicHttpUrl(input);
  const resolved = resolveSourceUrl(sourceUrl);
  if (resolved.kind === 'workbuddy') {
    report('resolve-workbuddy', '识别为 WorkBuddy 分享链接 / WorkBuddy link detected', '已转换到官方 conversation-data.json 数据地址。');
  } else if (resolved.kind === 'chatgpt-share') {
    report('resolve-chatgpt', '识别为 ChatGPT 分享链接 / ChatGPT share detected', '将解码分享页内部 hydration 数据，只保留用户与 AI 正文。');
  } else {
    report('resolve-generic', '识别为普通链接 / Generic link detected', '将按资源类型自动选择解析、浏览器渲染或原文件附件。');
  }

  const fetched = await fetchResolved(resolved, report, { signal, windowId });
  const { res, bytes, contentType } = fetched;
  const displayUrl = safeDisplayUrl(sourceUrl);
  const resource = resolved.kind === 'generic'
    ? detectResourceType({ bytes, contentType, url: fetched.finalUrl || sourceUrl.href })
    : null;

  if (resource) {
    report('classify-resource', '已识别资源类型 / Resource classified', `类型 / Kind: ${resource.kind}；MIME: ${resource.mime}；依据 / Reason: ${resource.reason}；大小: ${humanBytes(bytes.byteLength)}。`);
  } else {
    report('classify-resource', '已识别专用对话来源 / Conversation source classified', `${resolved.kind}；大小: ${humanBytes(bytes.byteLength)}。`);
  }

  if (resolved.kind === 'generic' && isBinaryResourceKind(resource.kind)) {
    const mime = resource.mime || 'application/octet-stream';
    report('prepare-file', '二进制资源保持原文件 / Preserving binary as attachment', `${resource.kind} 不会被 decode 成文本；将直接交给目标 AI。`);
    const disposition = fetched.contentDisposition || res?.headers?.get?.('content-disposition') || '';
    const fileName = deriveFileName(fetched.finalUrl || sourceUrl.href, disposition, mime);
    report('ready', '原文件附件已准备 / Original attachment ready', `${fileName} · ${mime} · ${humanBytes(bytes.byteLength)}`);
    return {
      ok: true, kind: 'binary', resourceKind: resource.kind, sourceUrl: displayUrl, fileName,
      mime, size: bytes.byteLength, base64: bytesToBase64(bytes),
      note: buildBinaryNote(displayUrl, fileName, mime),
      handoffMode: 'attachment', handoffReason: `resource:${resource.kind}`, targetHost,
      resourceReason: resource.reason,
      usedAuthorizedBrowserContext: Boolean(fetched.authorizedBrowserContext),
    };
  }

  report('normalize', '正在解析并整理内容 / Parsing and normalizing',
    resolved.kind === 'workbuddy' ? '提取 user / assistant 对话并跳过大块图片与工具数据。'
      : resolved.kind === 'chatgpt-share' ? '解码 turbo-stream / mapping，只保留当前对话分支的 user / assistant 正文。'
        : `检测类型：${resource.kind}。`);

  let markdown;
  if (resolved.kind === 'workbuddy' || resolved.kind === 'chatgpt-share') {
    markdown = await parseRecognizedConversation(resolved, fetched, sourceUrl, report, { signal, windowId });
  } else {
    const decoded = decodeBytes(bytes, contentType);
    if (resource.kind === 'json') {
      try { markdown = jsonTextToMarkdown(decoded, sourceUrl.href, 'generic'); }
      catch (error) {
        report('json-partial', 'JSON 解析失败，降级为文本 / JSON parse failed; preserving as text', String(error?.message || error), { level: 'warn' });
        markdown = textToMarkdown(decoded, sourceUrl.href, 'Malformed JSON / 非标准 JSON');
      }
    } else if (resource.kind === 'html') {
      const source = truncateText(decoded);
      markdown = await htmlPagesToMarkdown(source.text, fetched, sourceUrl, report, { signal, windowId });
      if (source.truncated) markdown += '\n\n> ⚠️ Source HTML was truncated by the safety limit. / 原始 HTML 因安全上限被截断。';
    } else {
      const source = truncateText(decoded);
      markdown = textToMarkdown(source.text, sourceUrl.href);
      if (source.truncated) markdown += '\n\n> ⚠️ Source text was truncated by the safety limit. / 原始文本因安全上限被截断。';
    }
  }

  throwIfCancelled(signal);
  report('prepare-output', '正在准备给网页 AI 的内容 / Preparing AI context', `整理后约 ${humanBytes(new TextEncoder().encode(markdown).byteLength)}。`);
  const limited = truncateText(markdown);
  if (limited.truncated) limited.text += '\n\n> ⚠️ Output was truncated by the safety limit. / 输出因安全上限被截断。';
  const payload = buildContextPayload(limited.text, displayUrl);
  const sourceKind = resolved.kind === 'generic' ? resource.kind : resolved.kind;
  const handoff = planContextHandoff({ targetHost, sourceKind, payloadChars: payload.length });
  const modeLabel = handoff.mode === 'attachment' ? 'Markdown 附件 / Markdown attachment' : '输入框文本 / Inline text';
  report('handoff-plan', '已选择交付方式 / Handoff mode selected', `目标 / Target: ${targetHost || 'unknown'}；来源 / Source: ${sourceKind}；大小 / Size: ${payload.length.toLocaleString()} chars；方式 / Mode: ${modeLabel}；原因 / Reason: ${handoff.reason}`);

  if (handoff.mode === 'attachment') {
    const fileName = contextFileName(resolved);
    const encoded = new TextEncoder().encode(limited.text);
    report('ready', '已准备干净 Markdown 附件 / Clean Markdown attachment ready', `${fileName}，${humanBytes(encoded.byteLength)}；目标：${targetHost || 'unknown'}。`);
    return {
      ok: true, kind: 'binary', sourceUrl: displayUrl, fileName, mime: 'text/markdown',
      size: encoded.byteLength, base64: bytesToBase64(encoded),
      note: buildBinaryNote(displayUrl, fileName, 'text/markdown'), convertedFromText: true,
      handoffMode: 'attachment', handoffReason: handoff.reason, targetHost,
      resourceKind: sourceKind,
      usedAuthorizedBrowserContext: Boolean(fetched.authorizedBrowserContext),
    };
  }
  report('ready', '链接读取完成，正在交给网页 AI / Fetch complete; handing off', `最终上下文 ${payload.length.toLocaleString()} 字符；方式：输入框文本。`);
  return {
    ok: true,
    kind: resolved.kind === 'workbuddy' || resolved.kind === 'chatgpt-share' ? resolved.kind : resource.kind,
    resourceKind: sourceKind, sourceUrl: displayUrl, size: bytes.byteLength, payload,
    handoffMode: 'text', handoffReason: handoff.reason, targetHost,
    usedAuthorizedBrowserContext: Boolean(fetched.authorizedBrowserContext),
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

  if (message.type === 'L2C_CANCEL_JOB') {
    (async () => {
      if (!(await senderIsAllowed(sender))) return { ok: false, error: 'Site not enabled / 当前网站未启用' };
      const tabId = sender?.tab?.id;
      if (!Number.isInteger(tabId)) return { ok: false, error: 'No sender tab / 无调用标签页' };
      const job = activeJobs.get(tabId);
      if (!job) return { ok: true, cancelled: false, reason: 'no-active-job' };
      if (Number(message.startedAt) && Number(message.startedAt) !== job.startedAt) return { ok: true, cancelled: false, reason: 'stale-job' };
      job.controller.abort();
      job.report('cancel-requested', '正在停止当前任务 / Stopping current task', '已收到 STOP；网络、分页或后台浏览器读取会尽快中止。', { level: 'warn' });
      return { ok: true, cancelled: true };
    })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'L2C_RESOLVE_URL') {
    const report = makeProgressReporter(sender, message.startedAt);
    const tabId = sender?.tab?.id;
    const controller = new AbortController();
    (async () => {
      // Reject untrusted/stale requests before they can replace or abort a valid
      // job on the same tab. Authorization is a state-mutation gate, not merely
      // an execution gate.
      if (!(await senderIsAllowed(sender))) throw new PipelineFailure('SITE_NOT_ENABLED', 'PIPELINE', 'This site is not enabled for automatic Link2Context access / 当前网站未启用自动 Link2Context');
      if (message.userGesture !== true) throw new PipelineFailure('USER_GESTURE_REQUIRED', 'PIPELINE', 'A real user gesture is required / 必须由真实用户操作触发');

      if (Number.isInteger(tabId)) {
        const previous = activeJobs.get(tabId);
        previous?.controller?.abort?.();
        activeJobs.set(tabId, { controller, startedAt: report.startedAt, report });
      }
      report('start', '开始处理链接 / Starting', 'Link2Context 已接管这条链接。进度面板可随时 STOP。');
      return resolveForAi(message.url, report, {
        targetHost: senderHost(sender),
        signal: controller.signal,
        windowId: sender?.tab?.windowId,
      });
    })()
      .then(sendResponse)
      .catch((error) => {
        const info = pipelineInfo(error);
        report(`error-${info.stage.toLowerCase()}`, stageLabel(info.stage), `[${info.code}] ${info.message}`, {
          state: 'error', code: info.code, errorStage: info.stage,
        });
        sendResponse({
          ok: false,
          error: info.message,
          errorCode: info.code,
          errorStage: info.stage,
          statusCode: info.status,
          browserAuthorizationRequired: info.code === 'BROWSER_CONTEXT_AUTHORIZATION_REQUIRED',
        });
      })
      .finally(() => {
        if (Number.isInteger(tabId) && activeJobs.get(tabId)?.controller === controller) activeJobs.delete(tabId);
      });
    return true;
  }

  return undefined;
});
