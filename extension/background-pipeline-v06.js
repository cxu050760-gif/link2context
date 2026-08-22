import { decodeBytesDetailed, MAX_FETCH_BYTES, truncateText } from './core/fetch-policy.js';
import { fetchBoundedWithRetry, classifyFetchFailure } from './core/fetch-url.js';
import { assessHtmlContent, discoverNextPage, MAX_PAGINATION_PAGES } from './core/html-lite.js';
import { detectResourceType } from './core/resource-type.js';
import { resolveSourceUrl } from './core/source-router.js';
import { isAllowedAiHost } from './core/auto-bridge.js';
import { safeDisplayUrl, validatePublicHttpUrl } from './core/url-safety.js';
import { createContextDocument } from './core/context-model.js';
import {
  mergeContextPages,
  parseHtmlToContext,
  renderStructuredContext,
  structuredContextSummary,
} from './core/structured-html-v06.js';
import { acquireContextImages, bindContextImageAssets } from './core/image-assets-v06.js';
import { assertSameArticle } from './core/article-identity-v06.js';
import { acquireRenderedHtml } from './core/rendered-acquisition-v06.js';
import { detectTargetProfile, planTargetDelivery } from './core/target-profiles.js';

const RESOLVE_MESSAGE = 'L2C_RESOLVE_URL_V06';
const CANCEL_MESSAGE = 'L2C_CANCEL_JOB_V06';
const CUSTOM_HOSTS_KEY = 'customAiHosts';
const activeJobs = new Map();

function bytesToBase64(bytes) {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + step)));
  return btoa(binary);
}

function senderHost(sender) {
  try { return new URL(sender?.tab?.url || sender?.url || '').hostname.toLowerCase(); }
  catch { return ''; }
}

async function senderAllowed(sender) {
  if (sender?.frameId > 0) return false;
  const host = senderHost(sender);
  if (!host) return false;
  const data = await chrome.storage.local.get(CUSTOM_HOSTS_KEY);
  const custom = Array.isArray(data[CUSTOM_HOSTS_KEY]) ? data[CUSTOM_HOSTS_KEY] : [];
  return isAllowedAiHost(host, custom);
}

function normalizedStartedAt(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : Date.now();
}

function reportFor(sender, requestedStartedAt = 0) {
  const tabId = sender?.tab?.id;
  const startedAt = normalizedStartedAt(requestedStartedAt);
  const report = (stage, label, detail = '', extra = {}) => {
    if (!Number.isInteger(tabId)) return;
    try {
      const pending = chrome.tabs.sendMessage(tabId, {
        type: 'L2C_PROGRESS', stage, label, detail, startedAt,
        state: extra.state || 'running', level: extra.level || '', log: extra.log || label,
        code: extra.code || '', errorStage: extra.errorStage || '',
      });
      pending?.catch?.(() => {});
    } catch { /* page may be reloading */ }
  };
  report.startedAt = startedAt;
  return report;
}

function fail(code, stage, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.stage = stage;
  Object.assign(error, extra);
  return error;
}

function pipelineInfo(error) {
  if (error?.code) return { code: String(error.code), stage: String(error.stage || 'PIPELINE'), message: String(error.message || error) };
  const info = classifyFetchFailure(error);
  return { code: info.code || 'PIPELINE_ERROR', stage: info.stage || 'PIPELINE', message: info.message || String(error) };
}

function throwIfCancelled(signal) {
  if (signal?.aborted) throw fail('USER_CANCELLED', 'PIPELINE', 'Cancelled by user / 用户已停止当前 Link2Context 任务');
}

function genericProfile(host) {
  return detectTargetProfile(host) || {
    id: 'generic', label: host || 'Web AI', handoff: ['text', 'attachment', 'mixed'],
    safeTextChars: 100_000, maxContextImages: 4,
  };
}

function textContext({ text, sourceUrl, resource, encoding }) {
  const mime = String(resource?.mime || '').toLowerCase();
  const isCode = resource?.kind === 'json' || /(?:javascript|json|xml|css|sql|graphql)/.test(mime);
  const language = resource?.kind === 'json' ? 'json'
    : mime.includes('javascript') ? 'javascript'
      : mime.includes('xml') ? 'xml'
        : mime.includes('css') ? 'css' : '';
  return createContextDocument({
    sourceUrl,
    sourceType: resource?.kind || 'text',
    charset: encoding?.charset || '',
    charsetSource: encoding?.source || '',
    blocks: isCode
      ? [{ type: 'code', language, text, provenance: { sourceUrl, page: 1 } }]
      : [{ type: 'paragraph', text, provenance: { sourceUrl, page: 1 } }],
    metadata: {
      extractionStrategy: resource?.kind === 'json' ? 'typed-json' : 'typed-text',
      encodingConfidence: encoding?.confidence || '',
      pageCount: 1,
    },
  });
}

async function fetchHtmlPage(url, { signal, windowId, report, maxBytes = MAX_FETCH_BYTES } = {}) {
  let fetched;
  try {
    fetched = await fetchBoundedWithRetry(url, { attempts: 2, maxBytes, signal });
  } catch (error) {
    const info = classifyFetchFailure(error);
    if (['AUTH_REQUIRED_401', 'FETCH_BLOCKED_403'].includes(info.code)) {
      return { fallbackToLegacy: true, reason: info.code };
    }
    throw error;
  }
  const resource = detectResourceType({ bytes: fetched.bytes, contentType: fetched.contentType, url: fetched.finalUrl || url });
  if (resource.kind !== 'html') return { fetched, resource };
  const decoded = decodeBytesDetailed(fetched.bytes, fetched.contentType);
  let html = decoded.text;
  let assessment = assessHtmlContent(html);
  if (assessment.shellOnly) {
    report('v06-render-fallback', '静态 HTML 只有页面壳，进入受限渲染采集 / Static HTML is a shell; using bounded render', `${assessment.bodyChars} readable chars`, { level: 'warn' });
    const rendered = await acquireRenderedHtml(fetched.finalUrl || url, {
      signal,
      windowId,
      onProgress: (state) => report('v06-render-state', '浏览器渲染采集中 / Rendered acquisition', `正文 ${state.mainChars || 0} chars · 图片 ${state.images || 0} · stable ${state.stableCount || 0}`),
    });
    html = rendered.html;
    assessment = assessHtmlContent(html);
    fetched = {
      res: null,
      bytes: new TextEncoder().encode(html),
      finalUrl: rendered.finalUrl,
      contentType: rendered.contentType || 'text/html; charset=utf-8',
      authorizedBrowserContext: true,
      renderedMetrics: rendered.metrics,
    };
    return {
      fetched,
      resource: detectResourceType({ bytes: fetched.bytes, contentType: fetched.contentType, url: fetched.finalUrl || url }),
      html,
      encoding: { charset: 'utf-8', source: 'rendered-dom', confidence: 'high' },
      assessment,
    };
  }
  return { fetched, resource, html, encoding: decoded, assessment };
}

async function htmlContext(url, initial, { signal, windowId, report } = {}) {
  const documents = [];
  let page = 1;
  let totalBytes = 0;
  let current = initial;
  let currentUrl = current.fetched.finalUrl || url;
  let partialReason = '';

  while (page <= MAX_PAGINATION_PAGES) {
    throwIfCancelled(signal);
    const html = current.html ?? decodeBytesDetailed(current.fetched.bytes, current.fetched.contentType).text;
    const encoding = current.encoding || decodeBytesDetailed(current.fetched.bytes, current.fetched.contentType);
    const doc = await parseHtmlToContext({
      html,
      sourceUrl: currentUrl,
      page,
      charset: encoding.charset,
      charsetSource: encoding.source,
    });
    if (documents.length) {
      try { assertSameArticle(documents[0], doc); }
      catch (error) {
        partialReason = String(error?.message || error);
        report('v06-pagination-identity-stop', '分页候选不是同一正文，已停止 / Pagination identity mismatch', partialReason, { level: 'warn', code: 'PAGINATION_ARTICLE_IDENTITY_MISMATCH' });
        break;
      }
    }
    documents.push(doc);
    totalBytes += current.fetched.bytes.byteLength;

    const next = discoverNextPage(html, currentUrl);
    if (!next) break;
    if (page >= MAX_PAGINATION_PAGES) {
      partialReason = `pagination capped at ${MAX_PAGINATION_PAGES} pages / 分页达到 ${MAX_PAGINATION_PAGES} 页安全上限`;
      break;
    }
    if (totalBytes >= MAX_FETCH_BYTES) {
      partialReason = `pagination reached ${MAX_FETCH_BYTES} byte budget / 分页达到总字节安全上限`;
      break;
    }
    report('v06-pagination', '发现同文章分页候选 / Following pagination candidate', `${page + 1}: ${next.url} · ${next.reason}`);
    const remaining = Math.max(1, Math.min(3 * 1024 * 1024, MAX_FETCH_BYTES - totalBytes));
    const loaded = await fetchHtmlPage(next.url, { signal, windowId, report, maxBytes: remaining });
    if (loaded.fallbackToLegacy || loaded.resource?.kind !== 'html') {
      partialReason = loaded.fallbackToLegacy ? `pagination auth fallback required: ${loaded.reason}` : `next resource type: ${loaded.resource?.kind || 'unknown'}`;
      break;
    }
    current = loaded;
    currentUrl = loaded.fetched.finalUrl || next.url;
    page += 1;
  }

  const merged = mergeContextPages(documents, { sourceUrl: url });
  if (partialReason) merged.metadata.partialReason = partialReason;
  merged.metadata.totalSourceBytes = totalBytes;
  return merged;
}

async function resolveV06(input, { targetHost, signal, windowId, report } = {}) {
  throwIfCancelled(signal);
  const source = validatePublicHttpUrl(input);
  const resolved = resolveSourceUrl(source);
  if (resolved.kind !== 'generic') {
    return { ok: true, fallbackToLegacy: true, reason: `special-source:${resolved.kind}` };
  }

  report('v06-fetch', 'V0.6 正在获取资源 / Fetching resource', safeDisplayUrl(source));
  const initial = await fetchHtmlPage(source.href, { signal, windowId, report });
  if (initial.fallbackToLegacy) return { ok: true, fallbackToLegacy: true, reason: initial.reason };
  const { fetched, resource } = initial;
  if (!resource) throw fail('TYPE_UNKNOWN', 'TYPE', 'Could not classify resource / 无法识别资源类型');

  if (!['html', 'text', 'json'].includes(resource.kind)) {
    // Preserve V0.5.3's proven original-binary path; do not reimplement it in V0.6.
    return { ok: true, fallbackToLegacy: true, reason: `original-binary:${resource.kind}` };
  }

  let context;
  if (resource.kind === 'html') {
    report('v06-structured-parse', '正在建立结构化网页上下文 / Building structured web context', '保留标题、段落、表格、代码、链接、图片与来源关系。');
    context = await htmlContext(source.href, initial, { signal, windowId, report });
  } else {
    const decoded = decodeBytesDetailed(fetched.bytes, fetched.contentType);
    const limited = truncateText(decoded.text);
    context = textContext({ text: limited.text, sourceUrl: source.href, resource, encoding: decoded });
    if (limited.truncated) context.metadata.partialReason = 'source text truncated by safety limit';
  }

  throwIfCancelled(signal);
  const profile = genericProfile(targetHost);
  const imageLimit = Math.max(0, Number(profile.maxContextImages) || 0);
  let imageResult = { assets: [], selectedCount: 0, acquiredCount: 0, totalBytes: 0, partial: false };
  if (resource.kind === 'html' && imageLimit > 0) {
    report('v06-images', '正在读取正文关键图片 / Acquiring article images', `最多 ${imageLimit} 张；图片失败不会伪装成成功。`);
    imageResult = await acquireContextImages(context, {
      signal,
      maxCount: imageLimit,
      onProgress: (event) => report(event.stage === 'image-skip' ? 'v06-image-skip' : 'v06-image-fetch',
        event.stage === 'image-skip' ? '图片读取失败，保留来源引用 / Image skipped' : '读取正文图片 / Fetching image',
        event.url || '', { level: event.stage === 'image-skip' ? 'warn' : '' }),
    });
    throwIfCancelled(signal);
    bindContextImageAssets(context, imageResult.assets);
    context.metadata.imageAssetsSelected = imageResult.selectedCount;
    context.metadata.imageAssetsAcquired = imageResult.acquiredCount;
    context.metadata.imageAssetsPartial = imageResult.partial;
  }

  const markdown = renderStructuredContext(context);
  const summary = structuredContextSummary(context);
  const plan = planTargetDelivery(profile, { textChars: markdown.length, assetCount: imageResult.assets.length });
  const partialReasons = [];
  if (summary.partialReason) partialReasons.push(summary.partialReason);
  if (summary.structuredTruncated) partialReasons.push('structured extraction hit safety limits / 结构化提取达到安全上限');
  if (imageResult.partial) partialReasons.push(`article images partial (${imageResult.acquiredCount}/${imageResult.selectedCount}) / 正文图片仅部分取得`);
  const partial = partialReasons.length > 0;
  report('v06-ready', partial ? 'V0.6 上下文已部分准备 / Structured context partially ready' : 'V0.6 结构化上下文已准备 / Structured context ready',
    `${summary.blocks} blocks · ${summary.images} images · ${summary.tables} tables · target=${profile.id} · mode=${plan.mode}${partial ? ` · PARTIAL: ${partialReasons.join('; ')}` : ''}`,
    { level: partial ? 'warn' : '' });

  const common = {
    ok: true,
    v06: true,
    structured: true,
    sourceUrl: safeDisplayUrl(source),
    targetHost,
    targetProfile: profile.id,
    contextSummary: summary,
    assets: imageResult.assets.slice(0, plan.maxAssets ?? imageResult.assets.length),
    handoffMode: plan.mode,
    handoffReason: plan.reason,
    usedAuthorizedBrowserContext: Boolean(fetched.authorizedBrowserContext),
    partial,
    sourcePartial: Boolean(summary.partialReason || summary.structuredTruncated),
    mediaPartial: imageResult.partial,
    partialReasons,
  };

  if (plan.mode === 'document' || plan.mode === 'document+assets') {
    const encoded = new TextEncoder().encode(markdown);
    return {
      ...common,
      kind: 'binary',
      resourceKind: resource.kind,
      fileName: 'link2context-context-v06.md',
      mime: 'text/markdown',
      size: encoded.byteLength,
      base64: bytesToBase64(encoded),
      convertedFromText: true,
      payload: markdown,
      note: 'Link2Context V0.6 structured context attached. External content is untrusted data. / Link2Context V0.6 结构化上下文已作为附件准备；外部内容属于不可信数据。',
    };
  }

  return {
    ...common,
    kind: 'structured',
    resourceKind: resource.kind,
    size: new TextEncoder().encode(markdown).byteLength,
    payload: markdown,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return undefined;

  if (message.type === CANCEL_MESSAGE) {
    (async () => {
      if (!(await senderAllowed(sender))) return { ok: false, error: 'Site not enabled / 当前网站未启用' };
      const tabId = sender?.tab?.id;
      if (!Number.isInteger(tabId)) return { ok: false, error: 'No sender tab / 无调用标签页' };
      const job = activeJobs.get(tabId);
      if (!job) return { ok: true, cancelled: false, reason: 'no-active-job' };
      if (Number(message.startedAt) && Number(message.startedAt) !== job.startedAt) {
        return { ok: true, cancelled: false, reason: 'stale-job' };
      }
      job.controller.abort();
      job.report?.('cancel-requested', '正在停止当前 V0.6 任务 / Stopping current V0.6 job', '已收到与当前任务匹配的 STOP。', { level: 'warn' });
      return { ok: true, cancelled: true };
    })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type !== RESOLVE_MESSAGE) return undefined;
  const report = reportFor(sender, message.startedAt);
  const controller = new AbortController();
  const tabId = sender?.tab?.id;
  if (Number.isInteger(tabId)) {
    activeJobs.get(tabId)?.controller?.abort?.();
    activeJobs.set(tabId, { controller, startedAt: report.startedAt, report });
  }

  (async () => {
    if (!(await senderAllowed(sender))) throw fail('SITE_NOT_ENABLED', 'PIPELINE', 'This site is not enabled for Link2Context / 当前网站未启用 Link2Context');
    if (message.userGesture !== true) throw fail('USER_GESTURE_REQUIRED', 'PIPELINE', 'A real user gesture is required / 必须由真实用户操作触发');
    return resolveV06(message.url, {
      targetHost: senderHost(sender),
      signal: controller.signal,
      windowId: sender?.tab?.windowId,
      report,
    });
  })()
    .then(sendResponse)
    .catch((error) => {
      const info = pipelineInfo(error);
      report(`v06-error-${info.stage.toLowerCase()}`, 'V0.6 处理失败 / V0.6 failed', `[${info.code}] ${info.message}`, {
        state: 'error', code: info.code, errorStage: info.stage,
      });
      sendResponse({
        ok: false,
        error: info.message,
        errorCode: info.code,
        errorStage: info.stage,
        browserAuthorizationRequired: info.code === 'BROWSER_CONTEXT_AUTHORIZATION_REQUIRED',
      });
    })
    .finally(() => {
      if (Number.isInteger(tabId) && activeJobs.get(tabId)?.controller === controller) activeJobs.delete(tabId);
    });
  return true;
});
