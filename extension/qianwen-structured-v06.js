(() => {
  'use strict';

  const host = location.hostname.toLowerCase();
  const managed = host === 'qianwen.com' || host.endsWith('.qianwen.com')
    || host === 'qwenwork.cn' || host.endsWith('.qwenwork.cn');
  if (!managed) return;

  const deliveryApi = globalThis.Link2ContextDelivery;
  const DELIVERY_KEY = deliveryApi?.STORAGE_KEY || 'handoffPreference';
  const SEND_KEY = deliveryApi?.SEND_STORAGE_KEY || 'sendPreference';
  const MAX_INLINE_CHARS = 180_000;
  const OWNED_UI = '#__link2context_progress_root,#__link2context_toast';
  let activeJob = null;

  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  function singleUrl(value) {
    const text = String(value || '').trim();
    if (!text || text.length > 8192 || /\s/.test(text)) return null;
    try {
      const url = new URL(text);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      return url.href;
    } catch { return null; }
  }

  function visible(el) {
    if (!(el instanceof Element) || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
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

  function currentComposer(preferred = null) {
    if (preferred?.isConnected && isEditable(preferred) && visible(preferred)) return preferred;
    const editors = [...document.querySelectorAll(
      'textarea,input[type="text"],input[type="search"],input[type="url"],[contenteditable="true"],[role="textbox"],[data-lexical-editor="true"],.ProseMirror',
    )].filter((el) => isEditable(el) && visible(el));
    return editors.at(-1) || null;
  }

  function editorText(editor) {
    if (!editor) return '';
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) return editor.value || '';
    return editor.innerText || editor.textContent || '';
  }

  function composerScope(editor) {
    return editor?.closest?.('form')
      || editor?.closest?.('[data-testid*="composer"],[class*="composer"],[class*="input-area"],[class*="chat-input"],[class*="prompt"]')
      || editor?.parentElement?.parentElement?.parentElement || document;
  }

  function attachmentScope(editor) {
    const scope = composerScope(editor);
    if (scope !== document) return scope;
    return editor?.parentElement || null;
  }

  function stopEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  function report(stage, label, detail = '', extra = {}) {
    try {
      globalThis.__link2contextReportProgress?.({
        stage, label, detail, state: extra.state || 'running', level: extra.level || '',
        log: extra.log || label, code: extra.code || '', errorStage: extra.errorStage || '',
        startedAt: Number(extra.startedAt) || activeJob?.startedAt || Date.now(),
      });
    } catch { /* ignore */ }
  }

  function showToast(message, error = false) {
    let toast = document.getElementById('__link2context_toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = '__link2context_toast';
      Object.assign(toast.style, {
        position: 'fixed', right: '18px', bottom: '18px', zIndex: '2147483647', maxWidth: '480px',
        padding: '10px 14px', borderRadius: '10px', background: 'rgba(20,20,20,.94)', color: 'white',
        fontSize: '13px', boxShadow: '0 4px 20px rgba(0,0,0,.25)', pointerEvents: 'none',
      });
      document.documentElement.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.outline = error ? '2px solid #d33' : 'none';
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.remove(), error ? 8500 : 4200);
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

  function message(type, payload = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, ...payload }, (response) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(response);
      });
    });
  }

  async function resolveUrl(url, startedAt) {
    let result = await message('L2C_RESOLVE_URL_V06', { url, userGesture: true, startedAt });
    if (result?.ok && result.fallbackToLegacy) {
      report('v06-legacy-fallback', 'V0.6 保留已验证旧路径 / Using proven legacy path', result.reason || '', { level: 'warn' });
      result = await message('L2C_RESOLVE_URL', { url, userGesture: true, startedAt });
      if (result?.ok) result.v06LegacyFallback = true;
    }
    return result;
  }

  async function preference() {
    try {
      const data = await chrome.storage.local.get([DELIVERY_KEY, SEND_KEY]);
      return {
        delivery: deliveryApi?.normalizeMode?.(data[DELIVERY_KEY]) || data[DELIVERY_KEY] || 'auto',
        autoSend: (deliveryApi?.normalizeSendMode?.(data[SEND_KEY]) || data[SEND_KEY]) === 'auto',
      };
    } catch { return { delivery: 'auto', autoSend: false }; }
  }

  function base64ToBytes(base64) {
    const raw = atob(String(base64 || ''));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  function asFile(value, fallback = 'link2context-file') {
    return new File([base64ToBytes(value.base64)], value.fileName || fallback, { type: value.mime || 'application/octet-stream' });
  }

  function selectContents(editor) {
    editor.focus();
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

  async function cdp(action, text = '') {
    const response = await message('L2C_QIANWEN_CDP', { action, text, userGesture: true });
    if (!response?.ok) {
      const error = new Error(response?.error || 'Qianwen CDP command failed / 千问 CDP 命令失败');
      error.l2cCode = response?.errorCode || 'QIANWEN_DEBUGGER_FAILED';
      throw error;
    }
    return response;
  }

  function textSignature(text) {
    const value = normalize(text);
    if (!value) return [];
    if (value.length <= 120) return [value];
    return [value.slice(0, 56), value.slice(-56)];
  }

  async function writeText(editor, text, job) {
    assertActive(job);
    if (!editor?.isConnected || !text || text.length > MAX_INLINE_CHARS || !selectContents(editor)) return null;
    await cdp('insertText', text);
    await sleep(260, job);
    let current = currentComposer(editor);
    const parts = textSignature(text);
    if (!parts.length || !parts.every((part) => normalize(editorText(current)).includes(part))) return null;
    try { current.blur(); } catch { /* ignore */ }
    await sleep(100, job);
    try { current.focus(); } catch { /* ignore */ }
    await sleep(180, job);
    current = currentComposer(current || editor);
    if (!parts.every((part) => normalize(editorText(current)).includes(part))) return null;
    return { editor: current, signature: parts };
  }

  function controlText(el) {
    if (!(el instanceof Element)) return '';
    return normalize([el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent, el.getAttribute('data-testid')].filter(Boolean).join(' '));
  }

  function inputAccepts(input, file) {
    const spec = String(input?.getAttribute?.('accept') || '').trim().toLowerCase();
    if (!spec) return true;
    const type = String(file.type || '').toLowerCase().split(';', 1)[0];
    const name = file.name.toLowerCase();
    return spec.split(',').map((item) => item.trim()).filter(Boolean).some((rule) => {
      if (rule.startsWith('.')) return name.endsWith(rule);
      if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
      return rule === type;
    });
  }

  function usableFileInput(input, file) {
    return Boolean(input) && !input.disabled && input.getAttribute?.('aria-disabled') !== 'true' && inputAccepts(input, file);
  }

  function attachmentScore(el, file) {
    const text = controlText(el);
    let score = 0;
    if (/(attach|attachment|附件)/i.test(text)) score += 12;
    if (/(file|document|文件|文档)/i.test(text)) score += 8;
    if (/(upload|上传)/i.test(text)) score += 6;
    if (file.type.startsWith('image/') && /(image|photo|图片|照片)/i.test(text)) score += 5;
    if (!file.type.startsWith('image/') && /(image|photo|camera|图片|照片|相机)/i.test(text)) score -= 6;
    if (/^(\+|add|more|添加|更多|添加内容|更多功能)$/i.test(text)) score += 2;
    return score;
  }

  function safeAttachmentControl(el) {
    if (!(el instanceof Element) || !visible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    const nativeType = String(el.type || el.getAttribute('type') || '').toLowerCase();
    if (nativeType === 'submit') return false;
    return true;
  }

  function fileInput(editor, file, baseline = null) {
    const scope = attachmentScope(editor);
    if (scope) {
      const local = [...scope.querySelectorAll('input[type="file"]')]
        .find((input) => !input.disabled && input.getAttribute('aria-disabled') !== 'true' && inputAccepts(input, file));
      if (local) return local;
    }
    if (!baseline) return null;
    return [...document.querySelectorAll('input[type="file"]')]
      .find((input) => !baseline.has(input) && !input.disabled && input.getAttribute('aria-disabled') !== 'true' && inputAccepts(input, file)) || null;
  }

  async function revealInput(editor, file, job) {
    let input = fileInput(editor, file);
    if (input) return input;
    const scope = attachmentScope(editor);
    if (!scope) return null;
    const baseline = new Set(document.querySelectorAll('input[type="file"]'));
    const controls = [...scope.querySelectorAll('button,[role="button"],[role="menuitem"],[aria-label],[title]')]
      .filter((el) => safeAttachmentControl(el))
      .map((el) => ({ el, score: attachmentScore(el, file) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
    if (!controls[0]) return null;
    controls[0].el.click();
    await sleep(420, job);
    return fileInput(editor, file, baseline);
  }

  function filenameVisible(name, editor) {
    const scope = attachmentScope(editor);
    if (!scope) return false;
    const text = normalize(scope.innerText || scope.textContent || '').toLowerCase();
    const value = normalize(name);
    const stem = value.replace(/\.[^.]+$/, '');
    return [value, stem, stem.slice(0, 24)].filter((item) => item.length >= 7).some((item) => text.includes(item.toLowerCase()));
  }

  async function attachFile(file, editor, job) {
    const input = await revealInput(editor, file, job);
    if (!usableFileInput(input, file)) return false;
    const filenameWasVisible = filenameVisible(file.name, editor);
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      assertActive(job);
      if (!filenameWasVisible && filenameVisible(file.name, editor)) return true;
      await sleep(250, job);
    }
    return false;
  }

  function generatingEvidence() {
    return [...document.querySelectorAll('button,[role="button"],[aria-label],[title],[aria-busy="true"]')].some((el) => {
      if (!visible(el)) return false;
      const text = controlText(el);
      return el.getAttribute('aria-busy') === 'true' || /(^|\b)(stop generating|stop|停止生成|停止回答|停止)(\b|$)/i.test(text);
    });
  }

  function bodyWithoutComposer() {
    try {
      const clone = document.body?.cloneNode(true);
      if (!(clone instanceof Element)) return '';
      for (const item of clone.querySelectorAll(`${OWNED_UI},[contenteditable="true"],[role="textbox"],[data-lexical-editor="true"],.ProseMirror,textarea,input[type="text"],input[type="search"],input[type="url"]`)) item.remove();
      return normalize(clone.innerText || clone.textContent || '');
    } catch { return ''; }
  }

  async function submit(editor, parts, job) {
    const before = normalize(editorText(currentComposer(editor) || editor));
    await cdp('pressEnter');
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      assertActive(job);
      await sleep(180, job);
      if (generatingEvidence()) return true;
      const current = currentComposer(editor);
      const after = normalize(editorText(current));
      if (parts.length && parts.every((part) => bodyWithoutComposer().includes(part)) && after !== before) return true;
    }
    return false;
  }

  async function primary(result, pref) {
    const originalBinary = result.kind === 'binary' && !result.convertedFromText;
    if (originalBinary) return { mode: 'attachment', file: asFile(result), text: '' };
    const payload = String(result.payload || (result.convertedFromText && result.base64
      ? new TextDecoder().decode(base64ToBytes(result.base64)) : ''));
    if (pref.delivery === 'document' && payload) {
      return { mode: 'document', file: new File([payload], deliveryApi?.contextFileName?.(result.sourceUrl) || 'link2context-context.md', { type: 'text/markdown' }), text: '' };
    }
    if (pref.delivery === 'text' && payload && payload.length <= MAX_INLINE_CHARS) return { mode: 'text', text: payload };
    if ((result.handoffMode === 'document' || result.handoffMode === 'document+assets' || payload.length > MAX_INLINE_CHARS) && result.base64) {
      return { mode: 'document', file: asFile(result, 'link2context-context-v06.md'), text: '' };
    }
    if (payload && payload.length <= MAX_INLINE_CHARS) return { mode: 'text', text: payload };
    if (result.base64) return { mode: 'document', file: asFile(result, 'link2context-context-v06.md'), text: '' };
    return { mode: 'none', text: '' };
  }

  async function start(editor, url) {
    if (activeJob?.busy) {
      showToast('Link2Context 已有千问任务在处理，请等待或先 STOP。', true);
      return false;
    }
    const pref = await preference();
    const job = { editor, url, busy: true, cancelled: false, autoSubmit: pref.autoSend, startedAt: Date.now() };
    activeJob = job;
    try {
      report('v06-qianwen-start', 'V0.6 千问结构化交付 / Qianwen structured handoff', '文本仍走已实测 CDP 真输入，图片与文件走附件。');
      const result = await resolveUrl(url, job.startedAt);
      assertActive(job);
      if (!result?.ok) {
        const error = new Error(result?.error || '链接读取失败 / Failed to read link');
        error.l2cCode = result?.errorCode || 'PIPELINE_ERROR';
        throw error;
      }

      const upstreamPartial = Boolean(result.partial || result.sourcePartial || result.mediaPartial);
      if (upstreamPartial) {
        job.autoSubmit = false;
        report('v06-qianwen-upstream-partial', '源内容只取得部分，已禁用自动发送 / Source context is partial; auto-send disabled',
          (Array.isArray(result.partialReasons) ? result.partialReasons.join('; ') : '') || 'partial context', {
            level: 'warn', code: 'UPSTREAM_PARTIAL', errorStage: 'HANDOFF',
          });
      }

      const main = await primary(result, pref);
      const assets = Array.isArray(result.assets) ? result.assets : [];
      let attached = 0;
      const failedAssets = [];
      for (const asset of assets) {
        const file = asFile(asset, 'web-image');
        if (await attachFile(file, currentComposer(editor) || editor, job)) attached += 1;
        else failedAssets.push(file.name);
      }
      if (failedAssets.length) {
        job.autoSubmit = false;
        report('v06-qianwen-media-partial', '部分图片未能交付，禁止自动发送 / Some media failed; auto-send disabled', failedAssets.join(', '), {
          level: 'warn', code: 'MEDIA_HANDOFF_PARTIAL', errorStage: 'HANDOFF',
        });
      }

      let proof = null;
      if (main.mode === 'attachment' || main.mode === 'document') {
        if (!main.file || !(await attachFile(main.file, currentComposer(editor) || editor, job))) {
          const error = new Error('千问没有确认主文件进入输入区 / Qianwen did not confirm the primary attachment');
          error.l2cCode = 'QIANWEN_PRIMARY_ATTACHMENT_UNCONFIRMED';
          throw error;
        }
      } else if (main.mode === 'text') {
        proof = await writeText(currentComposer(editor) || editor, main.text, job);
        if (!proof) {
          const error = new Error('千问没有保留完整结构化文本状态 / Qianwen did not preserve the structured text state');
          error.l2cCode = 'QIANWEN_CDP_STATE_UNCONFIRMED';
          throw error;
        }
      } else {
        throw Object.assign(new Error('没有可交付内容 / No deliverable context'), { l2cCode: 'NO_DELIVERABLE_CONTEXT' });
      }

      if (job.autoSubmit) {
        const sent = await submit(proof?.editor || currentComposer(editor) || editor, proof?.signature || [], job);
        if (!sent) {
          const error = new Error('千问真实 Enter 已执行，但没有取得发送成功证据 / Enter executed but send was not confirmed');
          error.l2cCode = 'SEND_UNCONFIRMED';
          throw error;
        }
        report('sent', '千问 V0.6 已发送 / Qianwen V0.6 sent', `正文媒体=${attached}`, { state: 'success' });
        showToast('Link2Context：千问 V0.6 内容已发送。');
      } else if (failedAssets.length || upstreamPartial) {
        report('ready-partial', '千问内容已部分准备，等待手动确认 / Partial Qianwen context ready for manual review',
          `upstreamPartial=${upstreamPartial}; failedAssets=${failedAssets.length}`, { state: 'success', level: 'warn', code: 'PARTIAL_READY' });
        showToast(`Link2Context：千问内容已准备，但存在信息缺失（源内容部分=${upstreamPartial ? '是' : '否'}，附件失败=${failedAssets.length}）；请检查后手动发送。`, true);
      } else {
        report('ready-in-composer', '千问 V0.6 内容已准备 / Qianwen V0.6 ready', `关键图片=${attached}`, { state: 'success' });
        showToast(attached ? `Link2Context：正文和 ${attached} 张关键图片已准备。` : 'Link2Context：千问结构化上下文已准备。');
      }
      return true;
    } catch (error) {
      const code = String(error?.l2cCode || 'HANDOFF_ERROR');
      if (code === 'USER_CANCELLED' || job.cancelled) {
        report('cancelled', '已停止 / Stopped', 'V0.6 千问任务已停止。', { state: 'success', code: 'USER_CANCELLED' });
        showToast('Link2Context：已停止当前千问任务。');
        return false;
      }
      report('v06-qianwen-error', '千问 V0.6 交付失败 / Qianwen V0.6 failed', `[${code}] ${String(error?.message || error)}`, {
        state: 'error', code, errorStage: 'HANDOFF',
      });
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
    const startedAt = activeJob.startedAt;
    message('L2C_CANCEL_JOB_V06', { startedAt }).catch(() => {});
    message('L2C_CANCEL_JOB', { startedAt }).catch(() => {});
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
    const editor = currentComposer();
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