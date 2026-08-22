import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeTurboStream, normalizeChatGptConversation, chatGptContentToText } from '../extension/core/chatgpt-share.js';

function msg(role, text) {
  return { message: { author: { role }, content: { content_type: 'text', parts: [text] } } };
}

test('decoder treats __proto__ as inert external data and does not pollute Object.prototype', () => {
  const flat = [
    { _1: 2 },
    '__proto__',
    { _3: 4 },
    'polluted',
    'yes',
  ];
  const root = decodeTurboStream(JSON.stringify(flat));
  assert.equal(Object.getPrototypeOf(root), null);
  assert.equal(root.__proto__.polluted, 'yes');
  assert.equal(({}).polluted, undefined);
});

test('large embedded base64-looking string is replaced instead of bloating context', () => {
  const blob = 'A'.repeat(300_000);
  const text = chatGptContentToText({ parts: [blob, 'keep me'] });
  assert.match(text, /Embedded binary data omitted/);
  assert.match(text, /keep me/);
  assert.ok(text.length < 1000);
});

test('data URLs are replaced even when they are short', () => {
  const text = chatGptContentToText({ parts: ['data:image/png;base64,AAAA', 'caption'] });
  assert.doesNotMatch(text, /base64,AAAA/);
  assert.match(text, /caption/);
});

test('without current_node, fallback follows one deterministic branch rather than mixing alternatives', () => {
  const mapping = {
    root: { id: 'root', parent: null, children: ['u'], message: null },
    u: { id: 'u', parent: 'root', children: ['old', 'new'], ...msg('user', 'question') },
    old: { id: 'old', parent: 'u', children: [], ...msg('assistant', 'old alternate') },
    new: { id: 'new', parent: 'u', children: [], ...msg('assistant', 'new selected-like branch') },
  };
  const normalized = normalizeChatGptConversation({ title: 'No current', mapping });
  const combined = normalized.messages.map((x) => x.text).join('\n');
  assert.match(combined, /question/);
  assert.match(combined, /new selected-like branch/);
  assert.doesNotMatch(combined, /old alternate/);
});

test('array-shaped content is flattened without stringifying arbitrary objects', () => {
  const text = chatGptContentToText(['plain', { content_type: 'image_asset_pointer', internal: 'SECRET' }]);
  assert.match(text, /plain/);
  assert.match(text, /Image omitted/);
  assert.doesNotMatch(text, /SECRET/);
});
