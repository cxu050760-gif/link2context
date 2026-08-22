import './background.js';

const QIANWEN_DEBUGGER_MESSAGE = 'L2C_QIANWEN_CDP';
const QIANWEN_TEXT_LIMIT = 180_000;
const CDP_PROTOCOL_VERSION = '1.3';

function senderHost(sender) {
  try { return new URL(sender?.tab?.url || sender?.url || '').hostname.toLowerCase(); }
  catch { return ''; }
}

function isManagedQianwenHost(host) {
  return host === 'qianwen.com' || host.endsWith('.qianwen.com')
    || host === 'qwenwork.cn' || host.endsWith('.qwenwork.cn');
}

function debuggerFailure(error, code = 'QIANWEN_DEBUGGER_FAILED') {
  return {
    ok: false,
    errorCode: code,
    error: String(error?.message || error || 'Chrome debugger command failed / Chrome 调试器命令失败'),
  };
}

async function withDebugger(tabId, task) {
  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, CDP_PROTOCOL_VERSION);
    attached = true;
    return await task(target);
  } catch (error) {
    const message = String(error?.message || error || '');
    const code = /another debugger|already attached|debugger is already attached/i.test(message)
      ? 'QIANWEN_DEBUGGER_BUSY'
      : 'QIANWEN_DEBUGGER_ATTACH_FAILED';
    return debuggerFailure(error, code);
  } finally {
    if (attached) {
      try { await chrome.debugger.detach(target); } catch { /* tab may have closed */ }
    }
  }
}

async function insertTextViaDebugger(tabId, text) {
  if (typeof text !== 'string' || !text || text.length > QIANWEN_TEXT_LIMIT) {
    return { ok: false, errorCode: 'QIANWEN_DEBUGGER_TEXT_INVALID', error: 'Debugger text payload is invalid or too large / 调试器文本为空或过长' };
  }

  return withDebugger(tabId, async (target) => {
    // Keep each CDP command bounded. Input.insertText follows the browser's real
    // editing path and is what we want for Qianwen's controlled React editor.
    const chunkSize = 4_000;
    for (let i = 0; i < text.length; i += chunkSize) {
      await chrome.debugger.sendCommand(target, 'Input.insertText', {
        text: text.slice(i, i + chunkSize),
      });
    }
    return { ok: true };
  });
}

async function pressEnterViaDebugger(tabId) {
  return withDebugger(tabId, async (target) => {
    const common = {
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    };
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      ...common,
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      ...common,
    });
    return { ok: true };
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object' || message.type !== QIANWEN_DEBUGGER_MESSAGE) return undefined;

  (async () => {
    if (sender?.frameId > 0) {
      return { ok: false, errorCode: 'QIANWEN_DEBUGGER_FRAME_DENIED', error: 'Only the top frame may use Qianwen debugger input / 仅顶层千问页面可调用调试输入' };
    }
    const host = senderHost(sender);
    if (!isManagedQianwenHost(host)) {
      return { ok: false, errorCode: 'QIANWEN_DEBUGGER_HOST_DENIED', error: 'Debugger input is restricted to qianwen.com / qwenwork.cn / 调试输入仅限千问域名' };
    }
    const tabId = sender?.tab?.id;
    if (!Number.isInteger(tabId)) {
      return { ok: false, errorCode: 'QIANWEN_DEBUGGER_NO_TAB', error: 'No sender tab / 无调用标签页' };
    }

    if (message.action === 'insertText') return insertTextViaDebugger(tabId, message.text);
    if (message.action === 'pressEnter') return pressEnterViaDebugger(tabId);
    return { ok: false, errorCode: 'QIANWEN_DEBUGGER_ACTION_INVALID', error: 'Unsupported debugger action / 不支持的调试输入动作' };
  })()
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse(debuggerFailure(error)));

  return true;
});
