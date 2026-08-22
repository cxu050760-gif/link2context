(() => {
  'use strict';

  const STORAGE_KEY = 'handoffPreference';
  const MODE_AUTO = 'auto';
  const MODE_DOCUMENT = 'document';
  const MODE_TEXT = 'text';
  const TEXT_HARD_LIMIT_CHARS = 250_000;
  const BEGIN_MARKER = '--- BEGIN LINK2CONTEXT CONTENT / 内容开始 ---';
  const END_MARKER = '--- END LINK2CONTEXT CONTENT / 内容结束 ---';

  function normalizeMode(value) {
    return [MODE_AUTO, MODE_DOCUMENT, MODE_TEXT].includes(String(value || '').toLowerCase())
      ? String(value).toLowerCase()
      : MODE_AUTO;
  }

  function extractMarkdown(payload) {
    const text = String(payload || '');
    const start = text.indexOf(BEGIN_MARKER);
    const end = text.lastIndexOf(END_MARKER);
    if (start >= 0 && end > start) {
      return text.slice(start + BEGIN_MARKER.length, end).trim();
    }
    return text.trim();
  }

  function buildInlinePayload(markdown, originalUrl) {
    const body = String(markdown || '').trim();
    return [
      'Link2Context 已在本机读取下面这个链接。请直接基于提取到的内容回答，不要再声称“无法打开链接”或要求我重新上传。',
      'The link was fetched locally by Link2Context. Use the extracted content below as user-provided context.',
      '',
      `原始链接 / Original URL: ${String(originalUrl || '')}`,
      '',
      BEGIN_MARKER,
      body,
      END_MARKER,
    ].join('\n');
  }

  function safeNamePart(value) {
    return String(value || '')
      .replace(/[^A-Za-z0-9._-\u0080-\uffff]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 96);
  }

  function contextFileName(sourceUrl = '') {
    try {
      const url = new URL(sourceUrl);
      const host = safeNamePart(url.hostname) || 'context';
      const tail = safeNamePart(url.pathname.split('/').filter(Boolean).pop() || '');
      return `${host}${tail ? `-${tail}` : ''}.md`.slice(0, 120);
    } catch {
      return 'link2context-context.md';
    }
  }

  function plan({ mode = MODE_AUTO, resultKind = '', convertedFromText = false, textChars = 0 } = {}) {
    const selected = normalizeMode(mode);
    const chars = Math.max(0, Number(textChars) || 0);
    const originalBinary = resultKind === 'binary' && !convertedFromText;

    if (originalBinary) return { action: 'as-is', reason: 'original-binary' };
    if (selected === MODE_AUTO) return { action: 'as-is', reason: 'auto' };

    if (selected === MODE_DOCUMENT) {
      if (resultKind === 'binary' && convertedFromText) return { action: 'as-is', reason: 'already-markdown-document' };
      return { action: 'document', reason: 'user-document' };
    }

    if (resultKind === 'binary' && convertedFromText) {
      if (chars >= TEXT_HARD_LIMIT_CHARS) return { action: 'as-is', reason: 'text-hard-limit-safety' };
      return { action: 'text', reason: 'user-text' };
    }
    return { action: 'as-is', reason: 'already-inline-text' };
  }

  globalThis.Link2ContextDelivery = Object.freeze({
    STORAGE_KEY,
    MODE_AUTO,
    MODE_DOCUMENT,
    MODE_TEXT,
    TEXT_HARD_LIMIT_CHARS,
    BEGIN_MARKER,
    END_MARKER,
    normalizeMode,
    extractMarkdown,
    buildInlinePayload,
    contextFileName,
    plan,
  });
})();
