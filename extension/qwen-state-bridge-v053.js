(() => {
  'use strict';

  const host = location.hostname.toLowerCase();
  const qwenHost = host === 'chat.qwen.ai' || host.endsWith('.chat.qwen.ai')
    || host === 'qwen.ai' || host.endsWith('.qwen.ai')
    || host === 'tongyi.aliyun.com' || host.endsWith('.tongyi.aliyun.com');
  if (!qwenHost) return;

  const deliveryApi = globalThis.Link2ContextDelivery;
  const SEND_KEY = deliveryApi?.SEND_STORAGE_KEY || 'sendPreference';
  const OWNED_UI = '#__link2context_progress_root,#__link2context_toast';
  const MAX_QWEN_INLINE_CHARS = 180_000;
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

  function controlText(el) {
    if (!(el instanceof Element)) return '';
    return normalizeText([
      el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent,
      el.getAttribute('data-testid'), el.getAttribute('data-test-id'), el.getAttribute('name'),
    ].filter(Boolean).join(' '));
  }

  function sendScore(el, editor, scope) {
    if (!(el instanceof Element) || !visible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') return -Infinity;
    const text = controlText(el);
    if (/(stop|cancel|attach|upload|image|photo|camera|voice|mic|record|search|tool|停止|取消|附件|上传|图片|照片|相机|语音|麦克风|搜索|工具)/i.test(text)) return -Infinity;
    let score = 0;
    if (/(^|\b)(send|ask|发送|送出|提问|发送消息|send message)(\b|$)/i.test(text)) score += 20;
    if (/(send|submit)/i.test(el.getAttribute('data-testid') || '')) score += 16;
    if ((el.matches('button,input') && String(el.getAttribute('type')).toLowerCase() === 'submit')) score += 14;
    if (scope !== document && scope.contains(el)) score += 5;
    if (el.querySelector?.('svg')) score += 3;
    return score;
  }

  function findSendButton(editor, preferred = null) {
    const scope = composerScope(editor);
    if (preferred?.isConnected && sendScore(preferred, editor, scope) >= 5) return preferred;
    const local = [...scope.querySelectorAll('button,[role="button"],input[type="submit"],[data-testid]')]
      .map((el) => ({ el, score: sendScore(el, editor, scope) }))
      .filter((item) => item.score >= 5)
      .sort((a, b) => b.score - a.score);
    if (local[0]) return local[0].el;
    const strong = [...document.querySelectorAll('button,[role="button"],input[type="submit"],[data-testid]')]
      .map((el) => ({ el, score: sendScore(el, editor, document) }))
      .filter((item) => item.score >= 14)
      .sort((a, b) => b.score - a.score);
    return strong[0]?.el || null;
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
    } catch { /* reporting must not break the handoff */ }
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

  function cancelledError() {
    const error = new Error('用户已停止当前 Link2Context 任务 / Link2Context job cancelled by user');
    error.l2cCode = 'USER_CANCELLED';
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

  function resultText(result) {
    if (result.kind === 'binary' && result.convertedFromText) {
      const markdown = base64ToUtf8(result.base64);
      return deliveryApi?.buildInlinePayload?.(markdown, result.sourceUrl) || markdown;
    }
    return String(result.payload || '');
  }

  function selectEditorContents(editor) {
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      editor.select();
      return true;
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);
    return Boolean(selection);
  }

  function textSignature(text) {
    const value = normalizeText(text);
    if (!value) return [];
    if (value.length <= 80) return value.length >= 8 ? [value] : [];
    return [value.slice(0, 48), value.slice(-48)].filter((item) => item.length >= 8);
  }

  async function qwenBrowserEdit(editor, text, job) {
    assertActive(job);
    if (!editor?.isConnected || !isEditable(editor)) return null;
    if (!text || text.length > MAX_QWEN_INLINE_CHARS) return null;

    editor.focus();
    if (!selectEditorContents(editor)) return null;

    // Important: use the browser editing command only. Do not set innerHTML,
    // textContent/value, or dispatch a synthetic input event after it. Qwen's
    // controlled editor can render those DOM mutations while keeping a different
    // internal send state. execCommand(insertText) goes through the editor's
    // normal browser editing path instead of manufacturing a second DOM truth.
    let inserted = false;
    try { inserted = Boolean(document.execCommand?.('insertText', false, text)); } catch { inserted = false; }
    if (!inserted) return null;

    await sleep(220, job);
    assertActive(job);
    let current = currentComposer(editor);
    const signature = textSignature(text);
    const firstRead = normalizeText(editorText(current));
    if (!signature.length || !signature.every((part) => firstRead.includes(part))) return null;

    // Force one focus reconciliation. A DOM-only ghost frequently disappears or
    // loses sendability here; real editor state survives and keeps Send enabled.
    try { current.blur(); } catch { /* no-op */ }
    await sleep(80, job);
    try { current.focus(); } catch { /* no-op */ }
    await sleep(160, job);
    assertActive(job);
    current = currentComposer(current || editor);
    const secondRead = normalizeText(editorText(current));
    if (!signature.every((part) => secondRead.includes(part))) return null;

    const send = findSendButton(current);
    if (!send) return null;
    return { editor: current, button: send, signature };
  }

  function generatingEvidence() {
    return [...document.querySelectorAll('button,[role="button"],[aria-label],[title],[aria-busy="true"]')].some((el) => {
      if (!visible(el)) return false;
      const text = controlText(el);
      return el.getAttribute('aria-busy') === 'true'
        || /(^|\b)(stop generating|stop|停止生成|停止回答|停止)(\b|$)/i.test(text);
    });
  }

  function bodyTextWithoutComposer(editor) {
    try {
      const body = document.body?.cloneNode(true);
      if (!(body instanceof Element)) return '';
      for (const owned of body.querySelectorAll(OWNED_UI)) owned.remove();
      const selector = '[contenteditable="true"],[data-lexical-editor="true"],.ProseMirror,textarea,input[type="text"],input[type="search"],input[type="url"]';
      for (const item of body.querySelectorAll(selector)) item.remove();
      return normalizeText(body.innerText || body.textContent || '');
    } catch { return ''; }
  }

  async function submitVerified(editor, preferredButton, signature, job) {
    let current = currentComposer(editor);
    let button = findSendButton(current, preferredButton);
    const untilButton = Date.now() + 6_000;
    while (!button && Date.now() < untilButton) {
      assertActive(job);
      await sleep(200, job);
      current = currentComposer(current || editor);
      button = findSendButton(current, preferredButton);
    }
    if (!button) return false;

    const before = normalizeText(editorText(current));
    button.click();
    const verifyUntil = Date.now() + 5_000;
    while (Date.now() < verifyUntil) {
      assertActive(job);
      await sleep(180, job);
      if (generatingEvidence()) return true;
      const now = currentComposer(current || editor);
      const after = normalizeText(editorText(now));
      const outside = bodyTextWithoutComposer(now);
      if (signature.length && signature.every((part) => outside.includes(part)) && after !== before) return true;
      if (!after && signature.length && signature.every((part) => outside.includes(part))) return true;
    }
    return false;
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

  function bestAttachmentControl(scope) {
    return [...scope.querySelectorAll('button,[role="button"],[role="menuitem"],[aria-label],[title]')]
      .filter(visible)
      .map((el) => ({ el, score: attachmentControlScore(el) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.el || null;
  }

  async function findFileInput(editor, file, job) {
    const scope = composerScope(editor);
    const candidate = () => {
      const inputs = [...document.querySelectorAll('input[type="file"]')]
        .filter((input) => file.type.startsWith('image/') || !isImageOnlyInput(input));
      return inputs.find((input) => inputAccepts(input, file)) || inputs[0] || null;
    };
    let input = candidate();
    if (input) return input;
    const first = bestAttachmentControl(scope) || bestAttachmentControl(document);
    if (!first) return null;
    first.click();
    await sleep(350, job);
    assertActive(job);
    input = candidate();
    if (input) return input;
    const second = bestAttachmentControl(document);
    if (second && second !== first) {
      second.click();
      await sleep(350, job);
      assertActive(job);
      input = candidate();
    }
    return input;
  }

  function filenameHints(fileName) {
    const name = normalizeText(fileName);
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const hints = [name, stem];
    if (stem.length >= 12) hints.push(stem.slice(0, Math.min(24, stem.length)));
    return [...new Set(hints.filter((item) => item.length >= 8))];
  }

  function scopeHasFilename(scope, fileName) {
    const text = normalizeText(scope?.innerText || scope?.textContent || '').toLowerCase();
    return filenameHints(fileName).some((hint) => text.includes(hint.toLowerCase()));
  }

  async function attachBinaryWithStateProof(result, editor, job) {
    const file = new File([base64ToBytes(result.base64)], result.fileName, { type: result.mime || 'application/octet-stream' });
    const input = await findFileInput(editor, file, job);
    if (!input) return null;
    const oldAccept = input.getAttribute('accept');
    if (!inputAccepts(input, file)) input.removeAttribute('accept');
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    } finally {
      if (oldAccept === null) input.removeAttribute('accept');
      else input.setAttribute('accept', oldAccept);
    }

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      assertActive(job);
      const current = currentComposer(editor);
      const filenameVisible = scopeHasFilename(composerScope(current || editor), file.name)
        || scopeHasFilename(document.body, file.name);
      const send = findSendButton(current || editor);
      // Filename visibility alone is explicitly NOT enough. The user's live Qwen
      // test proved it can be a ghost DOM card that cannot actually be sent.
      if (filenameVisible && send) return { editor: current || editor, button: send, fileName: file.name };
      await sleep(250, job);
    }
    return null;
  }

  function stopEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  async function resolveUrl(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'L2C_RESOLVE_URL', url, userGesture: true }, (response) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(response);
      });
    });
  }

  async function start(editor, url, { preferredButton = null } = {}) {
    if (activeJob?.busy) {
      showToast('Link2Context 已有千问任务在处理，请等待或先 STOP。', true);
      return false;
    }
    const job = { editor, url, busy: true, cancelled: false, autoSubmit: await autoSendEnabled() };
    activeJob = job;
    try {
      report('qwen-state-start', '千问状态安全模式 / Qwen state-safe mode', 'V0.5.3 只接受可证明进入千问真实发送状态的交付。');
      const result = await resolveUrl(url);
      assertActive(job);
      if (!result?.ok) {
        const error = new Error(result?.error || '链接读取失败 / Failed to read link');
        error.l2cCode = result?.errorCode || 'PIPELINE_ERROR';
        throw error;
      }

      const originalBinary = result.kind === 'binary' && !result.convertedFromText;
      if (!originalBinary) {
        const text = resultText(result);
        if (text.length > MAX_QWEN_INLINE_CHARS) {
          const error = new Error('提取内容过长，V0.5.3 暂不对千问做未经证明的自动大文本/伪附件交付。');
          error.l2cCode = 'QWEN_CONTENT_TOO_LARGE';
          throw error;
        }
        report('qwen-editor-write', '正在写入千问真实编辑状态 / Writing Qwen editor state', `${text.length.toLocaleString()} chars`);
        const proof = await qwenBrowserEdit(currentComposer(editor) || editor, text, job);
        if (!proof) {
          const error = new Error('千问只出现了可见文本但没有确认真实发送状态；已停止，避免再次产生删不掉的“假文本”。');
          error.l2cCode = 'QWEN_EDITOR_STATE_UNCONFIRMED';
          throw error;
        }
        report('qwen-state-confirmed', '千问编辑状态已确认 / Qwen editor state confirmed', '文本在焦点重同步后仍存在，且发送控件已由千问自身启用。');
        if (job.autoSubmit) {
          const sent = await submitVerified(proof.editor, proof.button || preferredButton, proof.signature, job);
          if (!sent) {
            const error = new Error('千问自动发送没有取得独立成功证据。');
            error.l2cCode = 'SEND_UNCONFIRMED';
            throw error;
          }
          report('sent', '已完成并发送 / Sent', '千问真实发送状态已验证。', { state: 'success' });
          showToast('Link2Context：千问文本已写入真实编辑状态并发送。');
        } else {
          report('ready-in-composer', '千问内容已准备 / Ready in Qwen', '现在应当可以正常编辑、删除和手动发送。', { state: 'success' });
          showToast('Link2Context：千问内容已进入真实编辑状态，可正常修改后发送。');
        }
        return true;
      }

      report('attachment-start', '正在交付原始附件 / Uploading original attachment', result.fileName || 'file');
      const proof = await attachBinaryWithStateProof(result, currentComposer(editor) || editor, job);
      if (!proof) {
        const error = new Error('千问只显示了附件外观，但没有证明附件进入真实发送状态；已停止，避免假成功。');
        error.l2cCode = 'QWEN_ATTACHMENT_STATE_UNCONFIRMED';
        throw error;
      }
      report('attachment-confirmed', '千问附件发送状态已确认 / Attachment state confirmed', proof.fileName);
      if (job.autoSubmit) {
        const sent = await submitVerified(proof.editor, proof.button || preferredButton, [], job);
        if (!sent) {
          const error = new Error('千问附件自动发送没有取得独立成功证据。');
          error.l2cCode = 'SEND_UNCONFIRMED';
          throw error;
        }
        report('sent', '附件已发送 / Attachment sent', proof.fileName, { state: 'success' });
        showToast('Link2Context：千问附件已发送。');
      } else {
        report('ready-in-composer', '附件已进入千问发送状态 / Attachment ready', proof.fileName, { state: 'success' });
        showToast('Link2Context：千问附件已进入真实发送状态。');
      }
      return true;
    } catch (error) {
      const code = String(error?.l2cCode || 'HANDOFF_ERROR');
      if (code === 'USER_CANCELLED' || job.cancelled) {
        report('cancelled', '已停止 / Stopped', '千问编辑、附件与自动发送均已停止。', { state: 'success', code: 'USER_CANCELLED' });
        showToast('Link2Context：已停止当前千问任务。');
        return false;
      }
      report('error-handoff', '千问交付失败 / Qwen handoff failed', `[${code}] ${String(error?.message || error)}`,
        { state: 'error', code, errorStage: 'HANDOFF' });
      showToast(`Link2Context：${String(error?.message || error)}`, true);
      return false;
    } finally {
      job.busy = false;
      if (activeJob === job) activeJob = null;
    }
  }

  document.addEventListener('link2context:cancel', () => {
    if (activeJob?.busy) activeJob.cancelled = true;
  }, true);

  // This listener is intentionally registered before the generic V0.5.3 runtime.
  // stopImmediatePropagation makes Qwen use exactly one handoff owner per gesture.
  document.addEventListener('paste', (event) => {
    if (!event.isTrusted) return;
    const editor = editorFromTarget(event.target);
    if (!editor || normalizeText(editorText(editor))) return;
    const url = singleUrl(event.clipboardData?.getData('text/plain') || '');
    if (!url) return;
    stopEvent(event);
    start(editor, url).catch(() => {});
  }, true);

  document.addEventListener('keydown', (event) => {
    if (!event.isTrusted || event.isComposing || event.key !== 'Enter'
      || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    const editor = editorFromTarget(event.target);
    if (!editor) return;
    const url = singleUrl(editorText(editor));
    if (!url) return;
    stopEvent(event);
    start(editor, url).catch(() => {});
  }, true);

  document.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    const button = event.target instanceof Element ? event.target.closest('button,[role="button"],input[type="submit"]') : null;
    if (!button) return;
    const editor = currentComposer(editorFromTarget(event.target));
    if (!editor) return;
    const url = singleUrl(editorText(editor));
    if (!url) return;
    if (sendScore(button, editor, composerScope(editor)) < 5) return;
    stopEvent(event);
    start(editor, url, { preferredButton: button }).catch(() => {});
  }, true);
})();
