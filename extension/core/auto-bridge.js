import { safeDisplayUrl } from './url-safety.js';

const KNOWN_AI_HOST_PATTERNS = [
  'chatgpt.com',
  'claude.ai',
  'gemini.google.com',
  'aistudio.google.com',
  'grok.com',
  'www.perplexity.ai',
  'perplexity.ai',
  'chat.deepseek.com',
  'www.doubao.com',
  'doubao.com',
  'www.kimi.com',
  'kimi.com',
  'chat.qwen.ai',
  'qwen.ai',
  'qianwen.com',
  'qwenwork.cn',
  'tongyi.aliyun.com',
  'poe.com',
  'copilot.microsoft.com',
  'chat.mistral.ai',
  'openrouter.ai',
];

export const INLINE_BINARY_LIMIT = 6 * 1024 * 1024;
export const MAX_EDITOR_PAYLOAD_CHARS = 250_000;
export const CHATGPT_EDITOR_SOFT_LIMIT_CHARS = 24_000;
export const MAX_AUTO_URL_CHARS = 8192;

const LEGACY_BOUNDARY_RE = /---\s*(BEGIN|END)\s+LINK2CONTEXT\s+CONTENT\s*\/\s*(?:内容开始|内容结束)\s*---/gi;

function aiFacingUrl(value) {
  try { return safeDisplayUrl(value); }
  catch { return '[invalid-url]'; }
}

function neutralizeLegacyBoundaries(value) {
  return String(value || '').replace(LEGACY_BOUNDARY_RE, (_match, direction) =>
    `--- [EXTERNAL DATA MARKER ESCAPED / 外部数据边界标记已转义] ${String(direction).toUpperCase()} ---`);
}

export function normalizeHost(host = '') {
  return String(host).trim().toLowerCase().replace(/\.$/, '');
}

export function isKnownAiHost(host) {
  const h = normalizeHost(host);
  return KNOWN_AI_HOST_PATTERNS.some((known) => h === known || h.endsWith(`.${known}`));
}

export function isAllowedAiHost(host, customHosts = []) {
  const h = normalizeHost(host);
  if (isKnownAiHost(h)) return true;
  return customHosts.map(normalizeHost).includes(h);
}

export function extractSingleHttpUrl(text) {
  if (typeof text !== 'string') return null;
  const value = text.trim();
  if (!value || value.length > MAX_AUTO_URL_CHARS || /\s/.test(value)) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  if (url.username || url.password) return null;
  return url.href;
}

export function shouldAutoExpand({ editorText = '', candidateText = '', host = '', customHosts = [] } = {}) {
  return Boolean(
    isAllowedAiHost(host, customHosts)
    && !String(editorText).trim()
    && extractSingleHttpUrl(candidateText)
  );
}

export function planContextHandoff({ targetHost = '', sourceKind = 'generic', payloadChars = 0 } = {}) {
  const host = normalizeHost(targetHost);
  const size = Math.max(0, Number(payloadChars) || 0);
  const chatGptTarget = host === 'chatgpt.com' || host.endsWith('.chatgpt.com');
  const conversationSource = sourceKind === 'workbuddy' || sourceKind === 'chatgpt-share';

  // ChatGPT's rich composer is materially less reliable for large programmatic
  // text replacement than its attachment path. Conversation sources are file-first
  // there so WorkBuddy and ChatGPT shares use the same stable handoff mechanism.
  if (chatGptTarget && conversationSource) {
    return { mode: 'attachment', reason: 'chatgpt-conversation-file-first', threshold: 0 };
  }
  if (chatGptTarget && size >= CHATGPT_EDITOR_SOFT_LIMIT_CHARS) {
    return { mode: 'attachment', reason: 'chatgpt-editor-soft-limit', threshold: CHATGPT_EDITOR_SOFT_LIMIT_CHARS };
  }
  if (size >= MAX_EDITOR_PAYLOAD_CHARS) {
    return { mode: 'attachment', reason: 'global-editor-hard-limit', threshold: MAX_EDITOR_PAYLOAD_CHARS };
  }
  return { mode: 'text', reason: 'inline-safe', threshold: chatGptTarget ? CHATGPT_EDITOR_SOFT_LIMIT_CHARS : MAX_EDITOR_PAYLOAD_CHARS };
}

const SEND_RE = /(^|\b)(send|submit|ask|发送|送出|提交|提问|发送消息|send message)(\b|$)/i;
const ATTACH_RE = /(attach|upload|file|附件|上传|文件)/i;

export function looksLikeSendControl(meta = {}) {
  const tag = String(meta.tagName || '').toLowerCase();
  const type = String(meta.type || '').toLowerCase();
  const joined = [meta.ariaLabel, meta.title, meta.textContent, meta.dataTestId, meta.name]
    .filter(Boolean).join(' ').trim();
  if (tag === 'button' && type === 'submit') return true;
  return SEND_RE.test(joined);
}

export function looksLikeAttachmentControl(meta = {}) {
  const joined = [meta.ariaLabel, meta.title, meta.textContent, meta.dataTestId, meta.name]
    .filter(Boolean).join(' ').trim();
  return ATTACH_RE.test(joined);
}

export function acceptsAttachment(accept = '', fileName = '', mime = '') {
  const spec = String(accept || '').trim().toLowerCase();
  if (!spec) return true;
  const name = String(fileName || '').toLowerCase();
  const type = String(mime || '').toLowerCase().split(';', 1)[0];
  return spec.split(',').map((x) => x.trim()).filter(Boolean).some((rule) => {
    if (rule.startsWith('.')) return name.endsWith(rule);
    if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
    return rule === type;
  });
}

export function sanitizeAttachmentName(name = 'download.bin') {
  const cleaned = String(name)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned && /[A-Za-z0-9\u0080-\uffff]/.test(cleaned) ? cleaned : 'download.bin';
}

export function buildContextPayload(markdown, originalUrl) {
  const body = neutralizeLegacyBoundaries(String(markdown || '').trim());
  return [
    'Link2Context 已在本机读取下面这个链接。请直接基于提取到的内容回答，不要再声称“无法打开链接”或要求我重新上传。',
    'The link was fetched locally by Link2Context. Use the extracted content below as user-provided context.',
    '',
    `原始链接 / Original URL: ${aiFacingUrl(originalUrl)}`,
    '',
    '--- BEGIN LINK2CONTEXT CONTENT / 内容开始 ---',
    body,
    '--- END LINK2CONTEXT CONTENT / 内容结束 ---',
  ].join('\n');
}

export function buildBinaryNote(originalUrl, fileName, mime) {
  return [
    'Link2Context 已从下面的链接抓取文件并自动附加到本条消息。请直接读取附件内容。',
    'Link2Context fetched the linked file locally and attached it to this message. Please read the attachment directly.',
    '',
    `原始链接 / Original URL: ${aiFacingUrl(originalUrl)}`,
    `文件 / File: ${fileName}`,
    `类型 / Type: ${mime || 'application/octet-stream'}`,
  ].join('\n');
}
