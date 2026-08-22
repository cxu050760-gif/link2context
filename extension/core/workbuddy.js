const SHARE_HOSTS = new Set(['workbuddy.link', 'www.workbuddy.link']);
const STATIC_HOST = 'workbuddy-space-static.codebuddy.work';
const SHARE_CODE_RE = /^[A-Za-z0-9_-]{6,128}$/;

export function parseWorkBuddyShare(url) {
  if (!SHARE_HOSTS.has(url.hostname.toLowerCase())) return null;
  const m = /^\/p\/([^/?#]+)/.exec(url.pathname);
  if (!m) return null;
  const shareCode = decodeURIComponent(m[1]);
  if (!SHARE_CODE_RE.test(shareCode)) {
    throw new Error('Invalid WorkBuddy share code / WorkBuddy 分享码格式无效');
  }
  return shareCode;
}

export function workBuddyDataUrl(shareCode) {
  if (!SHARE_CODE_RE.test(shareCode)) {
    throw new Error('Invalid WorkBuddy share code / WorkBuddy 分享码格式无效');
  }
  return new URL(`https://${STATIC_HOST}/page/${encodeURIComponent(shareCode)}/0/conversation-data.json`);
}

export function resolveSpecialUrl(url) {
  const shareCode = parseWorkBuddyShare(url);
  if (!shareCode) return { kind: 'generic', fetchUrl: url, sourceUrl: url };
  return {
    kind: 'workbuddy',
    shareCode,
    sourceUrl: url,
    fetchUrl: workBuddyDataUrl(shareCode),
  };
}
