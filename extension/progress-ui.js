(() => {
  'use strict';

  const ROOT_ID = '__link2context_progress_root';
  const MAX_LOGS = 7;
  let root;
  let shadow;
  let panel;
  let stageEl;
  let detailEl;
  let elapsedEl;
  let logEl;
  let stopEl;
  let timer = null;
  let startedAt = 0;
  let currentStartedAt = 0;
  let suppressedStartedAt = 0;
  let lastState = null;
  let hideTimer = null;

  function destroyPanel() {
    clearInterval(timer); timer = null;
    clearTimeout(hideTimer); hideTimer = null;
    root?.remove();
    root = shadow = panel = stageEl = detailEl = elapsedEl = logEl = stopEl = null;
  }

  function appendLog(message, level = '') {
    if (!message || !logEl) return;
    const item = document.createElement('div');
    item.className = `log ${level}`.trim();
    const seconds = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;
    item.textContent = `[${seconds}s] ${message}`;
    logEl.appendChild(item);
    while (logEl.children.length > MAX_LOGS) logEl.firstElementChild?.remove();
    logEl.scrollTop = logEl.scrollHeight;
  }

  function requestStop() {
    const jobStart = currentStartedAt || startedAt;
    if (!jobStart || !stopEl) return;
    stopEl.disabled = true;
    stageEl.textContent = '正在停止… / Stopping…';
    detailEl.textContent = '正在停止网络读取、分页、附件交付和自动发送。 / Cancelling fetch, pagination, handoff and auto-send.';
    appendLog('用户请求 STOP / Stop requested', 'warn');

    // V0.5.3 local cancellation closes the old gap where background fetch had
    // already finished but attachment injection / auto-send was still running.
    try {
      document.dispatchEvent(new CustomEvent('link2context:cancel', {
        detail: { startedAt: jobStart },
      }));
    } catch { /* background cancellation still runs below */ }

    try {
      chrome.runtime.sendMessage({ type: 'L2C_CANCEL_JOB', startedAt: jobStart }, (result) => {
        if (chrome.runtime.lastError || !result?.ok) {
          appendLog('后台 STOP 请求未确认；本地交付仍已停止 / Background stop unconfirmed; local handoff cancelled', 'warn');
        } else if (result.cancelled === false && result.reason === 'no-active-job') {
          appendLog('后台抓取已结束；已停止本地交付阶段 / Fetch already finished; local handoff cancelled', 'warn');
        }
      });
    } catch {
      appendLog('后台 STOP 请求发送失败；本地交付仍已停止 / Background stop failed; local handoff cancelled', 'warn');
    }
  }

  function ensurePanel() {
    if (panel?.isConnected) return;
    root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      Object.assign(root.style, {
        position: 'fixed', right: '18px', bottom: '18px', zIndex: '2147483647',
        width: '390px', maxWidth: 'calc(100vw - 36px)',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      });
      document.documentElement.appendChild(root);
      shadow = root.attachShadow({ mode: 'open' });
    } else {
      shadow = root.shadowRoot || root.attachShadow({ mode: 'open' });
    }

    const style = document.createElement('style');
    style.textContent = `
      .panel{background:rgba(18,18,20,.97);color:#fff;border:1px solid rgba(255,255,255,.16);border-radius:12px;box-shadow:0 10px 36px rgba(0,0,0,.38);overflow:hidden}
      .head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.12);font-size:13px;font-weight:700}
      .dot{width:9px;height:9px;border-radius:50%;background:#5ea2ff;box-shadow:0 0 0 3px rgba(94,162,255,.18)}
      .title{flex:1}.elapsed{font-variant-numeric:tabular-nums;color:#b8c1d1;font-weight:600}.close{border:0;background:transparent;color:#aaa;cursor:pointer;font-size:18px;line-height:1;padding:0 2px}.close:hover{color:#fff}
      .body{padding:11px 12px 12px}.stage{font-size:14px;font-weight:750;margin-bottom:5px}.detail{font-size:12px;color:#c8ced8;line-height:1.45;word-break:break-word;max-height:66px;overflow:auto}
      .actions{display:flex;justify-content:flex-end;margin-top:9px}.stop{border:1px solid rgba(255,172,72,.65);background:rgba(255,172,72,.1);color:#ffd79b;border-radius:8px;padding:5px 9px;cursor:pointer;font-size:11px;font-weight:700}.stop:hover{background:rgba(255,172,72,.18)}.stop[hidden]{display:none}
      .logs{margin-top:9px;padding-top:8px;border-top:1px solid rgba(255,255,255,.1);display:flex;flex-direction:column;gap:4px;max-height:126px;overflow:auto}.log{font-size:11px;color:#98a2b3;line-height:1.35}.log.warn{color:#f5c26b}.log.error{color:#ff8b8b}.log.ok{color:#7ddc9a}
      .panel[data-state="error"]{border-color:rgba(255,95,95,.7)}.panel[data-state="error"] .dot{background:#ff6464;box-shadow:0 0 0 3px rgba(255,100,100,.18)}
      .panel[data-state="success"]{border-color:rgba(91,214,132,.55)}.panel[data-state="success"] .dot{background:#58d385;box-shadow:0 0 0 3px rgba(88,211,133,.18)}
    `;

    panel = document.createElement('div');
    panel.className = 'panel';
    panel.dataset.state = 'running';
    panel.innerHTML = `
      <div class="head"><span class="dot"></span><span class="title">Link2Context 运行状态 / Progress</span><span class="elapsed">0s</span><button class="close" title="关闭 / Close">×</button></div>
      <div class="body"><div class="stage">准备中… / Preparing…</div><div class="detail"></div><div class="actions"><button class="stop">STOP / 停止</button></div><div class="logs"></div></div>
    `;
    shadow.replaceChildren(style, panel);
    stageEl = panel.querySelector('.stage');
    detailEl = panel.querySelector('.detail');
    elapsedEl = panel.querySelector('.elapsed');
    stopEl = panel.querySelector('.stop');
    logEl = panel.querySelector('.logs');
    panel.querySelector('.close').addEventListener('click', () => {
      suppressedStartedAt = currentStartedAt;
      destroyPanel();
    });
    stopEl.addEventListener('click', requestStop);
  }

  function startClock(startMs) {
    startedAt = Number(startMs) || Date.now();
    clearInterval(timer);
    const tick = () => {
      if (!elapsedEl) return;
      elapsedEl.textContent = `${Math.max(0, Math.floor((Date.now() - startedAt) / 1000))}s`;
    };
    tick();
    timer = setInterval(tick, 1000);
  }

  function resetForNewJob(incomingStartedAt) {
    clearTimeout(hideTimer); hideTimer = null;
    currentStartedAt = incomingStartedAt || Date.now();
    suppressedStartedAt = 0;
    lastState = null;
    if (logEl) logEl.replaceChildren();
    if (panel) panel.dataset.state = 'running';
    if (stopEl) {
      stopEl.hidden = false;
      stopEl.disabled = false;
    }
  }

  function updateProgress(data) {
    const incomingStartedAt = Number(data.startedAt) || 0;
    if (data.stage === 'start') {
      ensurePanel();
      resetForNewJob(incomingStartedAt);
    } else {
      if (suppressedStartedAt && incomingStartedAt === suppressedStartedAt) return;
      if (currentStartedAt && incomingStartedAt && incomingStartedAt !== currentStartedAt) return;
      ensurePanel();
      clearTimeout(hideTimer); hideTimer = null;
      if (!currentStartedAt) currentStartedAt = incomingStartedAt || Date.now();
    }
    if (!timer || data.stage === 'start') startClock(data.startedAt || currentStartedAt);

    const state = data.state || 'running';
    panel.dataset.state = state;
    stageEl.textContent = data.label || data.stage || '运行中 / Working';
    detailEl.textContent = data.detail || '';
    if (stopEl) {
      stopEl.hidden = state === 'success' || state === 'error';
      if (!stopEl.hidden && data.stage !== 'cancel-requested') stopEl.disabled = false;
    }

    const key = `${data.stage}|${data.detail}|${state}`;
    if (key !== lastState) {
      appendLog(data.log || data.label || data.stage,
        state === 'error' ? 'error' : state === 'success' ? 'ok' : data.level === 'warn' ? 'warn' : '');
      lastState = key;
    }

    if (state === 'success') {
      clearInterval(timer); timer = null;
      hideTimer = setTimeout(() => destroyPanel(), 7000);
    } else if (state === 'error') {
      clearInterval(timer); timer = null;
    }
  }

  globalThis.__link2contextReportProgress = (data = {}) => {
    updateProgress({
      ...data,
      startedAt: Number(data.startedAt) || currentStartedAt || startedAt || Date.now(),
    });
  };

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== 'L2C_PROGRESS') return;
    updateProgress(message);
  });
})();
