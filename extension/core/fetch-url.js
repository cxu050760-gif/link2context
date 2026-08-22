import { validatePublicHttpUrl, validateRedirect } from './url-safety.js';
import { enforceContentLength, MAX_FETCH_BYTES, MAX_REDIRECTS } from './fetch-policy.js';

export const DEFAULT_TIMEOUT_MS = 25_000;
export const DEFAULT_ATTEMPTS = 2;

function concatChunks(chunks, total) {
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

export async function fetchBounded(initialUrl, {
  fetchFn = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = MAX_FETCH_BYTES,
  maxRedirects = MAX_REDIRECTS,
} = {}) {
  if (typeof fetchFn !== 'function') throw new Error('Fetch API unavailable / Fetch API 不可用');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = validatePublicHttpUrl(initialUrl);
    let res;
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      res = await fetchFn(current.href, {
        redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: controller.signal,
        targetAddressSpace: 'public',
      });
      if (res?.type === 'opaqueredirect' && res.status === 0) {
        throw new Error('Redirect target is hidden by the browser; refusing unsafe follow / 浏览器隐藏了重定向目标，已安全拒绝');
      }
      if (res.status >= 300 && res.status < 400) {
        if (hop === maxRedirects) throw new Error('Too many redirects / 重定向次数过多');
        current = validateRedirect(current, res.headers.get('location'));
        continue;
      }
      break;
    }
    if (!res?.ok) throw new Error(`HTTP ${res?.status ?? 'unknown'} ${res?.statusText ?? ''}`.trim());
    enforceContentLength(res.headers.get('content-length'));
    const contentLength = Number(res.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error(`Response exceeds ${maxBytes} bytes / 响应超过大小上限`);
    }
    const reader = res.body?.getReader?.();
    let bytes;
    if (!reader) {
      bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > maxBytes) throw new Error(`Response exceeds ${maxBytes} bytes / 响应超过大小上限`);
    } else {
      const chunks = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          controller.abort();
          throw new Error(`Response exceeds ${maxBytes} bytes / 响应超过大小上限`);
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
    };
  } finally {
    clearTimeout(timer);
  }
}

function retryableError(error) {
  const message = String(error?.message || error || '');
  return error?.name === 'AbortError' || /network|failed to fetch|timeout|HTTP 5\d\d/i.test(message);
}

export async function fetchBoundedWithRetry(initialUrl, options = {}) {
  const attempts = Math.max(1, Number(options.attempts ?? DEFAULT_ATTEMPTS));
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try { return await fetchBounded(initialUrl, options); }
    catch (error) {
      lastError = error;
      if (i + 1 >= attempts || !retryableError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (i + 1)));
    }
  }
  throw lastError;
}
