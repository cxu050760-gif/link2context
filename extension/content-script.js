(() => {
  'use strict';

  const PLACEHOLDER = '⏳ Link2Context 正在读取链接… / Reading link…';
  const BUILTIN_AI_HOSTS = ['chatgpt.com','claude.ai','gemini.google.com','aistudio.google.com','grok.com','perplexity.ai','chat.deepseek.com','doubao.com','kimi.com','chat.qwen.ai','qwen.ai','tongyi.aliyun.com','poe.com','copilot.microsoft.com','chat.mistral.ai','openrouter.ai'];
  const isBuiltInAiHost = (host) => BUILTIN_AI_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
  const jobByEditor = new WeakMap();
  let siteEnabled = isBuiltInAiHost(location.hostname.toLowerCase());

  function singleUrl(text) {
    if (typeof text !== 'string') return null;
    const value = text.trim();
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
      || el.matches?.('[data-lexical-editor="true"], .ProseMirror');
  }

  function editableFromEventTarget(target) {
    if (isEditable(target)) return target;
    return target instanceof Element
      ? target.closest('textarea,input[type="text"],input[type="search"],input[type="url"],[contenteditable="true"],[data-lexical-editor="true"],.ProseMirror')
      : null;
  }

  function editorText(editor) {
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) return editor.value || '';
    return editor.innerText || editor.textContent || '';
  }

  function nativeValueSetter(editor, value) {
    const proto = editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(editor, value);
    else editor.value = value;
  }

  function setEditorText(editor, value) {
    if (!editor?.isConnected) return false;
    editor.focus();
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      nativeValueSetter(editor, value);
    } else {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection?.removeAllRanges();
      selection?.addRange(range);
      let inserted = false;
      try { inserted = Boolean(document.execCommand?.('insertText', false, value)); } catch { inserted = false; }
      if (!inserted) {
        range.deleteContents();
        range.insertNode(document.createTextNode(value));
      }
    }
    editor.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertText',
      data: value,
    }));
    editor.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return true;
  }

  function controlMeta(el) {
    return {
      tagName: el?.tagName,
      type: el?.getAttribute?.('type') || el?.type,
      ariaLabel: el?.getAttribute?.('aria-label'),
      title: el?.getAttribute?.('title'),
      textContent: el?.textContent,
      dataTestId: el?.getAttribute?.('data-testid'),
      name: el?.getAttribute?.('name'),
    };
  }

  function looksLikeSend(el) {
    if (!(el instanceof Element)) return false;
    const button = el.closest('button,[role="button"],input[type="submit"]');
    if (!button) return false;
    const meta = controlMeta(button);
    if (String(meta.tagName).toLowerCase() === 'button' && String(meta.type).toLowerCase() === 'submit') return true;
    return /(^|\b)(send|submit|ask|发送|送出|提交|提问|发送消息|send message)(\b|$)/i.test(
      [meta.ariaLabel, meta.title, meta.textContent, meta.dataTestId, meta.name].filter(Boolean).join(' '),
    );
  }

  function looksLikeAttachment(el) {
    const meta = controlMeta(el);
    return /(attach|upload|file|附件|上传|文件)/i.test(
      [meta.ariaLabel, meta.title, meta.textContent, meta.dataTestId, meta.name].filter(Boolean).join(' '),
    );
  }

  function findEditorNear(control) {
    const scope = control?.closest?.('form') || control?.parentElement?.parentElement || document;
    const candidates = [...scope.querySelectorAll('textarea,input[type="text"],input[type="search"],input[type="url"],[contenteditable="true"],[data-lexical-editor="true"],.ProseMirror')];
    return candidates.reverse().find(isEditable) || [...document.querySelectorAll('textarea,[contenteditable="true"],[data-lexical-editor="true"],.ProseMirror')].reverse().find(isEditable) || null;
  }

  function findSendButton(editor) {
    const scope = editor.closest?.('form') || editor.parentElement?.parentElement?.parentElement || document;
    const controls = [...scope.querySelectorAll('button,[role="button"],input[type="submit"]')];
    return controls.find((el) => looksLikeSend(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true')
      || [...document.querySelectorAll('button,[role="button"],input[type="submit"]')].find((el) => looksLikeSend(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true')
      || null;
  }

  function isLikelyComposer(editor) {
    if (editor instanceof HTMLTextAreaElement) return true;
    if (editor.isContentEditable || editor.getAttribute?.('contenteditable') === 'true'
      || editor.matches?.('[data-lexical-editor="true"], .ProseMirror')) return true;
    return Boolean(findSendButton(editor));
  }

  function showToast(message, error = false) {
    let toast = document.getElementById('__link2context_toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = '__link2context_toast';
      Object.assign(toast.style, {
        position: 'fixed', right: '18px', bottom: '18px', zIndex: '2147483647',
        maxWidth: '420px', padding: '10px 14px', borderRadius: '10px',
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

  function reportLocalProgress(stage, label, detail = '', extra = {}) {
    try {
      globalThis.__link2contextReportProgress?.({
        stage, label, detail,
        state: extra.state || 'running',
        level: extra.level || '',
        log: extra.log || label,
        code: extra.code || '',
        errorStage: extra.errorStage || '',
      });
    } catch { /* diagnostics must never break page handoff */ }
  }

  function failureLabel(stage) {
    const labels = {
      FETCH: '获取失败 / Fetch failed',
      AUTH: '需要登录或授权 / Authentication required',
      TYPE: '类型识别失败 / Content type failed',
      RENDER: '页面正文不可用 / Rendered content unavailable',
      PARSE: '内容解析失败 / Parse failed',
      HANDOFF: '页面交付失败 / Page handoff failed',
      PIPELINE: '处理失败 / Processing failed',
    };
    return labels[String(stage || '').toUpperCase()] || labels.PIPELINE;
  }

  function base64ToFile(base64, fileName, mime) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], fileName, { type: mime || 'application/octet-stream' });
  }

  function inputAccepts(input, fileName, mime) {
    const spec = String(input?.getAttribute?.('accept') || '').trim().toLowerCase();
    if (!spec) return true;
    const name = String(fileName || '').toLowerCase();
    const type = String(mime || '').toLowerCase().split(';', 1)[0];
    return spec.split(',').map((x) => x.trim()).filter(Boolean).some((rule) => {
      if (rule.startsWith('.')) return name.endsWith(rule);
      if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
      return rule === type;
    });
  }

  function candidateFileInput(scope, fileName, mime) {
    return [...scope.querySelectorAll('input[type="file"]')].find((input) => inputAccepts(input, fileName, mime)) || null;
  }

  async function findOrRevealFileInput(editor, fileName, mime) {
    const scope = editor.closest?.('form') || editor.parentElement?.parentElement?.parentElement || document;
    let input = candidateFileInput(scope, fileName, mime);
    if (input) return input;
    const controls = [...scope.querySelectorAll('button,[role="button"],[aria-label],[title]')];
    const attach = controls.find(looksLikeAttachment);
    if (attach) {
      attach.click();
      await new Promise((resolve) => setTimeout(resolve, 350));
      input = candidateFileInput(scope, fileName, mime) || candidateFileInput(document, fileName, mime);
    }
    return input || candidateFileInput(document, fileName, mime);
  }

  async function waitForAttachmentReady(editor, fileName, timeoutMs = 15_000) {
    const scope = editor.closest?.('form') || editor.parentElement?.parentElement?.parentElement || document;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const text = scope.textContent || '';
      if (fileName && text.includes(fileName)) return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  }

  async function attachBinary(result, editor) {
    const input = await findOrRevealFileInput(editor, result.fileName, result.mime);
    if (!input) throw new Error('找不到兼容该文件类型的网页 AI 附件入口 / No compatible attachment input found');
    const file = base64ToFile(result.base64, result.fileName, result.mime);
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    const ready = await waitForAttachmentReady(editor, result.fileName);
    if (!ready) throw new Error('附件未在网页 AI 中确认登记，已停止自动发送 / Attachment was not confirmed by the web AI; auto-send stopped');
  }

  async function waitForSendButton(editor, timeoutMs = 20_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const button = findSendButton(editor);
      if (button) return button;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  }

  async function submitChanged(editor, beforeText, waitMs = 650) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    if (!editor.isConnected) return true;
    const after = editorText(editor).trim();
    return !after || after !== beforeText.trim();
  }

  async function submit(editor, preferredButton) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    const beforeText = editorText(editor);
    const button = preferredButton?.isConnected && !preferredButton.disabled && preferredButton.getAttribute('aria-disabled') !== 'true'
      ? preferredButton
      : await waitForSendButton(editor, 3000);
    if (button) {
      button.click();
      if (await submitChanged(editor, beforeText)) return true;
    }
    const form = editor.closest?.('form');
    if (form?.requestSubmit) {
      try { form.requestSubmit(); } catch { /* continue */ }
      if (await submitChanged(editor, beforeText)) return true;
    }
    return false;
  }

  function restoreFailedJob(job, message) {
    if (job.editor?.isConnected && editorText(job.editor).includes(PLACEHOLDER)) setEditorText(job.editor, job.url);
    showToast(`Link2Context：${message}`, true);
  }

  async function startJob(editor, url, { autoSubmit = false, submitter = null } = {}) {
    const existing = jobByEditor.get(editor);
    if (existing?.busy) {
      if (autoSubmit) {
        existing.autoSubmit = true;
        existing.submitter = submitter || existing.submitter;
      }
      return existing.promise;
    }

    const job = { editor, url, busy: true, autoSubmit, submitter };
    jobByEditor.set(editor, job);
    setEditorText(editor, PLACEHOLDER);
    showToast('Link2Context 正在读取链接…');

    job.promise = new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'L2C_RESOLVE_URL', url, userGesture: true }, async (result) => {
        try {
          if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message);
          if (!result?.ok) {
            const failure = new Error(result?.error || '链接读取失败 / Failed to read link');
            failure.l2cStage = result?.errorStage || 'PIPELINE';
            failure.l2cCode = result?.errorCode || 'PIPELINE_ERROR';
            throw failure;
          }
          if (!editor.isConnected) throw new Error('输入框已被页面替换，请重新发送链接 / Composer was replaced');

          reportLocalProgress('handoff-received', '后台处理完成，开始交给当前网页 AI / Starting page handoff', `目标 / Target: ${result.targetHost || location.hostname}；方式 / Mode: ${result.handoffMode || (result.kind === 'binary' ? 'attachment' : 'text')}；原因 / Reason: ${result.handoffReason || 'binary-or-default'}`);

          if (result.kind === 'binary') {
            reportLocalProgress('attachment-start', '正在上传附件 / Uploading attachment', `${result.fileName} · ${result.mime || 'application/octet-stream'} · ${result.resourceKind || 'binary'}`);
            await attachBinary(result, editor);
            reportLocalProgress('attachment-confirmed', '附件已在网页 AI 中登记 / Attachment confirmed', `已确认 / Confirmed: ${result.fileName}`);
            if (!setEditorText(editor, result.note)) throw new Error('无法写入附件说明 / Could not write attachment note');
            showToast(`Link2Context 已附加 ${result.fileName}`);
            await new Promise((r) => setTimeout(r, 350));
          } else {
            reportLocalProgress('inline-inject', '正在写入输入框 / Injecting text into composer', `${String(result.payload || '').length.toLocaleString()} chars`);
            if (!setEditorText(editor, result.payload)) throw new Error('无法写入网页 AI 输入框 / Could not inject the web-AI composer');
            reportLocalProgress('inline-confirmed', '文本已写入当前消息 / Inline context prepared', '等待发送 / Waiting to send.');
            showToast('Link2Context 已把链接内容放进当前消息');
          }

          if (job.autoSubmit) {
            reportLocalProgress('send-attempt', '正在发送 / Sending', '已完成内容交付，正在触发当前网页 AI 的发送动作。');
            const sent = await submit(editor, job.submitter);
            if (!sent) {
              const detail = '内容已准备好，但未确认网页 AI 已发送；请手动再按一次发送。 / Content is ready, but send could not be confirmed.';
              reportLocalProgress('send-unconfirmed', '未确认发送 / Send not confirmed', detail, { state: 'error', code: 'SEND_UNCONFIRMED', errorStage: 'HANDOFF' });
              showToast('内容已准备好，但未识别发送按钮；请再按一次发送。', true);
            } else {
              reportLocalProgress('sent', '已完成并发送 / Handoff complete and sent', `目标 / Target: ${result.targetHost || location.hostname}`, { state: 'success' });
            }
          } else {
            reportLocalProgress('ready-in-composer', '内容已准备好 / Ready in composer', 'Link2Context 已完成抓取、清洗和页面交付。', { state: 'success' });
          }
          resolve(true);
        } catch (error) {
          const message = String(error?.message || error);
          const errorStage = String(error?.l2cStage || 'HANDOFF').toUpperCase();
          const errorCode = String(error?.l2cCode || 'HANDOFF_ERROR');
          const detail = `[${errorCode}] ${message}`;
          reportLocalProgress(`error-${errorStage.toLowerCase()}`, failureLabel(errorStage), detail, {
            state: 'error', code: errorCode, errorStage,
          });
          restoreFailedJob(job, message);
          resolve(false);
        } finally {
          job.busy = false;
          if (jobByEditor.get(editor) === job) jobByEditor.delete(editor);
        }
      });
    });
    return job.promise;
  }

  function stopEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  document.addEventListener('paste', (event) => {
    if (!siteEnabled || !event.isTrusted) return;
    const editor = editableFromEventTarget(event.target);
    if (!editor || !isLikelyComposer(editor) || editorText(editor).trim()) return;
    const url = singleUrl(event.clipboardData?.getData('text/plain') || '');
    if (!url) return;
    stopEvent(event);
    startJob(editor, url);
  }, true);

  document.addEventListener('keydown', (event) => {
    if (!siteEnabled || !event.isTrusted || event.isComposing || event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    const editor = editableFromEventTarget(event.target);
    if (!editor) return;
    const existing = jobByEditor.get(editor);
    if (existing?.busy) {
      stopEvent(event);
      existing.autoSubmit = true;
      return;
    }
    const url = singleUrl(editorText(editor));
    if (!url) return;
    stopEvent(event);
    startJob(editor, url, { autoSubmit: true });
  }, true);

  document.addEventListener('click', (event) => {
    if (!siteEnabled || !event.isTrusted || !looksLikeSend(event.target)) return;
    const button = event.target.closest?.('button,[role="button"],input[type="submit"]') || event.target;
    const editor = findEditorNear(button);
    if (!editor) return;
    const existing = jobByEditor.get(editor);
    if (existing?.busy) {
      stopEvent(event);
      existing.autoSubmit = true;
      existing.submitter = button;
      return;
    }
    const url = singleUrl(editorText(editor));
    if (!url) return;
    stopEvent(event);
    startJob(editor, url, { autoSubmit: true, submitter: button });
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