import { validatePublicHttpUrl } from './core/url-safety.js';
import { resolveSpecialUrl } from './core/workbuddy.js';
import { decodeBytes, sniffTextKind, truncateText } from './core/fetch-policy.js';
import { fetchBounded, fetchBoundedWithRetry } from './core/fetch-url.js';
import { htmlToMarkdown } from './core/html-lite.js';
import { jsonTextToMarkdown, textToMarkdown } from './core/normalize.js';
import { isKnownAiHost, normalizeHost } from './core/auto-bridge.js';

const $ = (id) => document.getElementById(id);
const state = { markdown: '', filename: 'context.md', currentHost: '' };
const CUSTOM_HOSTS_KEY = 'customAiHosts';

function setStatus(msg, isError = false) {
  $('status').textContent = msg;
  $('status').style.color = isError ? 'crimson' : '';
}

function safeFilename(url, ext = '.md') {
  const base = `${url.hostname}${url.pathname}`.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'context';
  return base.endsWith(ext) ? base : `${base}${ext}`;
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

async function convert() {
  try {
    setStatus('正在获取… / Fetching…');
    $('copy').disabled = true;
    $('save').disabled = true;
    const sourceUrl = validatePublicHttpUrl($('url').value.trim());
    const resolved = resolveSpecialUrl(sourceUrl);
    const { res, bytes, contentType } = await fetchBoundedWithRetry(resolved.fetchUrl, { attempts: 2 });
    const decoded = decodeBytes(bytes, contentType);
    const type = resolved.kind === 'workbuddy' ? 'json' : sniffTextKind(contentType, decoded);
    if (type === 'binary') throw new Error('This link points to a binary file. Use “Download original”. / 该链接是二进制文件，请使用“下载原文件”。');
    let markdown;
    let inputTruncated = false;
    if (resolved.kind === 'workbuddy') markdown = jsonTextToMarkdown(decoded, sourceUrl.href, 'workbuddy');
    else if (type === 'json') {
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
    state.filename = resolved.kind === 'workbuddy' ? `workbuddy-${resolved.shareCode}.md` : safeFilename(sourceUrl);
    $('output').value = markdown;
    $('copy').disabled = false;
    $('save').disabled = false;
    setStatus(`完成 / Done · ${Math.round(bytes.byteLength / 1024)} KiB · ${resolved.kind}`);
  } catch (err) { setStatus(`${err?.message || err}`, true); }
}

async function downloadOriginal() {
  try {
    setStatus('正在安全下载… / Fetching safely…');
    const sourceUrl = validatePublicHttpUrl($('url').value.trim());
    const resolved = resolveSpecialUrl(sourceUrl);
    const { bytes, contentType } = await fetchBounded(resolved.fetchUrl);
    const blob = new Blob([bytes], { type: contentType || 'application/octet-stream' });
    const objectUrl = URL.createObjectURL(blob);
    const rawName = sourceUrl.pathname.split('/').filter(Boolean).pop() || (resolved.kind === 'workbuddy' ? 'conversation-data.json' : 'download.bin');
    const filename = rawName.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 120) || 'download.bin';
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

refreshSiteUi().catch(() => {});
