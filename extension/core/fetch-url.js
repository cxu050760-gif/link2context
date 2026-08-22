import { validatePublicHttpUrl, validateRedirect } from './url-safety.js';
import { enforceContentLength, MAX_FETCH_BYTES, MAX_REDIRECTS } from './fetch-policy.js';

export const DEFAULT_TIMEOUT_MS = 25_000;
export const DEFAULT_ATTEMPTS = 2;
export const STRICT_TARGET_ADDRESS_SPACE = 'public';

export class FetchFailure extends Error {
  constructor(code, message, { status = null, stage = 'FETCH', cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'FetchFailure';
    this.code = code;
    this.stage = stage;
    this.status = Number.isInteger(status) ? status : null;
  }
}

function concatChunks(chunks, total) {
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function fetchInit(controller, targetAddressSpace) {
  const init = {
    redirect: 'manual',
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    signal: controller.signal,
  };
  if (targetAddressSpace) init.targetAddressSpace = targetAddressSpace;
  return init;
}

function enforceHttps(url, requireHttps) {
  if (requireHttps && url.protocol !== 'https:') {
    throw new FetchFailure('FETCH_HTTPS_REQUIRED', 'Proxy compatibility fallback is HTTPS-only / 代理兼容回退仅允许 HTTPS');
  }
}

function httpFailure(status, statusText = '') {
  const suffix = String(statusText || '').trim();
  const message = `HTTP ${status}${suffix ? ` ${suffix}` : ''}`;
  if (status === 401) return new FetchFailure('AUTH_REQUIRED_401', `${message} / 需要登录或授权`, { status, stage: 'AUTH' });
  if (status === 403) return new FetchFailure('FETCH_BLOCKED_403', `${message} / 服务器拒绝了扩展抓取`, { status });
  if (status === 404) return new FetchFailure('NOT_FOUND_404', `${message} / 资源不存在`, { status });
  if (status === 429) return new FetchFailure('RATE_LIMITED_429', `${message} / 请求过于频繁`, { status });
  if (status >= 500 && status <= 599) return new FetchFailure('HTTP_5XX', `${message} / 上游服务器错误`, { status });
  return new FetchFailure(`HTTP_${status}`, message, { status });
}

export function classifyFetchFailure(error) {
  if (error?.code && error?.stage) {
    return {
      code: String(error.code), stage: String(error.stage),
      status: Number.isInteger(error.status) ? error.status : null,
      message: String(error.message || error),
    };
  }
  const message = String(error?.message || error || 'Unknown fetch error');
  const http = /HTTP\s+(\d{3})/i.exec(message);
  if (http) {
    const synthetic = httpFailure(Number(http[1]), '');
    return { code: synthetic.code, stage: synthetic.stage, status: synthetic.status, message };
  }
  if (error?.name === 'AbortError' || /timeout|timed out|aborted/i.test(message)) {
    return { code: 'FETCH_TIMEOUT', stage: 'FETCH', status: null, message };
  }
  if (/too many redirects|redirect loop/i.test(message)) return { code: 'REDIRECT_LIMIT', stage: 'FETCH', status: null, message };
  if (/redirect target|unsafe follow|redirect.*blocked/i.test(message)) return { code: 'REDIRECT_BLOCKED', stage: 'FETCH', status: null, message };
  if (/too large|exceeds .*bytes|大小上限|文件过大/i.test(message)) return { code: 'RESPONSE_TOO_LARGE', stage: 'FETCH', status: null, message };
  if (error instanceof TypeError || /network|failed to fetch|dns|connection/i.test(message)) {
    return { code: 'FETCH_NETWORK_ERROR', stage: 'FETCH', status: null, message };
  }
  return { code: 'FETCH_ERROR', stage: 'FETCH', status: null, message };
}

export async function fetchBounded(initialUrl, {
  fetchFn = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = MAX_FETCH_BYTES,
  maxRedirects = MAX_REDIRECTS,
  targetAddressSpace = STRICT_TARGET_ADDRESS_SPACE,
  requireHttps = false,
  signal = null,
} = {}) {
  if (typeof fetchFn !== 'function') throw new FetchFailure('FETCH_UNAVAILABLE', 'Fetch API unavailable / Fetch API 不可用');
  const controller = new AbortController();
  let externallyAborted = Boolean(signal?.aborted);
  const onExternalAbort = () => {
    externallyAborted = true;
    try { controller.abort(signal?.reason); } catch { controller.abort(); }
  };
  if (signal?.aborted) onExternalAbort();
  else signal?.addEventListener?.('abort', onExternalAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = validatePublicHttpUrl(initialUrl);
    enforceHttps(current, requireHttps);
    let res;
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      if (signal?.aborted) onExternalAbort();
      res = await fetchFn(current.href, fetchInit(controller, targetAddressSpace));
      if (res?.type === 'opaqueredirect' && res.status === 0) {
        throw new FetchFailure('REDIRECT_BLOCKED', 'Redirect target is hidden by the browser; refusing unsafe follow / 浏览器隐藏了重定向目标，已安全拒绝');
      }
      if (res.status >= 300 && res.status < 400) {
        if (hop === maxRedirects) throw new FetchFailure('REDIRECT_LIMIT', 'Too many redirects / 重定向次数过多');
        current = validateRedirect(current, res.headers.get('location'));
        enforceHttps(current, requireHttps);
        continue;
      }
      break;
    }
    if (!res?.ok) throw httpFailure(res?.status ?? 0, res?.statusText ?? '');
    try { enforceContentLength(res.headers.get('content-length')); }
    catch (error) { throw new FetchFailure('RESPONSE_TOO_LARGE', String(error?.message || error), { cause: error }); }
    const contentLength = Number(res.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new FetchFailure('RESPONSE_TOO_LARGE', `Response exceeds ${maxBytes} bytes / 响应超过大小上限`);
    }
    const reader = res.body?.getReader?.();
    let bytes;
    if (!reader) {
      bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > maxBytes) throw new FetchFailure('RESPONSE_TOO_LARGE', `Response exceeds ${maxBytes} bytes / 响应超过大小上限`);
    } else {
      const chunks = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          controller.abort();
          throw new FetchFailure('RESPONSE_TOO_LARGE', `Response exceeds ${maxBytes} bytes / 响应超过大小上限`);
        }
        chunks.push(value);
      }
      bytes = concatChunks(chunks, total);
    }
    return {
      res,
      bytes,
      finalUrl: current.href,
      contentType: res.headers.get('content-type') || '',
      compatibilityFallback: targetAddressSpace == null,
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      if (externallyAborted || signal?.aborted) {
        throw new FetchFailure('USER_CANCELLED', 'Cancelled by user / 用户已停止当前 Link2Context 任务', { stage: 'PIPELINE', cause: error });
      }
      throw new FetchFailure('FETCH_TIMEOUT', `Fetch timed out after ${timeoutMs} ms / 抓取超时（${timeoutMs} ms）`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onExternalAbort);
  }
}

function retryableError(error) {
  const info = classifyFetchFailure(error);
  return ['FETCH_TIMEOUT', 'FETCH_NETWORK_ERROR', 'HTTP_5XX'].includes(info.code);
}

function compatibilityEligible(error) {
  const info = classifyFetchFailure(error);
  return info.code === 'FETCH_NETWORK_ERROR';
}

function emitProgress(onProgress, payload) {
  try { onProgress?.(payload); } catch { /* progress reporting must never break fetch */ }
}

function abortableDelay(ms, signal) {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.reject(new FetchFailure('USER_CANCELLED', 'Cancelled by user / 用户已停止当前 Link2Context 任务', { stage: 'PIPELINE' }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new FetchFailure('USER_CANCELLED', 'Cancelled by user / 用户已停止当前 Link2Context 任务', { stage: 'PIPELINE' }));
    };
    signal.addEventListener?.('abort', onAbort, { once: true });
  });
}

async function retrySeries(initialUrl, options, attempts, onProgress) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try { return await fetchBounded(initialUrl, options); }
    catch (error) {
      lastError = error;
      if (i + 1 >= attempts || !retryableError(error)) throw error;
      const info = classifyFetchFailure(error);
      emitProgress(onProgress, {
        stage: 'retry',
        level: 'warn',
        code: info.code,
        detail: `第 ${i + 1} 次直接抓取失败 [${info.code}]：${info.message}；准备第 ${i + 2}/${attempts} 次。`,
      });
      await abortableDelay(250 * (i + 1), options.signal);
    }
  }
  throw lastError;
}

export async function fetchBoundedWithRetry(initialUrl, options = {}) {
  const attempts = Math.max(1, Number(options.attempts ?? DEFAULT_ATTEMPTS));
  const proxyCompatibilityFallback = options.proxyCompatibilityFallback !== false;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const { onProgress: _ignored, ...fetchOptions } = options;

  try {
    return await retrySeries(initialUrl, {
      ...fetchOptions,
      targetAddressSpace: fetchOptions.targetAddressSpace ?? STRICT_TARGET_ADDRESS_SPACE,
    }, attempts, onProgress);
  } catch (strictError) {
    if (!proxyCompatibilityFallback || !compatibilityEligible(strictError)) throw strictError;

    const checked = validatePublicHttpUrl(initialUrl);
    if (checked.protocol !== 'https:') throw strictError;

    const strictInfo = classifyFetchFailure(strictError);
    emitProgress(onProgress, {
      stage: 'compatibility-retry',
      level: 'warn',
      code: strictInfo.code,
      detail: `严格网络模式失败 [${strictInfo.code}]：${strictInfo.message}；正在进行一次 HTTPS 兼容重试。`,
    });

    try {
      return await fetchBounded(checked, {
        ...fetchOptions,
        targetAddressSpace: null,
        requireHttps: true,
      });
    } catch (fallbackError) {
      const fallbackInfo = classifyFetchFailure(fallbackError);
      throw new FetchFailure(
        fallbackInfo.code,
        `${fallbackInfo.message} / 兼容重试失败；严格模式原错误: ${strictInfo.message}`,
        { status: fallbackInfo.status, stage: fallbackInfo.stage, cause: fallbackError },
      );
    }
  }
}
