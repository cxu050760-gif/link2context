import './background.js';
import './background-pipeline-v06.js';

const QIANWEN_DEBUGGER_MESSAGE = 'L2C_QIANWEN_CDP';
const TARGET_DEBUGGER_MESSAGE = 'L2C_TARGET_CDP_V06';
const QIANWEN_TEXT_LIMIT = 180_000;
const CDP_PROTOCOL_VERSION = '1.3';
const SEND_KEY = 'sendPreference';

function senderHost(sender) {
  try { return new URL(sender?.tab?.url || sender?.url || '').hostname.toLowerCase(); }
  catch { return ''; }
}

function isManagedQianwenHost(host) {
  return host === 'qianwen.com' || host.endsWith('.qianwen.com')
    || host === 'qwenwork.cn' || host.endsWith('.qwenwork.cn');
}

function isV06AutoSendFallbackHost(host) {
  return host === 'chatgpt.com' || host.endsWith('.chatgpt.com')
    || host === 'chat.deepseek.com' || host.endsWith('.chat.deepseek.com')
    || host === 'doubao.com' || host.endsWith('.doubao.com');
}

function debuggerFailure(error, code = 'DEBUGGER_FAILED') {
  return {
    ok: false,
    errorCode: code,
    error: String(error?.message || error || 'Chrome debugger command failed / Chrome 调试器命令失败'),
  };
}

async function withDebugger(tabId, task, failurePrefix = 'DEBUGGER') {
  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, CDP_PROTOCOL_VERSION);
    attached = true;
    return await task(target);
  } catch (error) {
    const message = String(error?.message || error || '');
    const code = /another debugger|already attached|debugger is already attached/i.test(message)
      ? `${failurePrefix}_BUSY`
      : `${failurePrefix}_ATTACH_FAILED`;
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
    const chunkSize = 4_000;
    for (let i = 0; i < text.length; i += chunkSize) {
      await chrome.debugger.sendCommand(target, 'Input.insertText', { text: text.slice(i, i + chunkSize) });
    }
    return { ok: true };
  }, 'QIANWEN_DEBUGGER');
}

async function pressEnterViaDebugger(tabId, prefix = 'DEBUGGER') {
  return withDebugger(tabId, async (target) => {
    const common = {
      key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
    };
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...common });
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyUp', ...common });
    return { ok: true };
  }, prefix);
}

async function explicitAutoSendEnabled() {
  try {
    const data = await chrome.storage.local.get(SEND_KEY);
    return data[SEND_KEY] === 'auto';
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return undefined;

  if (message.type === QIANWEN_DEBUGGER_MESSAGE) {
    (async () => {
      if (sender?.frameId > 0) {
        return { ok: false, errorCode: 'QIANWEN_DEBUGGER_FRAME_DENIED', error: 'Only the top frame may use Qianwen debugger input / 仅顶层千问页面可调用调试输入' };
      }
      const host = senderHost(sender);
      if (!isManagedQianwenHost(host)) {
        return { ok: false, errorCode: 'QIANWEN_DEBUGGER_HOST_DENIED', error: 'Debugger input is restricted to qianwen.com / qwenwork.cn / 调试输入仅限千问域名' };
      }
      const tabId = sender?.tab?.id;
      if (!Number.isInteger(tabId)) return { ok: false, errorCode: 'QIANWEN_DEBUGGER_NO_TAB', error: 'No sender tab / 无调用标签页' };
      if (message.action === 'insertText') return insertTextViaDebugger(tabId, message.text);
      if (message.action === 'pressEnter') return pressEnterViaDebugger(tabId, 'QIANWEN_DEBUGGER');
      return { ok: false, errorCode: 'QIANWEN_DEBUGGER_ACTION_INVALID', error: 'Unsupported debugger action / 不支持的调试输入动作' };
    })().then(sendResponse).catch((error) => sendResponse(debuggerFailure(error, 'QIANWEN_DEBUGGER_FAILED')));
    return true;
  }

  if (message.type === TARGET_DEBUGGER_MESSAGE) {
    (async () => {
      if (sender?.frameId > 0) return { ok: false, errorCode: 'TARGET_DEBUGGER_FRAME_DENIED', error: 'Only top frame auto-send fallback is allowed / 仅顶层页面可使用自动发送回退' };
      if (message.action !== 'pressEnter') return { ok: false, errorCode: 'TARGET_DEBUGGER_ACTION_DENIED', error: 'Only Enter is exposed for V0.6 target fallback / V0.6 目标回退仅允许 Enter' };
      const host = senderHost(sender);
      if (!isV06AutoSendFallbackHost(host)) return { ok: false, errorCode: 'TARGET_DEBUGGER_HOST_DENIED', error: 'Target debugger fallback is not allowed on this host / 当前站点不允许调试器发送回退' };
      if (!(await explicitAutoSendEnabled())) return { ok: false, errorCode: 'TARGET_DEBUGGER_AUTO_SEND_DISABLED', error: 'Auto-send is not explicitly enabled / 未显式开启自动发送' };
      const tabId = sender?.tab?.id;
      if (!Number.isInteger(tabId)) return { ok: false, errorCode: 'TARGET_DEBUGGER_NO_TAB', error: 'No sender tab / 无调用标签页' };
      return pressEnterViaDebugger(tabId, 'TARGET_DEBUGGER');
    })().then(sendResponse).catch((error) => sendResponse(debuggerFailure(error, 'TARGET_DEBUGGER_FAILED')));
    return true;
  }

  return undefined;
});
