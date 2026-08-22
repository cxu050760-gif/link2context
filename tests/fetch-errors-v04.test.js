import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFetchFailure, fetchBounded, fetchBoundedWithRetry } from '../extension/core/fetch-url.js';

const http = (status, statusText = '') => new Response('x', { status, statusText });

for (const [status, code, stage] of [
  [401, 'AUTH_REQUIRED_401', 'AUTH'],
  [403, 'FETCH_BLOCKED_403', 'FETCH'],
  [404, 'NOT_FOUND_404', 'FETCH'],
  [429, 'RATE_LIMITED_429', 'FETCH'],
  [500, 'HTTP_5XX', 'FETCH'],
]) {
  test(`HTTP ${status} preserves structured ${code}`, async () => {
    let caught;
    try { await fetchBounded('https://example.com/a', { fetchFn: async () => http(status) }); }
    catch (error) { caught = error; }
    assert.ok(caught);
    const info = classifyFetchFailure(caught);
    assert.equal(info.code, code);
    assert.equal(info.stage, stage);
    assert.equal(info.status, status);
    assert.match(info.message, new RegExp(`HTTP ${status}`));
  });
}

test('401/403/404/429 are not retried and never enter proxy compatibility fallback', async () => {
  for (const status of [401,403,404,429]) {
    let calls = 0;
    await assert.rejects(() => fetchBoundedWithRetry('https://example.com/a', {
      attempts: 3,
      fetchFn: async () => { calls += 1; return http(status); },
    }));
    assert.equal(calls, 1, `HTTP ${status}`);
  }
});

test('5xx is retryable but remains typed after attempts are exhausted', async () => {
  let calls = 0;
  let caught;
  try {
    await fetchBoundedWithRetry('https://example.com/a', {
      attempts: 2,
      fetchFn: async () => { calls += 1; return http(503); },
    });
  } catch (error) { caught = error; }
  assert.equal(calls, 2);
  assert.equal(classifyFetchFailure(caught).code, 'HTTP_5XX');
});

test('network error stays strict by default and never drops the public address-space guard', async () => {
  let calls = 0;
  let caught;
  try {
    await fetchBoundedWithRetry('https://example.com/a', {
      attempts: 1,
      fetchFn: async () => { calls += 1; throw new TypeError('Failed to fetch'); },
    });
  } catch (error) { caught = error; }
  assert.equal(calls, 1);
  assert.equal(classifyFetchFailure(caught).code, 'FETCH_NETWORK_ERROR');
});

test('network compatibility retry remains available only through explicit opt-in', async () => {
  let calls = 0;
  let caught;
  try {
    await fetchBoundedWithRetry('https://example.com/a', {
      attempts: 1,
      proxyCompatibilityFallback: true,
      fetchFn: async () => { calls += 1; throw new TypeError('Failed to fetch'); },
    });
  } catch (error) { caught = error; }
  assert.equal(calls, 2);
  assert.equal(classifyFetchFailure(caught).code, 'FETCH_NETWORK_ERROR');
});

test('timeout becomes FETCH_TIMEOUT rather than an untyped AbortError', async () => {
  let caught;
  try {
    await fetchBounded('https://example.com/a', {
      timeoutMs: 5,
      fetchFn: async (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
    });
  } catch (error) { caught = error; }
  const info = classifyFetchFailure(caught);
  assert.equal(info.code, 'FETCH_TIMEOUT');
  assert.equal(info.stage, 'FETCH');
});

test('oversized response becomes RESPONSE_TOO_LARGE', async () => {
  let caught;
  try {
    await fetchBounded('https://example.com/a', {
      maxBytes: 3,
      fetchFn: async () => new Response('1234'),
    });
  } catch (error) { caught = error; }
  assert.equal(classifyFetchFailure(caught).code, 'RESPONSE_TOO_LARGE');
});
