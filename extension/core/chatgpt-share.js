import { renderConversationMarkdown } from './conversation.js';

const ENQUEUE_NEEDLE = 'streamController.enqueue(';
const MAX_DECODE_DEPTH = 80;
const MAX_DECODE_SLOTS = 250_000;
const MAX_SEARCH_NODES = 120_000;
const MAX_ORDERED_NODES = 10_000;

function readJsonStringLiteral(source, quoteAt) {
  if (source[quoteAt] !== '"') return null;
  let i = quoteAt + 1;
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2;
      continue;
    }
    if (source[i] === '"') {
      const literal = source.slice(quoteAt, i + 1);
      try {
        return { value: JSON.parse(literal), end: i + 1 };
      } catch {
        return null;
      }
    }
    i += 1;
  }
  return null;
}

export function extractTurboStream(html) {
  if (typeof html !== 'string' || !html) return '';
  const chunks = [];
  let cursor = 0;
  while (cursor < html.length) {
    const found = html.indexOf(ENQUEUE_NEEDLE, cursor);
    if (found < 0) break;
    let j = found + ENQUEUE_NEEDLE.length;
    while (j < html.length && /\s/.test(html[j])) j += 1;
    if (html[j] === '"') {
      const parsed = readJsonStringLiteral(html, j);
      if (parsed && typeof parsed.value === 'string') {
        chunks.push(parsed.value);
        cursor = parsed.end;
        continue;
      }
    }
    cursor = j + 1;
  }
  return chunks.join('');
}

class PositionalDecoder {
  constructor(flat, promises = new Map()) {
    if (!Array.isArray(flat)) throw new Error('ChatGPT turbo stream root is not an array / ChatGPT 数据流根节点不是数组');
    if (flat.length > MAX_DECODE_SLOTS) throw new Error('ChatGPT share payload has too many slots / ChatGPT 分享数据槽位过多');
    this.flat = flat;
    this.promises = promises;
    this.memo = new Map();
    this.inProgress = new Set();
  }

  resolveEdge(edge, depth = 0) {
    if (depth > MAX_DECODE_DEPTH) return null;
    if (typeof edge === 'boolean') return edge;
    if (Number.isInteger(edge)) {
      if (edge < 0) return null;
      if (this.promises.has(edge)) return this.promises.get(edge);
      if (edge >= this.flat.length) return null;
      return this.resolveIndex(edge, depth + 1);
    }
    return edge;
  }

  resolveIndex(index, depth = 0) {
    if (depth > MAX_DECODE_DEPTH) return null;
    if (this.memo.has(index)) return this.memo.get(index);
    if (this.inProgress.has(index)) return this.memo.get(index) ?? null;
    this.inProgress.add(index);
    const node = this.flat[index];
    let value;

    if (Array.isArray(node)) {
      value = [];
      this.memo.set(index, value);
      for (const item of node) value.push(this.resolveEdge(item, depth + 1));
    } else if (node && typeof node === 'object') {
      value = {};
      this.memo.set(index, value);
      for (const [rawKey, rawValue] of Object.entries(node)) {
        let key = rawKey;
        if (/^_-?\d+$/.test(rawKey)) {
          const keyIndex = Number(rawKey.slice(1));
          const resolvedKey = this.resolveEdge(keyIndex, depth + 1);
          key = typeof resolvedKey === 'string' ? resolvedKey : String(resolvedKey ?? rawKey);
        }
        value[key] = this.resolveEdge(rawValue, depth + 1);
      }
    } else {
      value = node;
    }

    this.memo.set(index, value);
    this.inProgress.delete(index);
    return value;
  }
}

function decodePromiseLines(lines) {
  const promises = new Map();
  for (const line of lines) {
    const match = /^P(\d+):(.*)$/.exec(line);
    if (!match) continue;
    const index = Number(match[1]);
    try {
      const body = JSON.parse(match[2]);
      if (Array.isArray(body) && body.length) {
        promises.set(index, new PositionalDecoder(body).resolveIndex(0));
      } else {
        promises.set(index, body);
      }
    } catch {
      // A malformed deferred promise should not destroy the readable main payload.
    }
  }
  return promises;
}

export function decodeTurboStream(stream) {
  if (typeof stream !== 'string' || !stream.trim()) {
    throw new Error('No ChatGPT turbo-stream payload found / 未找到 ChatGPT turbo-stream 数据');
  }
  const lines = stream.replace(/\r/g, '').split('\n');
  let flat = null;
  let flatLineIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const candidate = lines[i].trim();
    if (!candidate.startsWith('[')) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        flat = parsed;
        flatLineIndex = i;
        break;
      }
    } catch {
      // Continue until a parseable positional array is found.
    }
  }
  if (!flat) throw new Error('ChatGPT turbo-stream positional array is missing / ChatGPT positional 数据数组缺失');
  const promiseLines = lines.filter((_, index) => index !== flatLineIndex);
  const decoder = new PositionalDecoder(flat, decodePromiseLines(promiseLines));
  return decoder.resolveIndex(0);
}

function isConversationShape(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && (Array.isArray(value.linear_conversation) || (value.mapping && typeof value.mapping === 'object')));
}

export function findChatGptConversation(root) {
  if (!root || typeof root !== 'object') return null;

  const loaderData = root?.loaderData;
  if (loaderData && typeof loaderData === 'object') {
    for (const route of Object.values(loaderData)) {
      const data = route?.serverResponse?.data;
      if (isConversationShape(data)) return data;
      if (isConversationShape(route?.data)) return route.data;
    }
  }

  const queue = [root];
  const seen = new WeakSet();
  let visited = 0;
  let fallback = null;
  while (queue.length && visited < MAX_SEARCH_NODES) {
    const value = queue.shift();
    if (!value || typeof value !== 'object') continue;
    if (seen.has(value)) continue;
    seen.add(value);
    visited += 1;

    if (isConversationShape(value)) {
      if (Array.isArray(value.linear_conversation) && value.linear_conversation.length) return value;
      fallback ||= value;
    }

    const children = Array.isArray(value) ? value : Object.values(value);
    for (const child of children) {
      if (child && typeof child === 'object') queue.push(child);
    }
  }
  return fallback;
}

function orderedNodes(conversation) {
  const mapping = conversation?.mapping && typeof conversation.mapping === 'object'
    ? conversation.mapping
    : {};
  const linear = conversation?.linear_conversation;
  if (Array.isArray(linear) && linear.length) {
    return linear.slice(0, MAX_ORDERED_NODES).map((entry) => {
      if (typeof entry === 'string' && mapping[entry]) return mapping[entry];
      return entry;
    }).filter(Boolean);
  }

  const currentNode = conversation?.current_node;
  if (typeof currentNode === 'string' && mapping[currentNode]) {
    const reverse = [];
    const seen = new Set();
    let nodeId = currentNode;
    while (nodeId && mapping[nodeId] && !seen.has(nodeId) && reverse.length < MAX_ORDERED_NODES) {
      seen.add(nodeId);
      const node = mapping[nodeId];
      reverse.push(node);
      nodeId = typeof node?.parent === 'string' ? node.parent : '';
    }
    return reverse.reverse();
  }

  const roots = Object.entries(mapping)
    .filter(([, node]) => node && typeof node === 'object' && !node.parent)
    .map(([id]) => id);
  const start = roots.length ? roots : Object.keys(mapping).slice(0, 1);
  const order = [];
  const seen = new Set();
  const stack = [...start].reverse();
  while (stack.length && order.length < MAX_ORDERED_NODES) {
    const id = stack.pop();
    if (!id || seen.has(id) || !mapping[id]) continue;
    seen.add(id);
    const node = mapping[id];
    order.push(node);
    const children = Array.isArray(node?.children) ? node.children : [];
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
  }
  return order;
}

function safeAttachmentName(part) {
  for (const key of ['name', 'file_name', 'filename', 'title']) {
    const value = part?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim().replace(/[\r\n]+/g, ' ').slice(0, 160);
  }
  return 'file';
}

function multimodalPartText(part) {
  if (!part || typeof part !== 'object') return '';
  const type = String(part.content_type || part.type || '').toLowerCase();
  if (typeof part.text === 'string' && part.text.trim() && !/^data:[^,]+;base64,/i.test(part.text)) {
    return part.text;
  }
  if (/image|image_asset_pointer/.test(type)) return '[Image omitted / 图片已省略]';
  if (/audio/.test(type)) return '[Audio omitted / 音频已省略]';
  if (/file|attachment|asset_pointer/.test(type)) return `[Attachment / 附件: ${safeAttachmentName(part)}]`;
  return type ? `[${type} omitted / 已省略]` : '';
}

export function chatGptContentToText(content) {
  if (typeof content === 'string') return content;
  if (!content || typeof content !== 'object') return '';
  const type = String(content.content_type || '').toLowerCase();
  if (type === 'code' && typeof content.text === 'string') {
    const language = String(content.language || '').replace(/[`\r\n]/g, '').slice(0, 40);
    return `\`\`\`${language}\n${content.text}\n\`\`\``;
  }
  if (Array.isArray(content.parts)) {
    const pieces = [];
    for (const part of content.parts) {
      if (typeof part === 'string') {
        if (part.trim()) pieces.push(part);
      } else {
        const text = multimodalPartText(part);
        if (text) pieces.push(text);
      }
    }
    return pieces.join('\n\n');
  }
  if (typeof content.text === 'string') return content.text;
  return '';
}

export function normalizeChatGptConversation(conversation) {
  if (!isConversationShape(conversation)) {
    throw new Error('No recognizable ChatGPT conversation found / 未找到可识别的 ChatGPT 对话');
  }
  const messages = [];
  for (const node of orderedNodes(conversation)) {
    const message = node?.message && typeof node.message === 'object' ? node.message : node;
    if (!message || typeof message !== 'object') continue;
    const role = String(message?.author?.role || message?.role || '').toLowerCase();
    if (role !== 'user' && role !== 'assistant') continue;
    const text = chatGptContentToText(message.content).trim();
    if (!text) continue;
    messages.push({ role, text, time: message.create_time ?? message.createTime ?? null });
  }
  return {
    title: typeof conversation.title === 'string' && conversation.title.trim()
      ? conversation.title.trim()
      : 'ChatGPT Conversation',
    messages,
  };
}

export function chatGptShareHtmlToMarkdown(html, sourceUrl = '') {
  const stream = extractTurboStream(html);
  const root = decodeTurboStream(stream);
  const conversation = findChatGptConversation(root);
  if (!conversation) throw new Error('No ChatGPT conversation payload found / 未找到 ChatGPT 对话数据');
  const normalized = normalizeChatGptConversation(conversation);
  return renderConversationMarkdown({
    title: normalized.title,
    provider: 'ChatGPT',
    sourceUrl,
    messages: normalized.messages,
  });
}
