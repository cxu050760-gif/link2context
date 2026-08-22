import { validatePublicHttpUrl } from './core/url-safety.js';
import { resolveSourceUrl } from './core/source-router.js';
import { decodeBytes, sniffTextKind, truncateText } from './core/fetch-policy.js';
import { fetchBoundedWithRetry } from './core/fetch-url.js';
import { htmlToMarkdown } from './core/html-lite.js';
import { jsonTextToMarkdown, textToMarkdown } from './core/normalize.js';
import { chatGptShareHtmlToMarkdown } from './core/chatgpt-share.js';
import { isKnownAiHost, normalizeHost } from './core/auto-bridge.js';

const $ = (id) => document.getElementById(id);
const state = { markdown: '', filename: 'context.md', currentHost: '' };
const CUSTOM_HOSTS_KEY = 'customAiHosts';
const BROWSER_CONTEXT_KEY = 'authorizedBrowserContext';
const BROWSER_CONTEXT_DENY_KEY = 'browserContextDeniedHosts';
const deliveryApi = globalThis.Link2ContextDelivery;
const HANDOFF_PREFERENCE_KEY = deliveryApi?.STORAGE_KEY || 'handoffPreference';
const SEND_PREFERENCE_KEY = deliveryApi?.SEND_STORAGE_KEY || 'sendPreference';

function setStatus(msg, isError = false) {
  $('status').textContent = msg;
  $('status').style.color = isError ? 'crimson' : '';
}

function safeFilename(url, ext = '.md') {
  const base = `${url.hostname}${url.pathname}`.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'context';
  return base.endsWith(ext) ? base : `${base}${ext}`;
}

function contextFilename(resolved, sourceUrl) {
  if (resolved.kind === 'workbuddy') return `workbuddy-${resolved.shareCode}.md`;
  if (resolved.kind === 'chatgpt-share') return `chatgpt-${resolved.shareId}.md`;
  return safeFilename(sourceUrl);
}

async function getCustomHosts() {
  const data = await chrome.storage.local.get(CUSTOM_HOSTS_KEY);
  return Array.isArray(data[CUSTOM_HOSTS_KEY]) ? data[CUSTOM_HOSTS_KEY].map(normalizeHost) : [];
}

async function setCustomHosts(hosts) {
  await chrome.storage.local.set({ [CUSTOM_HOSTS_KEY]: [...new Set(hosts.map(normalizeHost).filter(Boolean))] });
}

async function refreshSiteUi() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host = '';
  try { host = normalizeHost(new URL(tab?.url || '').hostname); } catch { /* ignore */ }
  state.currentHost = host;
  const button = $('toggleSite');
  if (!host || !/^https?:/i.test(tab?.url || '')) {
    $('siteStatus').textContent = '当前页面不支持自动模式。 / Current page is not an HTTP(S) site.';
    button.hidden = true;
    return;
  }
  if (isKnownAiHost(host)) {
    $('siteStatus').textContent = `✅ ${host}：内置自动支持 / Built-in auto support`;
    button.hidden = true;
    return;
  }
  const custom = await getCustomHosts();
  const enabled = custom.includes(host);
  $('siteStatus').textContent = `${enabled ? '✅' : '⚪'} ${host}：${enabled ? '已启用自动模式' : '尚未启用自动模式'}`;
  button.hidden = false;
  button.textContent = enabled ? '关闭当前网站自动模式 / Disable' : '启用当前网站自动模式 / Enable';
  button.dataset.enabled = enabled ? '1' : '0';
}

function handoffHint(mode) {
  if (mode === 'document') return 'Markdown 文档：文本类链接会尽量作为 .md 附件交给网页 AI；原始 PDF/图片/压缩包等仍保持原文件。';
  if (mode === 'text') return '长文本：文本类内容尽量直接写入输入框；超过编辑器安全上限时仍会保留文档方式，避免把页面输入框写坏。';
  return '智能模式：按目标 AI、来源类型和长度自动选择。ChatGPT 对话通常优先 Markdown 文档，DeepSeek / 豆包等短内容通常优先长文本。';
}

async function refreshHandoffPreferenceUi() {
  const data = await chrome.storage.local.get(HANDOFF_PREFERENCE_KEY);
  const mode = deliveryApi?.normalizeMode?.(data[HANDOFF_PREFERENCE_KEY])
    || (['document', 'text'].includes(data[HANDOFF_PREFERENCE_KEY]) ? data[HANDOFF_PREFERENCE_KEY] : 'auto');
  $('handoffPreference').value = mode;
  $('handoffPreferenceHint').textContent = handoffHint(mode);
}

async function saveHandoffPreference() {
  const mode = deliveryApi?.normalizeMode?.($('handoffPreference').value) || $('handoffPreference').value;
  await chrome.storage.local.set({ [HANDOFF_PREFERENCE_KEY]: mode });
  $('handoffPreferenceHint').textContent = handoffHint(mode);
}

function sendHint(mode) {
  if (mode === 'auto') return '自动发送：无论你是粘贴链接、按 Enter 还是点击发送，Link2Context 都会先完成抓取与交付，确认当前网页 AI 的发送控件可用后再自动发送；不会强行启用灰色按钮。';
  return '手动确认：无论你是粘贴、按 Enter 还是点击发送，Link2Context 都只把文档或长文本准备好并停在输入框里，你检查后再发送。';
}

async function refreshSendPreferenceUi() {
  const data = await chrome.storage.local.get(SEND_PREFERENCE_KEY);
  const mode = deliveryApi?.normalizeSendMode?.(data[SEND_PREFERENCE_KEY])
    || (data[SEND_PREFERENCE_KEY] === 'auto' ? 'auto' : 'manual');
  $('sendPreference').value = mode;
  $('sendPreferenceHint').textContent = sendHint(mode);
}

async function saveSendPreference() {
  const mode = deliveryApi?.normalizeSendMode?.($('sendPreference').value)
    || ($('sendPreference').value === 'auto' ? 'auto' : 'manual');
  await chrome.storage.local.set({ [SEND_PREFERENCE_KEY]: mode });
  $('sendPreferenceHint').textContent = sendHint(mode);
}

function parseDeniedHosts(value) {
  return [...new Set(String(value || '')
    .split(/[\s,;，；]+/)
    .map((item) => normalizeHost(item.replace(/^https?:\/\//i, '').split('/')[0]))
    .filter((host) => host && /^[a-z0-9.-]+$/i.test(host) && !host.includes('..')))];
}

async function refreshBrowserContextUi() {
  const data = await chrome.storage.local.get([BROWSER_CONTEXT_KEY, BROWSER_CONTEXT_DENY_KEY]);
  const enabled = data[BROWSER_CONTEXT_KEY] === true;
  const deniedHosts = Array.isArray(data[BROWSER_CONTEXT_DENY_KEY]) ? data[BROWSER_CONTEXT_DENY_KEY] : [];
  const stateEl = $('browserContextState');
  const button = $('toggleBrowserContext');
  stateEl.textContent = enabled ? '已授权 / ON' : '未授权 / OFF';
  stateEl.className = `badge ${enabled ? 'on' : 'off'}`;
  button.dataset.enabled = enabled ? '1' : '0';
  button.textContent = enabled
    ? '撤销浏览器上下文授权 / Revoke authorization'
    : '一次性授权并持续使用 / Authorize once';
  $('browserContextDeniedHosts').value = deniedHosts.join(', ');
}

async function toggleBrowserContext() {
  const enabled = $('toggleBrowserContext').dataset.enabled === '1';
  if (enabled) {
    await chrome.storage.local.set({ [BROWSER_CONTEXT_KEY]: false });
    await refreshBrowserContextUi();
    return;
  }
  const accepted = window.confirm(
    '开启后，Link2Context 在 Direct Fetch（直接抓取）遇到 401 / 403 或 JS 空壳时，可以自动在后台使用当前浏览器的 JavaScript 渲染、Session（会话）和 Cookie（登录状态）读取你发送的目标链接，并把取得的内容交给当前网页 AI。\n\n这是一项持续授权：后续不会每个链接重复询问；使用时会在进度面板显示，可随时 STOP 或在这里撤销。\n\nEnable persistent authorized browser-context fallback?',
  );
  if (!accepted) return;
  await chrome.storage.local.set({ [BROWSER_CONTEXT_KEY]: true });
  await refreshBrowserContextUi();
}

async function saveDeniedHosts() {
  const hosts = parseDeniedHosts($('browserContextDeniedHosts').value);
  await chrome.storage.local.set({ [BROWSER_CONTEXT_DENY_KEY]: hosts });
  $('browserContextDeniedHosts').value = hosts.join(', ');
  $('saveDeniedHosts').textContent = '已保存 / Saved';
  setTimeout(() => { $('saveDeniedHosts').textContent = '保存排除列表 / Save deny list'; }, 1200);
}

async function convert() {
  try {
    setStatus('正在获取并清洗… / Fetching and cleaning…');
    $('copy').disabled = true;
    $('save').disabled = true;
    const sourceUrl = validatePublicHttpUrl($('url').value.trim());
    const resolved = resolveSourceUrl(sourceUrl);
    const { bytes, contentType } = await fetchBoundedWithRetry(resolved.fetchUrl, { attempts: 2 });
    const decoded = decodeBytes(bytes, contentType);
    const type = resolved.kind === 'workbuddy' ? 'json' : sniffTextKind(contentType, decoded);
    if (resolved.kind === 'generic' && type === 'binary') {
      throw new Error('This link points to a binary file. Use “Download original”. / 该链接是二进制文件，请使用“下载原文件”。');
    }

    let markdown;
    let inputTruncated = false;
    if (resolved.kind === 'workbuddy') {
      markdown = jsonTextToMarkdown(decoded, sourceUrl.href, 'workbuddy');
    } else if (resolved.kind === 'chatgpt-share') {
      markdown = chatGptShareHtmlToMarkdown(decoded, sourceUrl.href);
    } else if (type === 'json') {
      try { markdown = jsonTextToMarkdown(decoded, sourceUrl.href, 'generic'); }
      catch { markdown = textToMarkdown(decoded, sourceUrl.href, 'Malformed JSON / 非标准 JSON'); }
    } else {
      const limited = truncateText(decoded);
      inputTruncated = limited.truncated;
      markdown = type === 'html' ? htmlToMarkdown(limited.text, sourceUrl.href) : textToMarkdown(limited.text, sourceUrl.href);
    }

    const limitedOutput = truncateText(markdown);
    markdown = limitedOutput.text;
    if (inputTruncated || limitedOutput.truncated) markdown += '\n\n> ⚠️ Output was truncated by the safety limit. / 输出因安全上限被截断。';
    state.markdown = markdown;
    state.filename = contextFilename(resolved, sourceUrl);
    $('output').value = markdown;
    $('copy').disabled = false;
    $('save').disabled = false;
    setStatus(`完成 / Done · 原始 ${Math.round(bytes.byteLength / 1024)} KiB · ${resolved.kind} → clean Markdown`);
  } catch (err) { setStatus(`${err?.message || err}`, true); }
}

async function downloadOriginal() {
  try {
    setStatus('正在安全下载… / Fetching safely…');
    const sourceUrl = validatePublicHttpUrl($('url').value.trim());
    const resolved = resolveSourceUrl(sourceUrl);
    const { bytes, contentType } = await fetchBoundedWithRetry(resolved.fetchUrl, { attempts: 2 });
    const blob = new Blob([bytes], { type: contentType || 'application/octet-stream' });
    const objectUrl = URL.createObjectURL(blob);
    const fallbackName = resolved.kind === 'workbuddy' ? 'conversation-data.json'
      : resolved.kind === 'chatgpt-share' ? `chatgpt-${resolved.shareId}.html`
        : 'download.bin';
    const rawName = sourceUrl.pathname.split('/').filter(Boolean).pop() || fallbackName;
    const filename = rawName.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 120) || fallbackName;
    try { await chrome.downloads.download({ url: objectUrl, filename, saveAs: true }); }
    finally { setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000); }
    setStatus('下载完成 / Download ready');
  } catch (err) { setStatus(`${err?.message || err}`, true); }
}

$('toggleSite').addEventListener('click', async () => {
  if (!state.currentHost) return;
  const custom = await getCustomHosts();
  const next = $('toggleSite').dataset.enabled === '1'
    ? custom.filter((h) => h !== state.currentHost)
    : [...custom, state.currentHost];
  await setCustomHosts(next);
  await refreshSiteUi();
});
$('handoffPreference').addEventListener('change', saveHandoffPreference);
$('sendPreference').addEventListener('change', saveSendPreference);
$('toggleBrowserContext').addEventListener('click', toggleBrowserContext);
$('saveDeniedHosts').addEventListener('click', saveDeniedHosts);
$('convert').addEventListener('click', convert);
$('downloadOriginal').addEventListener('click', downloadOriginal);
$('copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(state.markdown);
  setStatus('已复制 / Copied');
});
$('save').addEventListener('click', async () => {
  const blob = new Blob([state.markdown], { type: 'text/markdown;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  try { await chrome.downloads.download({ url: objectUrl, filename: state.filename, saveAs: true }); }
  finally { setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000); }
});

Promise.all([refreshSiteUi(), refreshHandoffPreferenceUi(), refreshSendPreferenceUi(), refreshBrowserContextUi()]).catch(() => {});
