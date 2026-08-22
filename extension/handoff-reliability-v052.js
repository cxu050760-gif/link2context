(() => {
  'use strict';

  const deliveryApi = globalThis.Link2ContextDelivery;
  const SEND_KEY = deliveryApi?.SEND_STORAGE_KEY || 'sendPreference';
  const HANDOFF_KEY = deliveryApi?.STORAGE_KEY || 'handoffPreference';
  const host = location.hostname.toLowerCase();
  const qwenHost = host === 'chat.qwen.ai' || host.endsWith('.chat.qwen.ai')
    || host === 'qwen.ai' || host.endsWith('.qwen.ai')
    || host === 'tongyi.aliyun.com' || host.endsWith('.tongyi.aliyun.com');
  const pendingPaste = [];
  const attachmentAttempts = [];
  const PENDING_PASTE_TTL_MS = 120_000;
  const ATTACHMENT_ATTEMPT_TTL_MS = 20_000;
  const ATTACHMENT_PROOF_TTL_MS = 6_000;
  const SUBMIT_EVIDENCE_TTL_MS = 15_000;
  const OWNED_UI_SELECTORS = '#__link2context_progress_root,#__link2context_toast,[data-l2c-attachment-proof]';
  let lastSubmitSnapshot = null;
  let lastActiveEditor = null;
  let qwenDocumentMode = false;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function normalizedText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function singleUrl(text) {
    const value = String(text || '').trim();
    if (!value || /\s/.test(value) || value.length > 8192) return null;
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

  function editorFromTarget(target) {
    if (isEditable(target)) return target;
    return target instanceof Element
      ? target.closest('textarea,input[type="text"],input[type="search"],input[type="url"],[contenteditable="true"],[data-lexical-editor="true"],.ProseMirror')
      : null;
  }

  function editorText(editor) {
    if (!editor) return '';
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) return editor.value || '';
    return editor.innerText || editor.textContent || '';
  }

  function visible(el) {
    if (!(el instanceof Element) || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function newestComposer(preferred) {
    if (preferred?.isConnected && isEditable(preferred) && visible(preferred)) return preferred;
    const candidates = [...document.querySelectorAll(
      'textarea,input[type="text"],input[type="search"],input[type="url"],[contenteditable="true"],[data-lexical-editor="true"],.ProseMirror',
    )].filter((el) => isEditable(el) && visible(el));
    return candidates.at(-1) || null;
  }

  function controlText(el) {
    if (!(el instanceof Element)) return '';
    return normalizedText([
      el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent,
      el.getAttribute('data-testid'), el.getAttribute('name'),
    ].filter(Boolean).join(' '));
  }

  function buttonFromElement(el) {
    return el instanceof Element ? el.closest('button,[role="button"],input[type="submit"]') : null;
  }

  function strongSendSemantics(el) {
    const button = buttonFromElement(el);
    if (!button) return false;
    return /(^|\b)(send|ask|发送|送出|提问|发送消息|send message)(\b|$)/i.test(controlText(button));
  }

  function looksLikeSend(el) {
    return strongSendSemantics(el);
  }

  function enabledControl(el) {
    return Boolean(el && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && visible(el));
  }

  function enabledSendButton(editor) {
    const form = editor?.closest?.('form') || null;
    if (form) {
      const local = [...form.querySelectorAll('button,[role="button"],input[type="submit"]')]
        .find((el) => enabledControl(el)
          && (strongSendSemantics(el) || (el.matches('button,input') && String(el.getAttribute('type')).toLowerCase() === 'submit')));
      if (local) return local;
    }

    const localScope = form || editor?.parentElement?.parentElement?.parentElement || null;
    if (localScope) {
      const localStrong = [...localScope.querySelectorAll('button,[role="button"],input[type="submit"]')]
        .find((el) => enabledControl(el) && strongSendSemantics(el));
      if (localStrong) return localStrong;
    }

    return [...document.querySelectorAll('button,[role="button"],input[type="submit"]')]
      .find((el) => enabledControl(el) && strongSendSemantics(el)) || null;
  }

  function filenameHints(fileName) {
    const fromApi = deliveryApi?.attachmentNameHints?.(fileName);
    const name = String(fileName || '').trim();
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const hints = Array.isArray(fromApi) ? [...fromApi] : [];
    if (stem.length >= 16) hints.push(stem.slice(0, 16));
    if (stem.length >= 20) hints.push(stem.slice(0, 20));
    if (stem.length >= 24) hints.push(stem.slice(0, 24));
    return [...new Set(hints.map(normalizedText).filter((item) => item.length >= 12))];
  }

  function ownedUiNode(node) {
    if (!(node instanceof Node)) return true;
    const element = node instanceof Element ? node : node.parentElement;
    if (!element) return false;
    if (element.matches?.(OWNED_UI_SELECTORS) || element.closest?.(OWNED_UI_SELECTORS)) return true;
    const rootNode = element.getRootNode?.();
    return Boolean(rootNode instanceof ShadowRoot && rootNode.host?.matches?.('#__link2context_progress_root'));
  }

  function nodeShowsFile(node, fileName) {
    if (!(node instanceof Node) || ownedUiNode(node)) return false;
    const text = normalizedText(node.textContent).toLowerCase();
    if (!text) return false;
    return filenameHints(fileName).some((hint) => text.includes(hint.toLowerCase()));
  }

  function composerScope(editor) {
    return editor?.closest?.('form') || editor?.parentElement?.parentElement?.parentElement || null;
  }

  function candidateScopesForInput(input) {
    const scopes = new Set();
    const activeScope = composerScope(lastActiveEditor);
    if (activeScope) scopes.add(activeScope);
    if (input?.closest?.('form')) scopes.add(input.closest('form'));

    const local = input?.closest?.('form') || input?.parentElement?.parentElement || document;
    if (local?.querySelectorAll) {
      const editors = [...local.querySelectorAll(
        'textarea,input[type="text"],input[type="search"],input[type="url"],[contenteditable="true"],[data-lexical-editor="true"],.ProseMirror',
      )].filter(isEditable);
      const editor = editors.at(-1) || null;
      const scope = composerScope(editor);
      if (scope) scopes.add(scope);
    }

    if (document.documentElement) scopes.add(document.documentElement);
    return [...scopes].filter(Boolean);
  }

  function mirrorAttachmentProof(attempt) {
    if (attempt.confirmed) return;
    attempt.confirmed = true;
    for (const scope of attempt.scopes) {
      if (!scope?.appendChild) continue;
      const marker = document.createElement('span');
      marker.dataset.l2cAttachmentProof = attempt.originalName;
      marker.setAttribute('aria-hidden', 'true');
      marker.style.cssText = 'display:none!important';
      marker.textContent = attempt.originalName;
      try {
        scope.appendChild(marker);
        setTimeout(() => marker.remove(), ATTACHMENT_PROOF_TTL_MS);
      } catch { /* detached/immutable scope */ }
    }
  }

  function observeAttachmentNodes(nodes) {
    const safeNodes = nodes.filter((node) => !ownedUiNode(node));
    if (!safeNodes.length) return;
    const now = Date.now();
    for (const attempt of attachmentAttempts) {
      if (attempt.confirmed || now - attempt.startedAt > ATTACHMENT_ATTEMPT_TTL_MS) continue;
      if (safeNodes.some((node) => nodeShowsFile(node, attempt.actualName))) mirrorAttachmentProof(attempt);
    }
  }

  function fileToPlainText(file) {
    const dot = file.name.toLowerCase().endsWith('.md') ? file.name.length - 3 : -1;
    const name = dot >= 0 ? `${file.name.slice(0, dot)}.txt` : `${file.name}.txt`;
    return new File([file], name, { type: 'text/plain', lastModified: file.lastModified || Date.now() });
  }

  function handleSyntheticFileEvent(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'file' || event.isTrusted) return;
    const original = input.files?.[0];
    if (!original) return;

    const now = Date.now();
    const alreadyTracked = attachmentAttempts.find((item) => item.input === input
      && (item.originalName === original.name || item.actualName === original.name)
      && now - item.startedAt < 2500);
    if (alreadyTracked) return;

    let actual = original;
    if (qwenHost && qwenDocumentMode && /\.md$/i.test(original.name)) {
      try {
        actual = fileToPlainText(original);
        const dt = new DataTransfer();
        dt.items.add(actual);
        input.files = dt.files;
      } catch { actual = original; }
    }

    attachmentAttempts.push({
      input,
      originalName: original.name,
      actualName: actual.name,
      scopes: candidateScopesForInput(input),
      startedAt: now,
      confirmed: false,
    });
    while (attachmentAttempts.length > 12) attachmentAttempts.shift();
  }

  function patchQwenFileInputs(root = document) {
    if (!qwenHost || !qwenDocumentMode || !root?.querySelectorAll) return;
    const inputs = [...root.querySelectorAll('input[type="file"]')];
    if (root instanceof HTMLInputElement && root.type === 'file') inputs.unshift(root);
    for (const input of inputs) {
      if (input.dataset.l2cOriginalAccept === undefined) input.dataset.l2cOriginalAccept = input.getAttribute('accept') || '';
      const rules = String(input.getAttribute('accept') || '').split(',').map((item) => item.trim()).filter(Boolean);
      for (const extra of ['.md', 'text/markdown', '.txt', 'text/plain']) {
        if (!rules.some((rule) => rule.toLowerCase() === extra)) rules.push(extra);
      }
      input.setAttribute('accept', rules.join(','));
    }
  }

  function restoreQwenFileInputs() {
    for (const input of document.querySelectorAll('input[type="file"][data-l2c-original-accept]')) {
      const original = input.dataset.l2cOriginalAccept || '';
      if (original) input.setAttribute('accept', original);
      else input.removeAttribute('accept');
      delete input.dataset.l2cOriginalAccept;
    }
  }

  async function refreshQwenMode() {
    if (!qwenHost) return;
    try {
      const data = await chrome.storage.local.get(HANDOFF_KEY);
      qwenDocumentMode = data[HANDOFF_KEY] === 'document';
    } catch { qwenDocumentMode = false; }
    if (qwenDocumentMode) patchQwenFileInputs(document);
    else restoreQwenFileInputs();
  }

  function messageSignature(text) {
    const normalized = normalizedText(text);
    if (!normalized) return [];
    if (normalized.length <= 72) return [normalized];
    return [...new Set([
      normalized.slice(0, 48),
      normalized.slice(-48),
    ].filter((fragment) => fragment.length >= 12))];
  }

  function snapshotForSubmit(editor, button = null) {
    const text = editorText(editor);
    return {
      editor,
      button,
      beforeText: text,
      signature: messageSignature(text),
      startedAt: Date.now(),
    };
  }

  function generatingEvidence() {
    return [...document.querySelectorAll('button,[role="button"],[aria-label],[title]')].some((el) => {
      if (!visible(el) || ownedUiNode(el)) return false;
      return /(^|\b)(stop|停止|终止|停止生成|stop generating)(\b|$)/i.test(controlText(el));
    });
  }

  function bodyTextWithoutOwnedUi() {
    const clone = document.body?.cloneNode?.(true);
    if (!(clone instanceof Element)) return '';
    for (const owned of clone.querySelectorAll(OWNED_UI_SELECTORS)) owned.remove();
    return normalizedText(clone.innerText || clone.textContent || '');
  }

  function submitEvidence(snapshot) {
    if (!snapshot || Date.now() - snapshot.startedAt > SUBMIT_EVIDENCE_TTL_MS) return false;
    const editor = newestComposer(snapshot.editor);
    const afterText = normalizedText(editorText(editor));
    const beforeText = normalizedText(snapshot.beforeText);
    const body = bodyTextWithoutOwnedUi();
    const composerChanged = afterText !== beforeText;
    const composerCleared = Boolean(editor && !afterText);
    const signature = Array.isArray(snapshot.signature) ? snapshot.signature.filter((item) => item.length >= 12) : [];
    const bodyHasMessage = signature.length > 0 && signature.every((fragment) => body.includes(fragment));
    const composerStillHasMessage = signature.length > 0 && signature.every((fragment) => afterText.includes(fragment));
    const messageVisibleOutsideComposer = bodyHasMessage && !composerStillHasMessage;
    return (composerChanged && messageVisibleOutsideComposer) || (composerCleared && generatingEvidence());
  }

  function successToast(text, error = false) {
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
    toast.textContent = text;
    toast.style.outline = error ? '2px solid #d33' : 'none';
    setTimeout(() => toast.remove(), error ? 6500 : 3500);
  }

  async function sendModeIsAuto() {
    try {
      const data = await chrome.storage.local.get(SEND_KEY);
      return String(data[SEND_KEY] || '').toLowerCase() === 'auto';
    } catch { return false; }
  }

  async function reliableSubmit(preferredEditor = null) {
    let editor = newestComposer(preferredEditor);
    if (!editor) return false;
    let button = enabledSendButton(editor);
    for (let i = 0; !button && i < 16; i += 1) {
      await sleep(250);
      editor = newestComposer(editor);
      if (!editor) continue;
      button = enabledSendButton(editor);
    }
    if (!button || !editor) return false;
    const snapshot = snapshotForSubmit(editor, button);
    lastSubmitSnapshot = snapshot;
    button.click();
    for (let i = 0; i < 12; i += 1) {
      await sleep(250);
      if (submitEvidence(snapshot)) return true;
    }
    return false;
  }

  function latestPendingPaste({ requireStarted = false } = {}) {
    const now = Date.now();
    while (pendingPaste.length && now - pendingPaste[0].startedAt > PENDING_PASTE_TTL_MS) pendingPaste.shift();
    for (let i = pendingPaste.length - 1; i >= 0; i -= 1) {
      const item = pendingPaste[i];
      if (item.consumed) continue;
      if (requireStarted && !item.handoffStarted) continue;
      return item;
    }
    return null;
  }

  function consumeActivePasteOnError() {
    const pending = latestPendingPaste({ requireStarted: true });
    if (pending) pending.consumed = true;
  }

  function unconfirmedPayload(detail) {
    return {
      stage: 'send-unconfirmed',
      label: '未确认发送 / Send not confirmed',
      detail,
      state: 'error', level: '', log: 'Send was not independently confirmed',
      code: 'SEND_UNCONFIRMED', errorStage: 'HANDOFF',
    };
  }

  async function verifyLegacySent(payload) {
    const snapshot = lastSubmitSnapshot;
    if (!snapshot || Date.now() - snapshot.startedAt > SUBMIT_EVIDENCE_TTL_MS) {
      originalReporter?.(unconfirmedPayload('The legacy sender reported success without a fresh V0.5.2 submit snapshot; success was suppressed fail-closed.'));
      successToast('Link2Context：未取得足够发送证据，已阻止成功误报。', true);
      return;
    }
    for (let i = 0; i < 12; i += 1) {
      if (submitEvidence(snapshot)) {
        originalReporter?.(payload);
        return;
      }
      await sleep(250);
    }
    originalReporter?.(unconfirmedPayload('The page changed during send, but V0.5.2 found no independent evidence that the user message entered the conversation.'));
    successToast('Link2Context：页面发生变化，但未确认消息真正进入对话；请手动检查。', true);
  }

  async function onProgress(payload) {
    const stage = String(payload?.stage || '');

    if (stage === 'handoff-received') {
      const pending = latestPendingPaste();
      if (pending) pending.handoffStarted = true;
      return;
    }

    if (stage.startsWith('error-')) {
      consumeActivePasteOnError();
      return;
    }

    if (stage === 'ready-in-composer') {
      const pending = latestPendingPaste({ requireStarted: true });
      if (!pending || pending.consumed || !(await sendModeIsAuto())) return;
      pending.consumed = true;
      const sent = await reliableSubmit(pending.editor);
      if (sent) {
        originalReporter?.({
          stage: 'sent',
          label: '已完成并发送 / Handoff complete and sent',
          detail: 'V0.5.2 verified the submitted user message after a paste-triggered auto-send.',
          state: 'success', level: '', log: 'Verified paste auto-send', code: '', errorStage: '',
        });
        successToast('Link2Context：已自动发送，并确认消息进入对话。');
      } else {
        originalReporter?.(unconfirmedPayload('V0.5.2 prepared the content but could not verify a safe auto-send. The message remains available for manual review.'));
        successToast('Link2Context：自动发送未确认，内容已保留在输入框，请手动发送。', true);
      }
    }

    if (stage === 'send-unconfirmed' && lastSubmitSnapshot
      && Date.now() - lastSubmitSnapshot.startedAt <= SUBMIT_EVIDENCE_TTL_MS) {
      await sleep(350);
      if (submitEvidence(lastSubmitSnapshot)) {
        originalReporter?.({
          stage: 'sent',
          label: '已完成并发送 / Handoff complete and sent',
          detail: 'V0.5.2 verified page-level send evidence after the legacy sender could not confirm it.',
          state: 'success', level: '', log: 'Recovered false-negative send status', code: '', errorStage: '',
        });
        successToast('Link2Context：网页已实际发送，已纠正误报。');
      }
    }
  }

  const originalReporter = typeof globalThis.__link2contextReportProgress === 'function'
    ? globalThis.__link2contextReportProgress.bind(globalThis)
    : null;
  if (originalReporter) {
    globalThis.__link2contextReportProgress = (payload) => {
      if (String(payload?.stage || '') === 'sent') {
        Promise.resolve(verifyLegacySent(payload)).catch(() => {
          originalReporter(unconfirmedPayload('V0.5.2 could not complete independent send verification.'));
        });
        return;
      }
      originalReporter(payload);
      Promise.resolve(onProgress(payload)).catch(() => {});
    };
  }

  document.addEventListener('paste', (event) => {
    if (!event.isTrusted) return;
    const editor = editorFromTarget(event.target);
    if (!editor || normalizedText(editorText(editor))) return;
    const url = singleUrl(event.clipboardData?.getData('text/plain') || '');
    if (!url) return;
    lastActiveEditor = editor;
    pendingPaste.push({ editor, url, startedAt: Date.now(), handoffStarted: false, consumed: false });
    while (pendingPaste.length > 8) pendingPaste.shift();
  }, true);

  document.addEventListener('click', (event) => {
    if (event.isTrusted || !looksLikeSend(event.target)) return;
    const editor = newestComposer(editorFromTarget(event.target) || lastActiveEditor);
    if (!editor) return;
    lastActiveEditor = editor;
    lastSubmitSnapshot = snapshotForSubmit(editor, buttonFromElement(event.target));
  }, true);

  document.addEventListener('keydown', (event) => {
    if (!event.isTrusted || event.key !== 'Enter') return;
    const editor = editorFromTarget(event.target);
    if (editor) lastActiveEditor = editor;
  }, true);

  document.addEventListener('input', handleSyntheticFileEvent, true);
  document.addEventListener('change', handleSyntheticFileEvent, true);

  const observer = new MutationObserver((records) => {
    const added = [];
    for (const record of records) {
      for (const node of record.addedNodes || []) added.push(node);
      if (record.type === 'characterData' && record.target?.parentElement) added.push(record.target.parentElement);
    }
    if (added.length) observeAttachmentNodes(added);
    if (qwenHost && qwenDocumentMode) {
      for (const node of added) if (node instanceof Element && !ownedUiNode(node)) patchQwenFileInputs(node);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[HANDOFF_KEY]) refreshQwenMode().catch(() => {});
  });
  refreshQwenMode().catch(() => {});
})();
