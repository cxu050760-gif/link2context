(() => {
  'use strict';

  const host = location.hostname.toLowerCase();
  const isQianwen = host === 'qianwen.com' || host.endsWith('.qianwen.com')
    || host === 'qwenwork.cn' || host.endsWith('.qwenwork.cn');
  if (isQianwen) return;

  const deliveryApi = globalThis.Link2ContextDelivery;
  const DELIVERY_KEY = deliveryApi?.STORAGE_KEY || 'handoffPreference';
  const SEND_KEY = deliveryApi?.SEND_STORAGE_KEY || 'sendPreference';
  const TEXT_HARD_LIMIT = deliveryApi?.TEXT_HARD_LIMIT_CHARS || 250_000;
  const OWNED_UI = '#__link2context_progress_root,#__link2context_toast';
  const STRONG_TARGETS = ['chatgpt.com', 'chat.deepseek.com', 'doubao.com'];
  let activeJob = null;
  let siteEnabled = STRONG_TARGETS.some((known) => host === known || host.endsWith(`.${known}`));

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

  function isEditable(el) {
    if (!(el instanceof Element)) return false;
    if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
    if (el instanceof HTMLInputElement) return /^(text|search|url)$/i.test(el.type) && !el.disabled && !el.readOnly;
    return el.isContentEditable || el.getAttribute('contenteditable') === 'true'
      || el.getAttribute('role') === 'textbox' || el.matches?.('[data-lexical-editor="true"],.ProseMirror');
  }

  function visible(el) {
    if (!(el instanceof Element) || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function editorFromTarget(target) {
    if (isEditable(target)) return target;
    return target instanceof Element
      ? target.closest('textarea,input[type="text"],input[type="search"],input[type="url"],[contenteditable="true"],[role="textbox"],[data-lexical-editor="true"],.ProseMirror')
      : null;
  }

  function currentComposer(preferred = null) {
    if (preferred?.isConnected && isEditable(preferred) && visible(preferred)) return preferred;
    const candidates = [...document.querySelectorAll(
      'textarea,input[type="text"],input[type="search"],input[type="url"],[contenteditable="true"],[role="textbox"],[data-lexical-editor="true"],.ProseMirror',
    )].filter((el) => isEditable(el) && visible(el));
    return candidates.at(-1) || null;
  }

  function editorText(editor) {
    if (!editor) return '';
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) return editor.value || '';
    return editor.innerText || editor.textContent || '';
  }

  function composerScope(editor) {
    return editor?.closest?.('form')
      || editor?.closest?.('[data-testid*="composer"],[class*="composer"],[class*="input-area"],[class*="chat-input"],[class*="prompt"],[class*="send"]')
      || editor?.parentElement?.parentElement?.parentElement
      || document;
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
    showToast.timer = setTimeout(() => toast.remove(), error ? 8000 : 4000);
  }

  function report(stage, label, detail = '', extra = {}) {
    try {
      globalThis.__link2contextReportProgress?.({
        stage, label, detail, state: extra.state || 'running', level: extra.level || '',
        log: extra.log || label, code: extra.code || '', errorStage: extra.errorStage || '',
        startedAt: Number(extra.startedAt) || activeJob?.startedAt || Date.now(),
      });
    } catch { /* UI must not break handoff */ }
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
      report('v06-legacy-fallback', 'V0.6 保留已验证旧路径 / Using proven legacy path', result.reason || 'legacy fallback', { level: 'warn' });
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

  function fileFromAsset(asset) {
    return new File([base64ToBytes(asset.base64)], asset.fileName || 'link2context-asset', { type: asset.mime || 'application/octet-stream' });
  }

  function originalFile(result) {
    return new File([base64ToBytes(result.base64)], result.fileName || 'link2context-file', { type: result.mime || 'application/octet-stream' });
  }

  function selectEditorContents(editor) {
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

  function nativeValueSetter(editor, value) {
    const proto = editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(editor, value);
    else editor.value = value;
  }

  function dispatchInput(editor, value) {
    try {
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true, composed: true, inputType: value ? 'insertText' : 'deleteContentBackward', data: value || null,
      }));
    } catch { editor.dispatchEvent(new Event('input', { bubbles: true, composed: true })); }
    editor.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  function signature(text) {
    const value = normalize(text);
    if (value.length < 12) return value ? [value] : [];
    if (value.length <= 120) return [value];
    return [value.slice(0, 56), value.slice(-56)];
  }

  async function writeText(editor, value, job) {
    assertActive(job);
    if (!editor?.isConnected || !value) return null;
    editor.focus();
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      nativeValueSetter(editor, value);
      dispatchInput(editor, value);
    } else {
      if (!selectEditorContents(editor)) return null;
      const inserted = Boolean(document.execCommand?.('insertText', false, value));
      if (!inserted) return null;
    }
    await sleep(180, job);
    let current = currentComposer(editor);
    const parts = signature(value);
    if (!parts.length || !parts.every((part) => normalize(editorText(current)).includes(part))) return null;
    try { current.blur(); } catch { /* ignore */ }
    await sleep(80, job);
    try { current.focus(); } catch { /* ignore */ }
    await sleep(160, job);
    current = currentComposer(current || editor);
    if (!parts.every((part) => normalize(editorText(current)).includes(part))) return null;
    return { editor: current, signature: parts };
  }

  function controlText(el) {
    if (!(el instanceof Element)) return '';
    return normalize([
      el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent,
      el.getAttribute('data-testid'), el.getAttribute('data-test-id'), el.getAttribute('name'),
    ].filter(Boolean).join(' '));
  }

  function inputAccepts(input, file) {
    const spec = String(input?.getAttribute?.('accept') || '').trim().toLowerCase();
    if (!spec) return true;
    const name = file.name.toLowerCase();
    const type = String(file.type || '').toLowerCase().split(';', 1)[0];
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
    const value = controlText(el);
    let score = 0;
    if (/(attach|attachment|附件)/i.test(value)) score += 12;
    if (/(file|document|文件|文档)/i.test(value)) score += 8;
    if (/(upload|上传)/i.test(value)) score += 6;
    if (file?.type?.startsWith('image/') && /(image|photo|图片|照片)/i.test(value)) score += 5;
    if (!file?.type?.startsWith('image/') && /(image|photo|camera|图片|照片|相机)/i.test(value)) score -= 7;
    if (/^(\+|add|more|添加|更多|添加内容|更多功能)$/i.test(value)) score += 2;
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

  async function revealFileInput(editor, file, job) {
    let input = fileInput(editor, file);
    if (input) return input;
    const scope = attachmentScope(editor);
    if (!scope) return null;
    const baseline = new Set(document.querySelectorAll('input[type="file"]'));
    const candidates = [...scope.querySelectorAll('button,[role="button"],[role="menuitem"],[aria-label],[title]')]
      .filter((el) => safeAttachmentControl(el))
      .map((el) => ({ el, score: attachmentScore(el, file) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
    if (!candidates[0]) return null;
    candidates[0].el.click();
    await sleep(400, job);
    input = fileInput(editor, file, baseline);
    return input;
  }

  function filenameHints(name) {
    const value = normalize(name);
    const dot = value.lastIndexOf('.');
    const stem = dot > 0 ? value.slice(0, dot) : value;
    return [...new Set([value, stem, stem.slice(0, 24)].filter((item) => item.length >= 7))];
  }

  function filenameVisible(name, editor) {
    const scope = attachmentScope(editor);
    if (!scope) return false;
    const text = normalize(scope.innerText || scope.textContent || '').toLowerCase();
    return filenameHints(name).some((hint) => text.includes(hint.toLowerCase()));
  }

  async function attachFile(file, editor, job) {
    assertActive(job);
    const input = await revealFileInput(editor, file, job);
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

  function sendScore(el, editor) {
    if (!(el instanceof Element) || !visible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') return -Infinity;
    const text = controlText(el);
    if (/(stop|cancel|attach|upload|image|photo|camera|voice|mic|record|search|tool|停止|取消|附件|上传|图片|相机|语音|麦克风|搜索|工具)/i.test(text)) return -Infinity;
    let score = 0;
    if (host === 'chatgpt.com' || host.endsWith('.chatgpt.com')) {
      if (el.matches?.('[data-testid="send-button"]')) score += 100;
      if (/(send prompt|send message)/i.test(text)) score += 35;
    }
    if (/^(send|ask|发送|提问|发送消息)$/i.test(text)) score += 30;
    if (/(send|submit)/i.test(el.getAttribute('data-testid') || '')) score += 22;
    if (el.matches?.('button,input[type="submit"]') && String(el.getAttribute('type')).toLowerCase() === 'submit') score += 15;
    const scope = composerScope(editor);
    if (scope !== document && scope.contains(el)) score += 8;
    if (el.querySelector?.('svg')) score += 2;
    return score;
  }

  function sendButton(editor) {
    const scope = composerScope(editor);
    if (scope === document) return null;
    return [...scope.querySelectorAll('button,[role="button"],input[type="submit"],[data-testid]')]
      .map((el) => ({ el, score: sendScore(el, editor) }))
      .filter((item) => item.score >= 10)
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

  function bodyWithoutComposer() {
    try {
      const clone = document.body?.cloneNode(true);
      if (!(clone instanceof Element)) return '';
      for (const item of clone.querySelectorAll(`${OWNED_UI},[contenteditable="true"],[role="textbox"],[data-lexical-editor="true"],.ProseMirror,textarea,input[type="text"],input[type="search"],input[type="url"]`)) item.remove();
      return normalize(clone.innerText || clone.textContent || '');
    } catch { return ''; }
  }

  async function verifySent(editor, before, parts, job) {
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      assertActive(job);
      await sleep(180, job);
      if (generatingEvidence()) return true;
      const current = currentComposer(editor);
      const after = normalize(editorText(current));
      if (parts.length) {
        const outside = bodyWithoutComposer();
        if (parts.every((part) => outside.includes(part)) && after !== before) return true;
      }
    }
    return false;
  }

  async function autoSubmit(editor, parts, job) {
    const current = currentComposer(editor) || editor;
    const before = normalize(editorText(current));

    let button = sendButton(current);
    const waitUntil = Date.now() + 2500;
    while (!button && Date.now() < waitUntil) {
      await sleep(200, job);
      button = sendButton(currentComposer(current) || current);
    }
    if (button) {
      button.click();
      if (await verifySent(current, before, parts, job)) return { ok: true, strategy: 'target-button' };
      // A click may already have sent the message even if our evidence missed it.
      // Never issue a second submit side effect after an unconfirmed first one.
      return { ok: false, strategy: 'target-button-unconfirmed' };
    }

    const form = current.closest?.('form');
    if (form?.requestSubmit) {
      try { form.requestSubmit(); } catch { return { ok: false, strategy: 'form-submit-error' }; }
      if (await verifySent(current, before, parts, job)) return { ok: true, strategy: 'form-submit' };
      return { ok: false, strategy: 'form-submit-unconfirmed' };
    }

    if (STRONG_TARGETS.some((known) => host === known || host.endsWith(`.${known}`))) {
      const result = await message('L2C_TARGET_CDP_V06', { action: 'pressEnter', userGesture: true });
      if (!result?.ok) return { ok: false, strategy: 'cdp-enter-rejected' };
      if (await verifySent(current, before, parts, job)) return { ok: true, strategy: 'cdp-enter-fallback' };
      return { ok: false, strategy: 'cdp-enter-unconfirmed' };
    }
    return { ok: false, strategy: 'none' };
  }

  async function preparePrimary(result, pref) {
    const originalBinary = result.kind === 'binary' && !result.convertedFromText;
    if (originalBinary) return { mode: 'attachment', file: originalFile(result), text: '' };

    const payload = String(result.payload || (result.convertedFromText && result.base64
      ? new TextDecoder().decode(base64ToBytes(result.base64)) : ''));
    if (pref.delivery === 'document' && payload) {
      const fileName = deliveryApi?.contextFileName?.(result.sourceUrl) || 'link2context-context.md';
      return { mode: 'document', file: new File([payload], fileName, { type: 'text/markdown' }), text: '' };
    }
    if (pref.delivery === 'text' && payload && payload.length <= TEXT_HARD_LIMIT) return { mode: 'text', text: payload };
    if ((result.handoffMode === 'document' || result.handoffMode === 'document+assets') && result.base64) {
      return { mode: 'document', file: originalFile(result), text: '' };
    }
    if (payload) return { mode: 'text', text: payload };
    if (result.base64) return { mode: 'attachment', file: originalFile(result), text: '' };
    return { mode: 'none', text: '' };
  }

  async function start(editor, url) {
    if (activeJob?.busy) {
      showToast('Link2Context 已有任务在处理，请等待或先 STOP。', true);
      return false;
    }
    const pref = await preference();
    const job = { editor, url, busy: true, cancelled: false, autoSubmit: pref.autoSend, startedAt: Date.now() };
    activeJob = job;
    try {
      report('v06-handoff-start', 'V0.6 开始读取链接 / Starting structured handoff', `Target: ${host}`);
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
        report('v06-upstream-partial', '源内容只取得部分，已禁用自动发送 / Source context is partial; auto-send disabled',
          (Array.isArray(result.partialReasons) ? result.partialReasons.join('; ') : '') || 'partial context', {
            level: 'warn', code: 'UPSTREAM_PARTIAL', errorStage: 'HANDOFF',
          });
      }

      const primary = await preparePrimary(result, pref);
      const assets = Array.isArray(result.assets) ? result.assets : [];
      let attached = 0;
      const failedAssets = [];
      for (const asset of assets) {
        const file = fileFromAsset(asset);
        report('v06-asset-attach', '正在附加正文图片 / Attaching article image', file.name);
        if (await attachFile(file, currentComposer(editor) || editor, job)) attached += 1;
        else failedAssets.push(file.name);
      }
      if (failedAssets.length) {
        job.autoSubmit = false;
        report('v06-assets-partial', '部分图片未能交给当前 AI / Some media could not be attached', failedAssets.join(', '), {
          level: 'warn', code: 'MEDIA_HANDOFF_PARTIAL', errorStage: 'HANDOFF',
        });
      }

      let proof = null;
      if (primary.mode === 'attachment' || primary.mode === 'document') {
        if (!primary.file || !(await attachFile(primary.file, currentComposer(editor) || editor, job))) {
          const error = new Error('主文档/原文件没有被当前网页 AI 确认登记 / Primary attachment was not confirmed');
          error.l2cCode = 'PRIMARY_ATTACHMENT_UNCONFIRMED';
          throw error;
        }
      } else if (primary.mode === 'text') {
        report('v06-text-write', '正在写入结构化上下文 / Writing structured context', `${primary.text.length.toLocaleString()} chars`);
        proof = await writeText(currentComposer(editor) || editor, primary.text, job);
        if (!proof) {
          const error = new Error('当前 AI 编辑器未确认结构化文本进入真实编辑状态 / Composer did not confirm structured text state');
          error.l2cCode = 'EDITOR_STATE_UNCONFIRMED';
          throw error;
        }
      } else {
        throw Object.assign(new Error('没有可交付的上下文 / No deliverable context'), { l2cCode: 'NO_DELIVERABLE_CONTEXT' });
      }

      assertActive(job);
      if (job.autoSubmit) {
        report('v06-send-attempt', '正在自动发送 / Auto-sending', '只执行首个可用发送策略；若副作用后证据不足则立即停止，绝不链式二次发送。');
        const sent = await autoSubmit(proof?.editor || currentComposer(editor) || editor, proof?.signature || [], job);
        if (!sent.ok) {
          report('send-unconfirmed', '自动发送未确认 / Auto-send not confirmed', `内容已准备，但未取得足够证据证明消息进入对话；已停止后续发送尝试（strategy=${sent.strategy}）。`, {
            state: 'error', code: 'SEND_UNCONFIRMED', errorStage: 'HANDOFF',
          });
          showToast('Link2Context：内容已准备，但自动发送未确认；已停止二次发送，请手动检查。', true);
          return false;
        }
        report('sent', '已完成并发送 / Handoff complete and sent', `strategy=${sent.strategy}`, { state: 'success' });
        showToast(`Link2Context：已自动发送（${sent.strategy}）。`);
      } else if (failedAssets.length || upstreamPartial) {
        report('ready-partial', '内容已部分准备，等待手动确认 / Partial context ready for manual review',
          `upstreamPartial=${upstreamPartial}; failedAssets=${failedAssets.length}`, { state: 'success', level: 'warn', code: 'PARTIAL_READY' });
        showToast(`Link2Context：内容已准备，但存在信息缺失（源内容部分=${upstreamPartial ? '是' : '否'}，附件失败=${failedAssets.length}）；已禁用自动发送。`, true);
      } else {
        report('ready-in-composer', '内容已完整准备，等待手动发送 / Ready for manual send', `正文 + ${attached} 个媒体资产`, { state: 'success' });
        showToast(attached ? `Link2Context：正文和 ${attached} 张关键图片已准备。` : 'Link2Context：结构化上下文已准备。');
      }
      return true;
    } catch (error) {
      const code = String(error?.l2cCode || 'HANDOFF_ERROR');
      if (code === 'USER_CANCELLED' || job.cancelled) {
        report('cancelled', '已停止 / Stopped', 'V0.6 抓取、媒体和交付均已停止。', { state: 'success', code: 'USER_CANCELLED' });
        showToast('Link2Context：已停止当前任务。');
        return false;
      }
      report('v06-handoff-error', 'V0.6 交付失败 / Handoff failed', `[${code}] ${String(error?.message || error)}`, {
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
    if (!siteEnabled || !event.isTrusted) return;
    const editor = editorFromTarget(event.target);
    if (!editor || normalize(editorText(editor))) return;
    const url = singleUrl(event.clipboardData?.getData('text/plain') || '');
    if (!url) return;
    stopEvent(event);
    start(editor, url).catch(() => {});
  }, true);

  document.addEventListener('keydown', (event) => {
    if (!siteEnabled || !event.isTrusted || event.isComposing || event.key !== 'Enter'
      || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    const editor = editorFromTarget(event.target);
    if (!editor) return;
    const url = singleUrl(editorText(editor));
    if (!url) return;
    stopEvent(event);
    start(editor, url).catch(() => {});
  }, true);

  document.addEventListener('click', (event) => {
    if (!siteEnabled || !event.isTrusted) return;
    const button = event.target instanceof Element ? event.target.closest('button,[role="button"],input[type="submit"]') : null;
    if (!button || !visible(button)) return;
    const editor = currentComposer();
    if (!editor) return;
    const scope = composerScope(editor);
    if (scope === document || !scope.contains(button)) return;
    const url = singleUrl(editorText(editor));
    if (!url || sendScore(button, editor) < 10) return;
    stopEvent(event);
    start(editor, url).catch(() => {});
  }, true);

  function refreshSiteStatus() {
    chrome.runtime.sendMessage({ type: 'L2C_SITE_STATUS' }, (response) => {
      if (!chrome.runtime.lastError) siteEnabled = Boolean(response?.enabled);
    });
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.customAiHosts) refreshSiteStatus();
  });
  refreshSiteStatus();
})();