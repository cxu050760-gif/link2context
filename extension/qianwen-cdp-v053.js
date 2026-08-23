(() => {
  'use strict';

  const host = location.hostname.toLowerCase();
  const managedHost = host === 'qianwen.com' || host.endsWith('.qianwen.com')
    || host === 'qwenwork.cn' || host.endsWith('.qwenwork.cn');
  if (!managedHost) return;

  const deliveryApi = globalThis.Link2ContextDelivery;
  const SEND_KEY = deliveryApi?.SEND_STORAGE_KEY || 'sendPreference';
  const MAX_INLINE_CHARS = 180_000;
  const OWNED_UI = '#__link2context_progress_root,#__link2context_toast';
  let activeJob = null;

  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();

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
      || el.getAttribute('role') === 'textbox' || el.matches?.('[data-lexical-editor="true"],.ProseMirror');
  }

  function editorFromTarget(target) {
    if (isEditable(target)) return target;
    return target instanceof Element
      ? target.closest('textarea,input[type="text"],input[type="search"],input[type="url"],[contenteditable="true"],[role="textbox"],[data-lexical-editor="true"],.ProseMirror')
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
      'textarea,input[type="text"],input[type="search"],input[type="url"],[contenteditable="true"][role="textbox"],[contenteditable="true"],[role="textbox"],[data-lexical-editor="true"],.ProseMirror',
    )].filter((el) => isEditable(el) && visible(el));
    return list.at(-1) || null;
  }

  function composerScope(editor) {
    return editor?.closest?.('form')
      || editor?.closest?.('[data-testid*="composer"],[class*="composer"],[class*="input-area"],[class*="chat-input"],[class*="prompt"]')
      || editor?.parentElement?.parentElement?.parentElement
      || document;
  }

  function attachmentScope(editor) {
    const scope = composerScope(editor);
    if (scope !== document) return scope;
    return editor?.parentElement || null;
  }

  function report(stage, label, detail = '', extra = {}) {
    try {
      globalThis.__link2contextReportProgress?.({
        stage, label, detail,
        state: extra.state || 'running', level: extra.level || '', log: extra.log || label,
        code: extra.code || '', errorStage: extra.errorStage || '',
      });
    } catch { /* progress must not break handoff */ }
  }

  function showToast(message, error = false) {
    let toast = document.getElementById('__link2context_toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = '__link2context_toast';
      Object.assign(toast.style, {
        position: 'fixed', right: '18px', bottom: '18px', zIndex: '2147483647',
        maxWidth: '470px', padding: '10px 14px', borderRadius: '10px',
        background: 'rgba(20,20,20,.92)', color: 'white', fontSize: '13px',
        boxShadow: '0 4px 20px rgba(0,0,0,.25)', pointerEvents: 'none',
      });
      document.documentElement.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.outline = error ? '2px solid #d33' : 'none';
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.remove(), error ? 7500 : 3800);
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

  function textSignature(text) {
    const value = normalize(text);
    if (!value) return [];
    if (value.length <= 80) return value.length >= 8 ? [value] : [];
    return [value.slice(0, 48), value.slice(-48)].filter((part) => part.length >= 8);
  }

  function selectEditorContents(editor) {
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      editor.focus();
      editor.select();
      return true;
    }
    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);
    return Boolean(selection);
  }

  async function debuggerCommand(action, text = '') {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'L2C_QIANWEN_CDP', action, text, userGesture: true }, (response) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!response?.ok) {
          const error = new Error(response?.error || 'Chrome debugger input failed / Chrome 调试输入失败');
          error.l2cCode = response?.errorCode || 'QIANWEN_DEBUGGER_FAILED';
          reject(error);
        } else resolve(response);
      });
    });
  }

  async function resolveUrl(url, startedAt) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'L2C_RESOLVE_URL', url, userGesture: true, startedAt }, (response) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(response);
      });
    });
  }

  async function writeViaDebugger(editor, text, job) {
    assertActive(job);
    if (!editor?.isConnected || !isEditable(editor) || !text || text.length > MAX_INLINE_CHARS) return null;
    if (!selectEditorContents(editor)) return null;

    await debuggerCommand('insertText', text);
    await sleep(260, job);
    assertActive(job);

    let current = currentComposer(editor);
    const signature = textSignature(text);
    if (!signature.length || !signature.every((part) => normalize(editorText(current)).includes(part))) return null;

    // A CDP Input.insertText write is delivered through Chrome's real editing path.
    // Blur/refocus then proves the text survived the site's own reconciliation.
    try { current.blur(); } catch { /* no-op */ }
    await sleep(100, job);
    try { current.focus(); } catch { /* no-op */ }
    await sleep(180, job);
    assertActive(job);
    current = currentComposer(current || editor);
    if (!signature.every((part) => normalize(editorText(current)).includes(part))) return null;
    return { editor: current, signature };
  }

  function controlText(el) {
    if (!(el instanceof Element)) return '';
    return normalize([
      el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent,
      el.getAttribute('data-testid'), el.getAttribute('data-test-id'), el.getAttribute('name'),
    ].filter(Boolean).join(' '));
  }

  function generatingEvidence() {
    return [...document.querySelectorAll('button,[role="button"],[aria-label],[title],[aria-busy="true"]')].some((el) => {
      if (!visible(el)) return false;
      const text = controlText(el);
      return el.getAttribute('aria-busy') === 'true'
        || /(^|\b)(stop generating|stop|停止生成|停止回答|停止)(\b|$)/i.test(text);
    });
  }

  function bodyTextWithoutComposer() {
    try {
      const body = document.body?.cloneNode(true);
      if (!(body instanceof Element)) return '';
      for (const owned of body.querySelectorAll(OWNED_UI)) owned.remove();
      for (const item of body.querySelectorAll('[contenteditable="true"],[role="textbox"],[data-lexical-editor="true"],.ProseMirror,textarea,input[type="text"],input[type="search"],input[type="url"]')) item.remove();
      return normalize(body.innerText || body.textContent || '');
    } catch { return ''; }
  }

  async function submitTextViaDebugger(editor, signature, job) {
    const before = normalize(editorText(currentComposer(editor) || editor));
    await debuggerCommand('pressEnter');
    const deadline = Date.now() + 7_000;
    while (Date.now() < deadline) {
      assertActive(job);
      await sleep(180, job);
      if (generatingEvidence()) return true;
      const current = currentComposer(editor);
      const after = normalize(editorText(current));
      const outside = bodyTextWithoutComposer();
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

  function usableFileInput(input, file) {
    return Boolean(input) && !input.disabled && input.getAttribute?.('aria-disabled') !== 'true'
      && (file.type.startsWith('image/') || !isImageOnlyInput(input)) && inputAccepts(input, file);
  }

  function attachmentScore(el) {
    const text = controlText(el);
    let score = 0;
    if (/(attach|attachment|附件)/i.test(text)) score += 10;
    if (/(file|document|文件|文档)/i.test(text)) score += 8;
    if (/(upload|上传)/i.test(text)) score += 4;
    if (/(image|photo|camera|图片|照片|相机)/i.test(text)) score -= 6;
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
      .map((el) => ({ el, score: attachmentScore(el) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.el || null;
  }

  async function findFileInput(editor, file, job) {
    const scope = attachmentScope(editor);
    if (!scope) return null;
    const local = () => [...scope.querySelectorAll('input[type="file"]')]
      .find((input) => !input.disabled && input.getAttribute('aria-disabled') !== 'true' && usableFileInput(input, file)) || null;
    let input = local();
    if (input) return input;

    const baseline = new Set(document.querySelectorAll('input[type="file"]'));
    const control = bestAttachmentControl(scope);
    if (!control) return null;
    control.click();
    await sleep(400, job);
    assertActive(job);
    input = local();
    if (input) return input;
    return [...document.querySelectorAll('input[type="file"]')]
      .find((candidate) => !baseline.has(candidate) && !candidate.disabled
        && candidate.getAttribute('aria-disabled') !== 'true' && usableFileInput(candidate, file)) || null;
  }

  function filenameHints(fileName) {
    const name = normalize(fileName);
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const hints = [name, stem];
    if (stem.length >= 12) hints.push(stem.slice(0, Math.min(24, stem.length)));
    return [...new Set(hints.filter((item) => item.length >= 8))];
  }

  function filenameVisible(fileName, editor) {
    const scope = attachmentScope(editor);
    if (!scope) return false;
    const text = normalize(scope.innerText || scope.textContent || '').toLowerCase();
    return filenameHints(fileName).some((hint) => text.includes(hint.toLowerCase()));
  }

  async function attachBinary(result, editor, job) {
    const file = new File([base64ToBytes(result.base64)], result.fileName, { type: result.mime || 'application/octet-stream' });
    const input = await findFileInput(editor, file, job);
    if (!usableFileInput(input, file)) return null;
    const filenameWasVisible = filenameVisible(file.name, editor);
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      assertActive(job);
      if (!filenameWasVisible && filenameVisible(file.name, editor)) return { editor: currentComposer(editor) || editor, fileName: file.name };
      await sleep(250, job);
    }
    return null;
  }

  async function submitAttachmentViaDebugger(fileName, editor, job) {
    await debuggerCommand('pressEnter');
    const deadline = Date.now() + 7_000;
    while (Date.now() < deadline) {
      assertActive(job);
      await sleep(180, job);
      if (generatingEvidence()) return true;
      if (!filenameVisible(fileName, editor)) return true;
      if (!currentComposer(editor)?.isConnected) return true;
    }
    return false;
  }

  function stopEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  async function start(editor, url) {
    if (activeJob?.busy) {
      showToast('Link2Context 已有千问任务在处理，请等待或先 STOP。', true);
      return false;
    }
    const job = { editor, url, busy: true, cancelled: false, autoSubmit: await autoSendEnabled(), startedAt: Date.now() };
    activeJob = job;
    try {
      report('qianwen-cdp-start', '千问真实键盘模式 / Qianwen CDP input mode', 'V0.5.3 使用 Chrome 调试协议输入，不再直接改千问 DOM。');
      const result = await resolveUrl(url, job.startedAt);
      assertActive(job);
      if (!result?.ok) {
        const error = new Error(result?.error || '链接读取失败 / Failed to read link');
        error.l2cCode = result?.errorCode || 'PIPELINE_ERROR';
        throw error;
      }

      const originalBinary = result.kind === 'binary' && !result.convertedFromText;
      if (!originalBinary) {
        const text = resultText(result);
        if (!text || text.length > MAX_INLINE_CHARS) {
          const error = new Error('提取内容为空或过长，无法安全写入千问。');
          error.l2cCode = 'QIANWEN_CONTENT_TOO_LARGE';
          throw error;
        }

        report('qianwen-cdp-write', '正在通过 Chrome 真实输入写入 / Writing through Chrome input', `${text.length.toLocaleString()} chars`);
        const proof = await writeViaDebugger(currentComposer(editor) || editor, text, job);
        if (!proof) {
          const error = new Error('Chrome 真实输入后，千问没有保留完整文本；已停止，不再留下假内容。');
          error.l2cCode = 'QIANWEN_CDP_STATE_UNCONFIRMED';
          throw error;
        }

        if (job.autoSubmit) {
          report('qianwen-cdp-send', '正在用真实 Enter 发送 / Sending with real Enter', '不再猜千问发送按钮。');
          const sent = await submitTextViaDebugger(proof.editor, proof.signature, job);
          if (!sent) {
            const error = new Error('千问真实 Enter 已执行，但没有取得发送成功证据。');
            error.l2cCode = 'SEND_UNCONFIRMED';
            throw error;
          }
          report('sent', '千问已发送 / Sent', 'CDP 输入与 Enter 发送均已验证。', { state: 'success' });
          showToast('Link2Context：千问内容已通过真实浏览器输入并发送。');
        } else {
          report('ready-in-composer', '千问内容已准备 / Ready in Qianwen', '内容由 Chrome 真实输入写入，应可正常编辑、删除和手动发送。', { state: 'success' });
          showToast('Link2Context：千问内容已通过真实浏览器输入写入，可直接编辑。');
        }
        return true;
      }

      report('attachment-start', '正在交付原始附件 / Uploading original attachment', result.fileName || 'file');
      const proof = await attachBinary(result, currentComposer(editor) || editor, job);
      if (!proof) {
        const error = new Error('千问没有确认附件已进入输入区。');
        error.l2cCode = 'QIANWEN_ATTACHMENT_STATE_UNCONFIRMED';
        throw error;
      }
      if (job.autoSubmit) {
        const sent = await submitAttachmentViaDebugger(proof.fileName, proof.editor, job);
        if (!sent) {
          const error = new Error('千问附件真实 Enter 发送没有取得成功证据。');
          error.l2cCode = 'SEND_UNCONFIRMED';
          throw error;
        }
        report('sent', '千问附件已发送 / Attachment sent', proof.fileName, { state: 'success' });
        showToast('Link2Context：千问附件已发送。');
      } else {
        report('ready-in-composer', '千问附件已准备 / Attachment ready', proof.fileName, { state: 'success' });
        showToast('Link2Context：千问附件已进入输入区。');
      }
      return true;
    } catch (error) {
      const code = String(error?.l2cCode || 'HANDOFF_ERROR');
      if (code === 'USER_CANCELLED' || job.cancelled) {
        report('cancelled', '已停止 / Stopped', '千问读取、输入、附件与发送均已停止。', { state: 'success', code: 'USER_CANCELLED' });
        showToast('Link2Context：已停止当前千问任务。');
        return false;
      }
      report('error-handoff', '千问交付失败 / Qianwen handoff failed', `[${code}] ${String(error?.message || error)}`,
        { state: 'error', code, errorStage: 'HANDOFF' });
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
    if (!event.isTrusted) return;
    const editor = editorFromTarget(event.target);
    if (!editor || normalize(editorText(editor))) return;
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
    if (!button || !visible(button)) return;
    const editor = currentComposer(editorFromTarget(event.target));
    if (!editor) return;
    const scope = composerScope(editor);
    if (scope === document || !scope.contains(button)) return;
    const url = singleUrl(editorText(editor));
    if (!url) return;
    const text = controlText(button);
    if (/(stop|cancel|attach|upload|image|photo|camera|voice|mic|search|tool|停止|取消|附件|上传|图片|相机|语音|搜索|工具)/i.test(text)) return;
    stopEvent(event);
    start(editor, url).catch(() => {});
  }, true);
})();