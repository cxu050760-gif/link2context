import { MAX_FETCH_BYTES } from './fetch-policy.js';
import { validatePublicHttpUrl } from './url-safety.js';

const BROWSER_CONTEXT_KEY = 'authorizedBrowserContext';
const BROWSER_CONTEXT_DENY_KEY = 'browserContextDeniedHosts';
export const DEFAULT_RENDER_TIMEOUT_MS = 30_000;
export const MAX_LOAD_MORE_CLICKS = 3;
export const MAX_SCROLL_STEPS = 10;

function normalizeHost(value) {
  return String(value || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
}

async function authorizationFor(url) {
  const target = validatePublicHttpUrl(url);
  const data = await chrome.storage.local.get([BROWSER_CONTEXT_KEY, BROWSER_CONTEXT_DENY_KEY]);
  const denied = Array.isArray(data[BROWSER_CONTEXT_DENY_KEY])
    ? data[BROWSER_CONTEXT_DENY_KEY].map(normalizeHost).filter(Boolean)
    : [];
  const host = normalizeHost(target.hostname);
  const deniedBy = denied.find((item) => host === item || host.endsWith(`.${item}`)) || '';
  return {
    target,
    enabled: data[BROWSER_CONTEXT_KEY] === true && !deniedBy,
    deniedBy,
  };
}

function authorizationError(policy) {
  const error = new Error(policy.deniedBy
    ? `Browser context is disabled for ${policy.deniedBy} / 已禁止该站点使用浏览器上下文`
    : 'Authorized browser context is required for rendered acquisition / 渲染采集需要先授权浏览器上下文');
  error.code = policy.deniedBy ? 'BROWSER_CONTEXT_DENIED_FOR_SITE' : 'BROWSER_CONTEXT_AUTHORIZATION_REQUIRED';
  return error;
}

async function requireAuthorizedLocation(url) {
  const policy = await authorizationFor(url);
  if (!policy.enabled) throw authorizationError(policy);
  return policy.target;
}

function cancelled(signal) {
  if (!signal?.aborted) return;
  const error = new Error('Cancelled by user / 用户已停止当前 Link2Context 任务');
  error.code = 'USER_CANCELLED';
  throw error;
}

function wait(ms, signal) {
  cancelled(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      const error = new Error('Cancelled by user / 用户已停止当前 Link2Context 任务');
      error.code = 'USER_CANCELLED';
      reject(error);
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

function reportSafe(onProgress, payload) {
  try { onProgress?.(payload); } catch { /* progress is advisory */ }
}

async function snapshot(tabId) {
  const injected = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const visible = (el) => {
        if (!(el instanceof Element)) return false;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const text = (el) => String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
      const candidates = [...document.querySelectorAll('article,main,[role="main"]')].filter(visible);
      candidates.sort((a, b) => text(b).length - text(a).length);
      const main = candidates[0] || document.body;
      const bodyText = text(document.body);
      const mainText = text(main);
      const root = document.scrollingElement || document.documentElement;
      return {
        href: location.href,
        title: document.title || '',
        contentType: document.contentType || '',
        mainChars: mainText.length,
        bodyChars: bodyText.length,
        bodyPreview: bodyText.slice(0, 1800),
        scrollHeight: Number(root?.scrollHeight || 0),
        scrollTop: Number(root?.scrollTop || window.scrollY || 0),
        viewportHeight: Number(window.innerHeight || document.documentElement?.clientHeight || 0),
        imageCount: document.images?.length || 0,
        html: document.documentElement?.outerHTML || '',
      };
    },
  });
  return injected?.[0]?.result || null;
}

async function advanceRenderedPage(tabId, { allowLoadMore, allowScroll }) {
  const injected = await chrome.scripting.executeScript({
    target: { tabId },
    func: (canClick, canScroll) => {
      const isVisible = (el) => {
        if (!(el instanceof Element)) return false;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const root = document.scrollingElement || document.documentElement;
      let clicked = false;
      let label = '';
      if (canClick) {
        const scope = document.querySelector('article,main,[role="main"]') || document.body;
        const controls = [...scope.querySelectorAll('button,[role="button"],a')].filter(isVisible);
        const re = /^(?:load\s+more|show\s+more|read\s+more|continue\s+reading|加载更多|查看更多|展开全文|继续阅读|显示更多)$/i;
        const target = controls.find((el) => {
          const value = String(el.innerText || el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
          if (!re.test(value)) return false;
          if (el.tagName === 'A') {
            try {
              const destination = new URL(el.getAttribute('href') || '', location.href);
              if (destination.origin !== location.origin) return false;
            } catch { return false; }
          }
          return true;
        });
        if (target) {
          label = String(target.innerText || target.textContent || target.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
          target.click();
          clicked = true;
        }
      }
      let scrolled = false;
      if (canScroll && root) {
        const before = Number(root.scrollTop || window.scrollY || 0);
        const amount = Math.max(400, Math.floor((window.innerHeight || 800) * 0.85));
        window.scrollBy(0, amount);
        const after = Number(root.scrollTop || window.scrollY || 0);
        scrolled = after > before;
      }
      return { clicked, label, scrolled };
    },
    args: [Boolean(allowLoadMore), Boolean(allowScroll)],
  });
  return injected?.[0]?.result || { clicked: false, scrolled: false, label: '' };
}

function looksLikeGate(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 2600) return false;
  return /(sign in to continue|log in to continue|please log in|please sign in|subscribe to continue|subscription required|access denied|verify you are human|captcha|登录后继续|请登录|订阅后继续|访问被拒绝|验证您是人类)/i.test(text);
}

function stableEnough(previous, current) {
  if (!previous || !current) return false;
  const charsStable = Math.abs(current.mainChars - previous.mainChars) <= 8
    && Math.abs(current.bodyChars - previous.bodyChars) <= 16;
  const heightStable = Math.abs(current.scrollHeight - previous.scrollHeight) <= 4;
  return charsStable && heightStable && current.imageCount === previous.imageCount;
}

export async function acquireRenderedHtml(url, {
  signal = null,
  timeoutMs = DEFAULT_RENDER_TIMEOUT_MS,
  windowId = null,
  onProgress = null,
} = {}) {
  const policy = await authorizationFor(url);
  if (!policy.enabled) throw authorizationError(policy);

  const options = { url: policy.target.href, active: false };
  if (Number.isInteger(windowId)) options.windowId = windowId;
  const created = await chrome.tabs.create(options);
  const tabId = created?.id;
  if (!Number.isInteger(tabId)) throw new Error('Could not create rendered acquisition tab / 无法创建渲染采集标签页');

  const started = Date.now();
  let previous = null;
  let stableCount = 0;
  let scrollSteps = 0;
  let loadMoreClicks = 0;
  try {
    while (Date.now() - started < timeoutMs) {
      cancelled(signal);
      const tab = await chrome.tabs.get(tabId);
      if (tab?.url?.startsWith('http://') || tab?.url?.startsWith('https://')) await requireAuthorizedLocation(tab.url);
      if (tab?.status !== 'complete') {
        await wait(220, signal);
        continue;
      }

      const current = await snapshot(tabId);
      if (!current) {
        await wait(250, signal);
        continue;
      }
      await requireAuthorizedLocation(current.href || tab.url || policy.target.href);
      if (looksLikeGate(current.bodyPreview)) {
        const error = new Error('Rendered page is still an access gate / 渲染页面仍是登录、验证或访问门槛');
        error.code = 'BROWSER_CONTEXT_ACCESS_GATE';
        throw error;
      }
      if (new TextEncoder().encode(current.html).byteLength > MAX_FETCH_BYTES) {
        const error = new Error(`Rendered HTML exceeds ${MAX_FETCH_BYTES} bytes / 渲染 HTML 超过大小上限`);
        error.code = 'RESPONSE_TOO_LARGE';
        throw error;
      }

      stableCount = stableEnough(previous, current) ? stableCount + 1 : 0;
      const bottom = current.scrollTop + current.viewportHeight >= current.scrollHeight - 32;
      reportSafe(onProgress, {
        stage: 'render-state',
        mainChars: current.mainChars,
        bodyChars: current.bodyChars,
        images: current.imageCount,
        stableCount,
        scrollSteps,
        loadMoreClicks,
        bottom,
      });

      if (current.mainChars >= 120 && stableCount >= 2 && (bottom || scrollSteps >= MAX_SCROLL_STEPS)) {
        return {
          html: current.html,
          finalUrl: current.href || policy.target.href,
          contentType: current.contentType || 'text/html; charset=utf-8',
          metrics: {
            mainChars: current.mainChars,
            bodyChars: current.bodyChars,
            images: current.imageCount,
            scrollSteps,
            loadMoreClicks,
            stablePolls: stableCount,
          },
          authorizedBrowserContext: true,
        };
      }

      const action = await advanceRenderedPage(tabId, {
        allowLoadMore: loadMoreClicks < MAX_LOAD_MORE_CLICKS,
        allowScroll: scrollSteps < MAX_SCROLL_STEPS && !bottom,
      });
      if (action.clicked) loadMoreClicks += 1;
      if (action.scrolled) scrollSteps += 1;
      previous = current;
      await wait(action.clicked ? 650 : 380, signal);
    }
    const error = new Error('Rendered acquisition did not reach a stable content state before timeout / 渲染采集在超时前未达到稳定正文状态');
    error.code = 'BROWSER_RENDER_STABILITY_TIMEOUT';
    throw error;
  } finally {
    try { await chrome.tabs.remove(tabId); } catch { /* tab may already be gone */ }
  }
}
