import { fetchBoundedWithRetry } from './fetch-url.js';
import { detectResourceType, defaultExtensionForMime } from './resource-type.js';
import { validatePublicHttpUrl } from './url-safety.js';
import { selectContextImages } from './structured-html-v06.js';

export const MAX_CONTEXT_IMAGE_COUNT = 6;
export const MAX_CONTEXT_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_CONTEXT_IMAGE_TOTAL_BYTES = 12 * 1024 * 1024;

function bytesToBase64(bytes) {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + step)));
  }
  return btoa(binary);
}

function cleanName(value) {
  return String(value || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'web-image';
}

function imageName(url, mime, index) {
  let name = '';
  try { name = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || ''); } catch { /* ignore */ }
  name = cleanName(name);
  const ext = defaultExtensionForMime(mime) || 'img';
  if (!/\.[a-z0-9]{1,8}$/i.test(name)) name = `${name || `web-image-${index}`}.${ext}`;
  return cleanName(name);
}

function reportSafe(onProgress, payload) {
  try { onProgress?.(payload); } catch { /* progress must not break acquisition */ }
}

function throwIfCancelled(signal) {
  if (!signal?.aborted) return;
  const error = new Error('Cancelled by user / 用户已停止当前 Link2Context 任务');
  error.code = 'USER_CANCELLED';
  error.stage = 'PIPELINE';
  throw error;
}

export async function acquireContextImages(document, {
  signal = null,
  onProgress = null,
  maxCount = MAX_CONTEXT_IMAGE_COUNT,
  maxPerImageBytes = MAX_CONTEXT_IMAGE_BYTES,
  maxTotalBytes = MAX_CONTEXT_IMAGE_TOTAL_BYTES,
  fetchFn = globalThis.fetch,
} = {}) {
  const selected = selectContextImages(document, { limit: maxCount });
  const assets = [];
  let total = 0;
  for (let i = 0; i < selected.length; i += 1) {
    throwIfCancelled(signal);
    const item = selected[i];
    if (total >= maxTotalBytes) break;
    let url;
    try { url = validatePublicHttpUrl(item.src); }
    catch { continue; }
    const remaining = maxTotalBytes - total;
    const maxBytes = Math.max(1, Math.min(maxPerImageBytes, remaining));
    reportSafe(onProgress, {
      stage: 'image-fetch',
      index: i + 1,
      total: selected.length,
      url: url.href,
    });
    try {
      const fetched = await fetchBoundedWithRetry(url, {
        fetchFn,
        attempts: 1,
        maxBytes,
        signal,
        // Never silently drop targetAddressSpace for article images. A remote
        // image is still an untrusted network target and must keep the same
        // public-address boundary as the primary document fetch.
        proxyCompatibilityFallback: false,
      });
      throwIfCancelled(signal);
      const resource = detectResourceType({
        bytes: fetched.bytes,
        contentType: fetched.contentType,
        url: fetched.finalUrl || url.href,
      });
      if (resource.kind !== 'image') continue;
      const assetId = item.assetId || `web-image-${assets.length + 1}`;
      const fileName = imageName(fetched.finalUrl || url.href, resource.mime, assets.length + 1);
      assets.push({
        assetId,
        kind: 'image',
        sourceUrl: url.href,
        finalUrl: fetched.finalUrl || url.href,
        fileName,
        mime: resource.mime || 'application/octet-stream',
        size: fetched.bytes.byteLength,
        base64: bytesToBase64(fetched.bytes),
        alt: item.alt || '',
        caption: item.caption || '',
      });
      total += fetched.bytes.byteLength;
    } catch (error) {
      if (signal?.aborted || error?.code === 'USER_CANCELLED') throwIfCancelled(signal);
      reportSafe(onProgress, {
        stage: 'image-skip',
        index: i + 1,
        url: url.href,
        error: String(error?.message || error),
      });
    }
  }
  throwIfCancelled(signal);
  return {
    assets,
    selectedCount: selected.length,
    acquiredCount: assets.length,
    totalBytes: total,
    partial: assets.length < selected.length,
  };
}

export function bindContextImageAssets(document, assets = []) {
  const bySource = new Map((assets || []).map((asset) => [asset.sourceUrl, asset]));
  for (const block of document?.blocks || []) {
    if (block.type !== 'image' || !block.src) continue;
    const asset = bySource.get(block.src);
    if (asset) block.assetId = asset.assetId;
  }
  return document;
}
