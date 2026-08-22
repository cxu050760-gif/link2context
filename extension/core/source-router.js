import { parseWorkBuddyShare, workBuddyDataUrl } from './workbuddy.js';

const CHATGPT_SHARE_HOSTS = new Set(['chatgpt.com', 'www.chatgpt.com']);
const CHATGPT_SHARE_ID_RE = /^[A-Za-z0-9_-]{8,160}$/;

export function parseChatGptShare(url) {
  if (!(url instanceof URL)) url = new URL(url);
  if (!CHATGPT_SHARE_HOSTS.has(url.hostname.toLowerCase())) return null;
  const match = /^\/share\/([^/?#]+)\/?$/.exec(url.pathname);
  if (!match) return null;
  const shareId = decodeURIComponent(match[1]);
  if (!CHATGPT_SHARE_ID_RE.test(shareId)) {
    throw new Error('Invalid ChatGPT share id / ChatGPT 分享 ID 格式无效');
  }
  return shareId;
}

export function chatGptShareUrl(shareId) {
  if (!CHATGPT_SHARE_ID_RE.test(String(shareId || ''))) {
    throw new Error('Invalid ChatGPT share id / ChatGPT 分享 ID 格式无效');
  }
  return new URL(`https://chatgpt.com/share/${encodeURIComponent(shareId)}`);
}

export function resolveSourceUrl(url) {
  if (!(url instanceof URL)) url = new URL(url);

  const workBuddyCode = parseWorkBuddyShare(url);
  if (workBuddyCode) {
    return {
      kind: 'workbuddy',
      provider: 'WorkBuddy',
      shareCode: workBuddyCode,
      sourceUrl: url,
      fetchUrl: workBuddyDataUrl(workBuddyCode),
    };
  }

  const chatGptShareId = parseChatGptShare(url);
  if (chatGptShareId) {
    return {
      kind: 'chatgpt-share',
      provider: 'ChatGPT',
      shareId: chatGptShareId,
      sourceUrl: url,
      fetchUrl: chatGptShareUrl(chatGptShareId),
    };
  }

  return {
    kind: 'generic',
    provider: 'Generic',
    sourceUrl: url,
    fetchUrl: url,
  };
}
