import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchBounded, fetchBoundedWithRetry } from '../extension/core/fetch-url.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('external AbortSignal becomes USER_CANCELLED rather than FETCH_TIMEOUT', async () => {
  const controller = new AbortController();
  const promise = fetchBounded('https://example.com', {
    timeoutMs: 5_000,
    signal: controller.signal,
    fetchFn: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  });
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(promise, (error) => error?.code === 'USER_CANCELLED' && error?.stage === 'PIPELINE');
});

test('cancellation during retry backoff prevents another network attempt', async () => {
  const controller = new AbortController();
  let attempts = 0;
  const promise = fetchBoundedWithRetry('https://example.com', {
    attempts: 3,
    signal: controller.signal,
    proxyCompatibilityFallback: false,
    fetchFn: async () => {
      attempts += 1;
      if (attempts === 1) setTimeout(() => controller.abort(), 20);
      throw new TypeError('Failed to fetch');
    },
  });
  await assert.rejects(promise, (error) => error?.code === 'USER_CANCELLED');
  assert.equal(attempts, 1);
});

test('progress panel exposes a real STOP control wired to the active job id', () => {
  const ui = read('extension/progress-ui.js');
  assert.match(ui, /STOP \/ 停止/);
  assert.match(ui, /L2C_CANCEL_JOB/);
  assert.match(ui, /startedAt: jobStart/);
});

test('background owns an abort controller per AI tab and validates stale stop requests', () => {
  const background = read('extension/background.js');
  assert.match(background, /const activeJobs = new Map\(\)/);
  assert.match(background, /new AbortController\(\)/);
  assert.match(background, /message\.startedAt/);
  assert.match(background, /stale-job/);
  assert.match(background, /job\.controller\.abort\(\)/);
});
