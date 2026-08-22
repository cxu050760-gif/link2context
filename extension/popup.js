import { validatePublicHttpUrl, validateRedirect } from './core/url-safety.js';
import { resolveSpecialUrl } from './core/workbuddy.js';
import { decodeBytes, enforceContentLength, MAX_FETCH_BYTES, MAX_REDIRECTS, sniffTextKind, truncateText } from './core/fetch-policy.js';
import { jsonTextToMarkdown, textToMarkdown } from './core/normalize.js';

const $ = (id) => document.getElementById(id);
const state = { markdown: '', filename: 'context.md' };

function setStatus(msg, isError = false) {
  $('status').textContent = msg;
  $('status').style.color = isError ? 'crimson' : '';
}

function safeFilename(url, ext = '.md') {
  const base = `${url.hostname}${url.pathname}`.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'context';
  return base.endsWith(ext) ? base : `${base}${ext}`;
}

function htmlToMarkdown(html, sourceUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const el of doc.querySelectorAll('script,style,noscript,svg,canvas,template,iframe')) el.remove();
  const title = (doc.querySelector('title')?.textContent || doc.querySelector('h1')?.textContent || 'Web Page').trim();
  const main = doc.querySelector('article,main,[role="main"]') || doc.body;
  const text = (main?.innerText || main?.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  return textToMarkdown(text, sourceUrl, title || 'Web Page');
}

async function fetchBounded(initialUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    let current = validatePublicHttpUrl(initialUrl);
    let res;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      res = await fetch(current, { redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: controller.signal });
      if (res.status >= 300 && res.status < 400) {
        if (hop === MAX_REDIRECTS) throw new Error('Too many redirects / 重定向次数过多');
        current = validateRedirect(current, res.headers.get('location'));
        continue;
      }
      break;
    }
    if (!res?.ok) throw new Error(`HTTP ${res?.status ?? 'unknown'} ${res?.statusText ?? ''}`);
    enforceContentLength(res.headers.get('content-length'));
    const reader = res.body?.getReader();
    if (!reader) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > MAX_FETCH_BYTES) throw new Error(`Response exceeds ${MAX_FETCH_BYTES} bytes / 响应超过大小上限`);
      return { res, bytes };
    }
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_FETCH_BYTES) {
        controller.abort();
        throw new Error(`Response exceeds ${MAX_FETCH_BYTES} bytes / 响应超过大小上限`);
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
    return { res, bytes: merged };
  } finally {
    clearTimeout(timer);
  }
}

async function convert() {
  try {
    setStatus('正在获取… / Fetching…');
    $('copy').disabled = true;
    $('save').disabled = true;
    const sourceUrl = validatePublicHttpUrl($('url').value.trim());
    const resolved = resolveSpecialUrl(sourceUrl);
    const { res, bytes } = await fetchBounded(resolved.fetchUrl);
    const contentType = res.headers.get('content-type') || '';
    const decoded = decodeBytes(bytes, contentType);
    const type = resolved.kind === 'workbuddy' ? 'json' : sniffTextKind(contentType, decoded);
    if (type === 'binary') throw new Error('This link points to a binary file. Use “Download original”. / 该链接是二进制文件，请使用“下载原文件”。');
    let markdown;
    let inputTruncated = false;
    if (resolved.kind === 'workbuddy') {
      markdown = jsonTextToMarkdown(decoded, sourceUrl.href, 'workbuddy');
    } else if (type === 'json') {
      markdown = jsonTextToMarkdown(decoded, sourceUrl.href, 'generic');
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
  } catch (err) {
    setStatus(`${err?.message || err}`, true);
  }
}

async function downloadOriginal() {
  try {
    setStatus('正在安全下载… / Fetching safely…');
    const sourceUrl = validatePublicHttpUrl($('url').value.trim());
    const resolved = resolveSpecialUrl(sourceUrl);
    const { res, bytes } = await fetchBounded(resolved.fetchUrl);
    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    const blob = new Blob([bytes], { type: contentType });
    const objectUrl = URL.createObjectURL(blob);
    const rawName = sourceUrl.pathname.split('/').filter(Boolean).pop() || (resolved.kind === 'workbuddy' ? 'conversation-data.json' : 'download.bin');
    const filename = rawName.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 120) || 'download.bin';
    try { await chrome.downloads.download({ url: objectUrl, filename, saveAs: true }); }
    finally { setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000); }
    setStatus('下载完成 / Download ready');
  } catch (err) {
    setStatus(`${err?.message || err}`, true);
  }
}

$('convert').addEventListener('click', convert);
$('downloadOriginal').addEventListener('click', downloadOriginal);
$('copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(state.markdown);
  setStatus('已复制，可直接粘贴给网页 AI / Copied; paste into any web AI');
});
$('save').addEventListener('click', async () => {
  const blob = new Blob([state.markdown], { type: 'text/markdown;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  try { await chrome.downloads.download({ url: objectUrl, filename: state.filename, saveAs: true }); }
  finally { setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000); }
});
