import { safeDisplayUrl } from './url-safety.js';
import { renderConversationMarkdown, UNTRUSTED_CONTENT_NOTICE } from './conversation.js';

const MAX_JSON_DEPTH = 12;
const MAX_JSON_ITEMS = 500;

function safeScalar(v) {
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  if (['number', 'boolean', 'bigint'].includes(typeof v)) return String(v);
  return '';
}

function jsonToMarkdown(value, depth = 0, seen = new WeakSet()) {
  if (depth > MAX_JSON_DEPTH) return '_Depth limit reached / 已达到嵌套深度上限_';
  if (value && typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '_Empty array_';
    const kept = value.slice(0, MAX_JSON_ITEMS);
    const body = kept.map((item, i) => `### [${i}]\n${jsonToMarkdown(item, depth + 1, seen)}`).join('\n\n');
    return value.length > kept.length ? `${body}\n\n_… ${value.length - kept.length} more items omitted / 其余项目已省略_` : body;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    const kept = entries.slice(0, MAX_JSON_ITEMS);
    const rows = [];
    for (const [key, val] of kept) {
      if (val && typeof val === 'object') {
        rows.push(`${'#'.repeat(Math.min(depth + 3, 6))} ${key}\n${jsonToMarkdown(val, depth + 1, seen)}`);
      } else {
        rows.push(`- **${key}**: ${safeScalar(val)}`);
      }
    }
    if (entries.length > kept.length) rows.push(`_… ${entries.length - kept.length} more keys omitted / 其余字段已省略_`);
    return rows.join('\n\n');
  }
  return safeScalar(value);
}

function attachmentName(block) {
  for (const key of ['name', 'fileName', 'filename', 'title']) {
    const value = block?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim().replace(/[\r\n]+/g, ' ').slice(0, 160);
  }
  return 'resource';
}

function blockText(block) {
  if (!block || typeof block !== 'object') return '';
  if (block.type === 'text' && typeof block.text === 'string') return block.text;
  if (block.type === 'reasoning') {
    const r = block.reasoning ?? block.text;
    return typeof r === 'string' && r ? '[Reasoning omitted by default / 思考内容已省略]' : '';
  }
  if (block.type === 'tool-call' || block.type === 'tool_call') return `[Tool call / 工具调用: ${block.name ?? 'unknown'}]`;
  if (block.type === 'tool-result' || block.type === 'tool_result') return '[Tool result omitted / 工具结果已省略]';
  if (block.type === 'image') return '[Image omitted / 图片已省略]';
  if (block.type === 'resource_link' || block.type === 'file') return `[Attachment / 附件: ${attachmentName(block)}]`;
  if (typeof block.text === 'string' && !/^data:[^,]+;base64,/i.test(block.text)) return block.text;
  return '';
}

function workBuddyMessageText(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => typeof part === 'string' ? part : blockText(part)).filter(Boolean).join('\n\n');
}

export function workBuddyJsonToMarkdown(data, sourceUrl = '') {
  if (!data || !Array.isArray(data.messages)) {
    throw new Error('Not a recognized WorkBuddy conversation JSON / 不是可识别的 WorkBuddy 对话 JSON');
  }
  const title = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'WorkBuddy Conversation';
  const messages = data.messages.map((message) => ({
    role: message?.messageType ?? message?.role ?? 'unknown',
    time: message?.createTime ?? message?.create_time ?? null,
    text: workBuddyMessageText(message),
  }));
  return renderConversationMarkdown({
    title,
    provider: 'WorkBuddy',
    sourceUrl,
    messages,
  });
}

export function genericJsonToMarkdown(data, sourceUrl = '') {
  return `# JSON Context\n\nSource / 来源: ${safeDisplayUrl(sourceUrl)}\n\n${UNTRUSTED_CONTENT_NOTICE}\n\n${jsonToMarkdown(data)}`;
}

export function textToMarkdown(text, sourceUrl = '', title = 'Text Context') {
  return `# ${title}\n\nSource / 来源: ${safeDisplayUrl(sourceUrl)}\n\n${UNTRUSTED_CONTENT_NOTICE}\n\n${text}`;
}

export function jsonTextToMarkdown(text, sourceUrl = '', kind = 'generic') {
  const data = JSON.parse(text);
  return kind === 'workbuddy'
    ? workBuddyJsonToMarkdown(data, sourceUrl)
    : genericJsonToMarkdown(data, sourceUrl);
}
