(() => {
  'use strict';

  const BUILTIN_AI_HOSTS = [
    'chatgpt.com','claude.ai','gemini.google.com','aistudio.google.com','grok.com','perplexity.ai',
    'chat.deepseek.com','doubao.com','kimi.com','chat.qwen.ai','qwen.ai','tongyi.aliyun.com','poe.com',
    'copilot.microsoft.com','chat.mistral.ai','openrouter.ai',
  ];
  const deliveryApi = globalThis.Link2ContextDelivery;
  const DELIVERY_KEY = deliveryApi?.STORAGE_KEY || 'handoffPreference';
  const SEND_KEY = deliveryApi?.SEND_STORAGE_KEY || 'sendPreference';
  const TEXT_HARD_LIMIT_CHARS = deliveryApi?.TEXT_HARD_LIMIT_CHARS || 250_000;
  const OWNED_UI = '#__link2context_progress_root,#__link2context_toast';
  const host = location.hostname.toLowerCase();
  const qwenHost = host === 'chat.qwen.ai' || host.endsWith('.chat.qwen.ai')
    || host === 'qwen.ai' || host.endsWith('.qwen.ai')
    || host === 'tongyi.aliyun.com' || host.endsWith('.tongyi.aliyun.com');
  // Qwen/Tongyi has a dedicated state-safe owner earlier in the manifest. The
  // generic legacy owner must not remain a second path that can bypass its
  // attachment/editor contracts merely because script ordering changes.
  if (qwenHost) return;
  const isBuiltInAiHost = (value) => BUILTIN_AI_HOSTS.some((known) => value === known || value.endsWith(`.${known}`));

  let siteEnabled = isBuiltInAiHost(host);
  let activeJob = null;

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function singleUrl(text) {
    const value = String(text || '').trim();
    if (!value || value.length > 8192 || /\s/.test(value)) return null;
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      return url.href;
    } catch { return null; }
  }

  function isEditable(el) {
    if (!(el instanceof Element)) return false;
    if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
    if (el instanceof HTMLInputElement) return /^(text|search|url)$/i.test(el.type) && !el.disabled && !el.readOnly;
    return el.isContentEditable || el.getAttribute('contenteditable') === 'true'
      || el.matches?.('[data-lexical-editor="true"],.ProseMirror');
  }

  function editorFromTarget(target) {
    if (isEditable(target)) return target;
    return target instanceof Element
      ? target.closest('textarea,input[type="text"],input[type="search"],input[type="url"],[contenteditable="true"],[data-lexical-editor="true"],.ProseMirror')
      : null;
  }

  function visible(el) {
    if (!(el instanceof Element) || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function editorText(editor) {
    if (!editor) return '';
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) return editor.value || '';
    return editor.innerText || editor.textContent || '';
  }

  function currentComposer(preferred = null) {
    if (preferred?.isConnected && isEditable(preferred) && visible(preferred)) return preferred;
    const list = [...document.querySelectorAll(
      'textarea,input[type="text"],input[type="search"],input[type="url"],[contenteditable="true"],[data-lexical-editor="true"],.ProseMirror',
    )].filter((item) => isEditable(item) && visible(item));
    return list.at(-1) || null;
  }

  function composerScope(editor) {
    return editor?.closest?.('form')
      || editor?.closest?.('[data-testid*="composer"],[class*="composer"],[class*="input-area"],[class*="chat-input"]')
      || editor?.parentElement?.parentElement?.parentElement
      || document;
  }

  function attachmentScope(editor) {
    const scope = composerScope(editor);
    return scope !== document ? scope : editor?.parentElement || null;
  }

  function nativeValueSetter(editor, value) {
    const proto = editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(editor, value);
    else editor.value = value;
  }

  function dispatchComposerEvents(editor, value) {
    try {
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: value ? 'insertText' : 'deleteContentBackward',
        data: value || null,
      }));
    } catch {
      editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
    editor.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  function selectAll(editor) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  async function setEditorText(editor, value, { allowQwen = false } = {}) {
    if (!editor?.isConnected) return false;
    if (qwenHost && !allowQwen) return false;
    editor.focus();

    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      nativeValueSetter(editor, value);
      dispatchComposerEvents(editor, value);
      await sleep(30);
      return normalizeText(editorText(editor)) === normalizeText(value);
    }

    try {
      selectAll(editor);
      let inserted = false;
      if (value) inserted = Boolean(document.execCommand?.('insertText', false, value));
      else inserted = Boolean(document.execCommand?.('delete', false));
      await sleep(50);
      if (inserted && normalizeText(editorText(editor)) === normalizeText(value)) {
        dispatchComposerEvents(editor, value);
        return true;
      }
    } catch { /* framework may reject execCommand */ }

    if (qwenHost) return false;

    try {
      selectAll(editor);
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (!range) return false;
      range.deleteContents();
      if (value) range.insertNode(document.createTextNode(value));
      dispatchComposerEvents(editor, value);
      await sleep(30);
      return normalizeText(editorText(editor)) === normalizeText(value);
    } catch { return false; }
  }

  function showToast(message, error = false) {
    let toast = document.getElementById('__link2context_toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = '__link2context_toast';
      Object.assign(toast.style, {
        position: 'fixed', right: '18px', bottom: '18px', zIndex: '2147483647',
        maxWidth: '440px', padding: '10px 14px', borderRadius: '10px',
        background: 'rgba(20,20,20,.92)', color: 'white', fontSize: '13px',
        boxShadow: '0 4px 20px rgba(0,0,0,.25)', pointerEvents: 'none',
      });
      document.documentElement.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.outline = error ? '2px solid #d33' : 'none';
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.remove(), error ? 6500 : 3500);
  }

  function report(stage, label, detail = '', extra = {}) {
    try {
      globalThis.__link2contextReportProgress?.({
        stage, label, detail,
        state: extra.state || 'running',
        level: extra.level || '',
        log: extra.log || label,
        code: extra.code || '',
        errorStage: extra.errorStage || '',
      });
    } catch { /* progress must not break handoff */ }
  }

  function cancelledError() {
    const error = new Error('用户已停止当前 Link2Context 任务 / Link2Context job cancelled by user');
    error.l2cCode = 'USER_CANCELLED';
    error.l2cStage = 'PIPELINE';
    return error;
  }

  function assertActive(job) {
    if (!job || job.cancelled || activeJob !== job) throw cancelledError();
  }

  function sleep(ms, job = null) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        document.removeEventListener('link2context:cancel', onCancel);
        if (job?.cancelled) reject(cancelledError());
        else resolve();
      }, ms);
      const onCancel = () => {
        if (!job) return;
        clearTimeout(timer);
        document.removeEventListener('link2context:cancel', onCancel);
        reject(cancelledError());
      };
      if (job) document.addEventListener('link2context:cancel', onCancel, { once: true });
    });
  }

  async function getDeliveryMode() {
    try {
      const data = await chrome.storage.local.get(DELIVERY_KEY);
      return deliveryApi?.normalizeMode?.(data[DELIVERY_KEY])
        || (['auto', 'document', 'text'].includes(data[DELIVERY_KEY]) ? data[DELIVERY_KEY] : 'auto');
    } catch { return 'auto'; }
  }

  async function autoSendEnabled() {
    try {
      const data = await chrome.storage.local.get(SEND_KEY);
      return (deliveryApi?.normalizeSendMode?.(data[SEND_KEY]) || data[SEND_KEY]) === 'auto';
    } catch { return false; }
  }

  function base64ToBytes(base64) {
    const binary = atob(String(base64 || ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function base64ToUtf8(base64) {
    return new TextDecoder('utf-8', { fatal: false }).decode(base64ToBytes(base64));
  }

  function base64ToFile(base64, fileName, mime) {
    return new File([base64ToBytes(base64)], fileName, { type: mime || 'application/octet-stream' });
  }

  function cleanFileStem(name) {
    const value = String(name || 'link2context-context').replace(/\.[^.]+$/, '');
    return value.replace(/[^A-Za-z0-9._-\u0080-\uffff]+/g, '-').slice(0, 100) || 'link2context-context';
  }

  function qwenTextFile(markdown, sourceUrl = '') {
    const fromApi = deliveryApi?.contextFileName?.(sourceUrl) || 'link2context-context.md';
    return new File([markdown], `${cleanFileStem(fromApi)}.txt`, { type: 'text/plain' });
  }

  function extractedMarkdown(result) {
    if (result.kind === 'binary' && result.convertedFromText) return base64ToUtf8(result.base64);
    const payload = String(result.payload || '');
    if (deliveryApi?.extractMarkdown) return deliveryApi.extractMarkdown(payload);
    const begin = '--- BEGIN LINK2CONTEXT CONTENT / 内容开始 ---';
    const end = '--- END LINK2CONTEXT CONTENT / 内容结束 ---';
    const start = payload.indexOf(begin);
    const finish = payload.lastIndexOf(end);
    return start >= 0 && finish > start ? payload.slice(start + begin.length, finish).trim() : payload.trim();
  }

  function documentNote(result, fileName) {
    return [
      'Link2Context 已把链接内容整理为文档并附加到本条消息。请直接读取附件内容。',
      'Link2Context attached the extracted context as a document. Please read the attachment directly.',
      '',
      `原始链接 / Original URL: ${result.sourceUrl || ''}`,
      `文件 / File: ${fileName}`,
    ].join('\n');
  }

  async function prepareDelivery(result) {
    const selected = await getDeliveryMode();
    const originalBinary = result.kind === 'binary' && !result.convertedFromText;

    if (originalBinary) {
      return {
        mode: 'attachment',
        reason: result.handoffReason || 'original-binary',
        file: base64ToFile(result.base64, result.fileName, result.mime),
        note: result.note || '',
        qwenSafe: qwenHost,
      };
    }

    if (qwenHost) {
      const markdown = extractedMarkdown(result);
      return {
        mode: 'attachment',
        reason: 'qwen-state-safe-document',
        file: qwenTextFile(markdown, result.sourceUrl),
        note: '',
        qwenSafe: true,
      };
    }

    if (selected === 'document') {
      const markdown = extractedMarkdown(result);
      const fileName = deliveryApi?.contextFileName?.(result.sourceUrl) || 'link2context-context.md';
      return {
        mode: 'attachment', reason: 'user-document',
        file: new File([markdown], fileName, { type: 'text/markdown' }),
        note: documentNote(result, fileName), qwenSafe: false,
      };
    }

    if (selected === 'text' && result.kind === 'binary' && result.convertedFromText) {
      const markdown = base64ToUtf8(result.base64);
      if (markdown.length < TEXT_HARD_LIMIT_CHARS) {
        return {
          mode: 'text', reason: 'user-text',
          text: deliveryApi?.buildInlinePayload?.(markdown, result.sourceUrl) || markdown,
          qwenSafe: false,
        };
      }
    }

    if (result.kind === 'binary') {
      return {
        mode: 'attachment', reason: result.handoffReason || 'auto-attachment',
        file: base64ToFile(result.base64, result.fileName, result.mime),
        note: result.note || '', qwenSafe: false,
      };
    }

    return {
      mode: 'text', reason: selected === 'text' ? 'user-text' : (result.handoffReason || 'auto-inline'),
      text: result.payload || '', qwenSafe: false,
    };
  }

  function controlText(el) {
    if (!(el instanceof Element)) return '';
    return normalizeText([
      el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent,
      el.getAttribute('data-testid'), el.getAttribute('data-test-id'), el.getAttribute('name'),
    ].filter(Boolean).join(' '));
  }

  function isImageOnlyInput(input) {
    const accept = String(input?.getAttribute?.('accept') || '').toLowerCase();
    return Boolean(accept) && accept.split(',').every((rule) => rule.trim().startsWith('image/'));
  }

  function inputAccepts(input, file) {
    const spec = String(input?.getAttribute?.('accept') || '').trim().toLowerCase();
    if (!spec) return true;
    const name = file.name.toLowerCase();
    const type = String(file.type || '').toLowerCase().split(';', 1)[0];
    return spec.split(',').map((x) => x.trim()).filter(Boolean).some((rule) => {
      if (rule.startsWith('.')) return name.endsWith(rule);
      if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
      return rule === type;
    });
  }

  function attachmentControlScore(el) {
    const text = controlText(el);
    let score = 0;
    if (/(attach|attachment|附件)/i.test(text)) score += 10;
    if (/(file|document|文件|文档)/i.test(text)) score += 8;
    if (/(upload|上传)/i.test(text)) score += 4;
    if (/(image|photo|camera|图片|照片|相机)/i.test(text)) score -= 8;
    if (/^(\+|add|more|添加|更多|添加内容|更多功能)$/i.test(text)) score += 2;
    return score;
  }

  function safeAttachmentControl(el) {
    if (!(el instanceof Element) || !visible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    return String(el.type || el.getAttribute('type') || '').toLowerCase() !== 'submit';
  }

  function bestAttachmentControl(scope) {
    if (!scope) return null;
    return [...scope.querySelectorAll('button,[role="button"],[role="menuitem"],[aria-label],[title]')]
      .filter((el) => safeAttachmentControl(el))
      .map((el) => ({ el, score: attachmentControlScore(el) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.el || null;
  }

  function candidateFileInput(scope, file) {
    if (!scope) return null;
    return [...scope.querySelectorAll('input[type="file"]')]
      .find((input) => !input.disabled && input.getAttribute('aria-disabled') !== 'true'
        && !isImageOnlyInput(input) && inputAccepts(input, file)) || null;
  }

  async function findFileInput(editor, file, job) {
    const scope = attachmentScope(editor);
    if (!scope) return null;
    let input = candidateFileInput(scope, file);
    if (input) return input;

    const baseline = new Set(document.querySelectorAll('input[type="file"]'));
    const first = bestAttachmentControl(scope);
    if (!first) return null;
    first.click();
    await sleep(350, job);
    assertActive(job);
    input = candidateFileInput(scope, file);
    if (input) return input;
    return [...document.querySelectorAll('input[type="file"]')]
      .find((candidate) => !baseline.has(candidate) && !candidate.disabled
        && candidate.getAttribute('aria-disabled') !== 'true' && !isImageOnlyInput(candidate)
        && inputAccepts(candidate, file)) || null;
  }

  function filenameHints(fileName) {
    const name = String(fileName || '').trim();
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const hints = [name, stem];
    if (stem.length >= 12) hints.push(stem.slice(0, Math.min(24, stem.length)));
    return [...new Set(hints.map(normalizeText).filter((item) => item.length >= 8))];
  }

  function nodeTextWithoutOwnedUi(scope = document.body) {
    if (!scope) return '';
    try {
      const clone = scope.cloneNode(true);
      if (clone instanceof Element) for (const owned of clone.querySelectorAll(OWNED_UI)) owned.remove();
      return normalizeText(clone.innerText || clone.textContent || '');
    } catch { return normalizeText(scope.textContent || ''); }
  }

  function scopeHasFilename(scope, fileName) {
    const text = nodeTextWithoutOwnedUi(scope).toLowerCase();
    return filenameHints(fileName).some((hint) => text.includes(hint.toLowerCase()));
  }

  async function attachFile(file, editor, job) {
    assertActive(job);
    const input = await findFileInput(editor, file, job);
    if (!input || input.disabled || input.getAttribute('aria-disabled') === 'true' || !inputAccepts(input, file)) {
      throw new Error('找不到兼容的网页 AI 附件入口 / No compatible attachment input found');
    }

    const localScope = attachmentScope(editor);
    const filenameWasVisible = scopeHasFilename(localScope, file.name);
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      assertActive(job);
      const editorNow = currentComposer(editor);
      const local = attachmentScope(editorNow || editor);
      if (!filenameWasVisible && scopeHasFilename(local, file.name)) return true;
      await sleep(250, job);
    }
    throw new Error('附件未被网页 AI 确认登记 / Attachment was not confirmed by the web AI');
  }

  function sendScore(el, editor, scope) {
    if (!(el instanceof Element) || !visible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') return -Infinity;
    if (scope === document || !scope.contains(el)) return -Infinity;
    const text = controlText(el);
    if (/(stop|cancel|attach|upload|image|photo|camera|voice|mic|record|search|tool|停止|取消|附件|上传|图片|照片|相机|语音|麦克风|搜索|工具)/i.test(text)) return -Infinity;
    let score = 0;
    if (/(^|\b)(send|ask|发送|送出|提问|发送消息|send message)(\b|$)/i.test(text)) score += 20;
    if (/(send|submit)/i.test(el.getAttribute('data-testid') || '')) score += 16;
    if ((el.matches('button,input') && String(el.getAttribute('type')).toLowerCase() === 'submit')) score += 14;
    if (scope.contains(el)) score += 5;
    if (el.querySelector?.('svg')) score += 3;
    if (editor && el.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_PRECEDING) score += 1;
    return score;
  }

  function findSendButton(editor, preferred = null) {
    const scope = composerScope(editor);
    if (scope === document) return null;
    if (preferred?.isConnected && scope.contains(preferred) && sendScore(preferred, editor, scope) >= 0) return preferred;
    return [...scope.querySelectorAll('button,[role="button"],input[type="submit"],[data-testid]')]
      .map((el) => ({ el, score: sendScore(el, editor, scope) }))
      .filter((item) => item.score >= 5)
      .sort((a, b) => b.score - a.score)[0]?.el || null;
  }

  function generatingEvidence() {
    return [...document.querySelectorAll('button,[role="button"],[aria-label],[title],[aria-busy="true"]')].some((el) => {
      if (!visible(el)) return false;
      const text = controlText(el);
      return el.getAttribute('aria-busy') === 'true'
        || /(^|\b)(stop generating|stop|停止生成|停止回答|停止)(\b|$)/i.test(text);
    });
  }

  function textSignature(text) {
    const value = normalizeText(text);
    if (!value) return [];
    if (value.length <= 80) return value.length >= 12 ? [value] : [];
    return [value.slice(0, 48), value.slice(-48)].filter((item) => item.length >= 12);
  }

  function evidenceOutsideComposer(editor, signature, fileName) {
    const body = nodeTextWithoutOwnedUi(document.body);
    const composer = currentComposer(editor);
    const composerText = normalizeText(editorText(composer));
    if (signature.length && signature.every((part) => body.includes(part))
      && !signature.every((part) => composerText.includes(part))) return true;

    if (fileName) {
      const local = attachmentScope(composer || editor);
      const bodyHas = scopeHasFilename(document.body, fileName);
      const composerHas = scopeHasFilename(local, fileName);
      if (bodyHas && !composerHas) return true;
    }
    return false;
  }

  async function reliableSubmit(editor, preferred, job, { signatureText = '', fileName = '' } = {}) {
    const signature = textSignature(signatureText);
    let current = currentComposer(editor);
    let button = findSendButton(current, preferred);
    const deadline = Date.now() + 8_000;
    while (!button && Date.now() < deadline) {
      assertActive(job);
      await sleep(250, job);
      current = currentComposer(current || editor);
      button = findSendButton(current, preferred);
    }
    if (!button) return false;

    assertActive(job);
    const before = normalizeText(editorText(current));
    button.click();

    const verifyUntil = Date.now() + 5_000;
    while (Date.now() < verifyUntil) {
      assertActive(job);
      await sleep(200, job);
      if (generatingEvidence()) return true;
      const now = currentComposer(current || editor);
      const after = normalizeText(editorText(now));
      const composerChanged = after !== before;
      if (composerChanged && evidenceOutsideComposer(now || editor, signature, fileName)) return true;
      if (!after && evidenceOutsideComposer(now || editor, signature, fileName)) return true;
    }
    return false;
  }

  function stopEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  async function startJob(editor, url, { trigger = 'paste', preferredButton = null } = {}) {
    if (activeJob?.busy) {
      showToast('Link2Context 已有任务在处理，请等待或先 STOP。 / A job is already running.', true);
      return false;
    }

    const job = {
      editor, url, trigger, preferredButton,
      busy: true, cancelled: false,
      autoSubmit: await autoSendEnabled(),
      startedAt: Date.now(),
    };
    activeJob = job;

    try {
      report('handoff-local-start', '开始处理链接 / Starting Link2Context', `目标 / Target: ${host}`);
      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'L2C_RESOLVE_URL', url, userGesture: true, startedAt: job.startedAt }, (response) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(response);
        });
      });
      assertActive(job);

      if (!result?.ok) {
        const error = new Error(result?.error || '链接读取失败 / Failed to read link');
        error.l2cCode = result?.errorCode || 'PIPELINE_ERROR';
        error.l2cStage = result?.errorStage || 'PIPELINE';
        throw error;
      }

      const prepared = await prepareDelivery(result);
      assertActive(job);
      report('handoff-received', '后台处理完成，开始网页交付 / Starting page handoff',
        `方式 / Mode: ${prepared.mode}；原因 / Reason: ${prepared.reason}`);

      let signatureText = '';
      let attachedName = '';
      if (prepared.mode === 'attachment') {
        report('attachment-start', '正在上传附件 / Uploading attachment', prepared.file.name);
        await attachFile(prepared.file, editor, job);
        assertActive(job);
        attachedName = prepared.file.name;
        report('attachment-confirmed', '附件已确认 / Attachment confirmed', attachedName);

        if (!prepared.qwenSafe && prepared.note) {
          const composer = currentComposer(editor);
          if (!composer || !(await setEditorText(composer, prepared.note))) {
            throw new Error('附件已上传，但无法安全写入说明 / Attachment uploaded but note insertion failed');
          }
          signatureText = prepared.note;
        }
      } else {
        const composer = currentComposer(editor);
        if (!composer || !(await setEditorText(composer, prepared.text))) {
          throw new Error('无法安全写入网页 AI 输入框 / Could not safely update the composer');
        }
        signatureText = prepared.text;
        report('inline-confirmed', '文本已写入输入框 / Inline context prepared', `${String(prepared.text || '').length.toLocaleString()} chars`);
      }

      assertActive(job);
      if (job.autoSubmit) {
        report('send-attempt', '正在自动发送 / Auto-sending', '只点击已启用的候选发送控件，并要求独立页面证据。');
        const sent = await reliableSubmit(currentComposer(editor) || editor, preferredButton, job, {
          signatureText,
          fileName: attachedName,
        });
        if (!sent) {
          report('send-unconfirmed', '自动发送未确认 / Auto-send not confirmed',
            '内容已准备，但没有取得足够证据证明消息进入对话；请手动检查后发送。',
            { state: 'error', code: 'SEND_UNCONFIRMED', errorStage: 'HANDOFF' });
          showToast('Link2Context：自动发送未确认，请手动检查后发送。', true);
          return false;
        }
        report('sent', '已完成并发送 / Handoff complete and sent', 'V0.5.3 已取得独立发送证据。', { state: 'success' });
        showToast('Link2Context：已自动发送，并确认消息进入对话。');
      } else {
        report('ready-in-composer', '内容已准备好，等待手动发送 / Ready for manual send',
          '请检查内容后手动发送。', { state: 'success' });
        showToast('Link2Context：内容已准备好。');
      }
      return true;
    } catch (error) {
      const code = String(error?.l2cCode || 'HANDOFF_ERROR');
      const stage = String(error?.l2cStage || 'HANDOFF').toUpperCase();
      if (code === 'USER_CANCELLED' || job.cancelled) {
        report('cancelled', '已停止 / Stopped', '网络读取、附件交付和自动发送均已停止。',
          { state: 'success', code: 'USER_CANCELLED', errorStage: 'PIPELINE' });
        showToast('Link2Context：已停止当前任务。');
        return false;
      }
      report(`error-${stage.toLowerCase()}`, 'Link2Context 处理失败 / Handoff failed', `[${code}] ${String(error?.message || error)}`,
        { state: 'error', code, errorStage: stage });
      showToast(`Link2Context：${String(error?.message || error)}`, true);
      return false;
    } finally {
      job.busy = false;
      if (activeJob === job) activeJob = null;
    }
  }

  document.addEventListener('link2context:cancel', () => {
    if (!activeJob?.busy) return;
    activeJob.cancelled = true;
    chrome.runtime.sendMessage({ type: 'L2C_CANCEL_JOB', startedAt: activeJob.startedAt }, () => void chrome.runtime.lastError);
  }, true);

  document.addEventListener('paste', (event) => {
    if (!siteEnabled || !event.isTrusted) return;
    const editor = editorFromTarget(event.target);
    if (!editor || normalizeText(editorText(editor))) return;
    const url = singleUrl(event.clipboardData?.getData('text/plain') || '');
    if (!url) return;
    stopEvent(event);
    startJob(editor, url, { trigger: 'paste' }).catch(() => {});
  }, true);

  document.addEventListener('keydown', (event) => {
    if (!siteEnabled || !event.isTrusted || event.isComposing || event.key !== 'Enter'
      || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    const editor = editorFromTarget(event.target);
    if (!editor) return;
    const url = singleUrl(editorText(editor));
    if (!url) return;
    stopEvent(event);
    startJob(editor, url, { trigger: 'enter' }).catch(() => {});
  }, true);

  document.addEventListener('click', (event) => {
    if (!siteEnabled || !event.isTrusted) return;
    const button = event.target instanceof Element ? event.target.closest('button,[role="button"],input[type="submit"]') : null;
    if (!button) return;
    const editor = currentComposer(editorFromTarget(event.target));
    if (!editor) return;
    const scope = composerScope(editor);
    if (scope === document || !scope.contains(button)) return;
    const url = singleUrl(editorText(editor));
    if (!url) return;
    const score = sendScore(button, editor, scope);
    if (score < 5) return;
    stopEvent(event);
    startJob(editor, url, { trigger: 'click', preferredButton: button }).catch(() => {});
  }, true);

  function refreshSiteStatus() {
    chrome.runtime.sendMessage({ type: 'L2C_SITE_STATUS' }, (result) => {
      if (!chrome.runtime.lastError) siteEnabled = Boolean(result?.enabled);
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.customAiHosts) refreshSiteStatus();
  });
  refreshSiteStatus();
})();
