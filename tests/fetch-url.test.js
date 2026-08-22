import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchBounded, fetchBoundedWithRetry } from '../extension/core/fetch-url.js';

function response(body = 'ok', init = {}) {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/plain', ...(init.headers || {}) }, ...init });
}

test('bounded fetch reads a normal public response', async () => {
  const seen = [];
  const out = await fetchBounded('https://example.com/a', { fetchFn: async (url, options) => { seen.push({ url, options }); return response('hello'); } });
  assert.equal(new TextDecoder().decode(out.bytes), 'hello');
  assert.equal(seen[0].options.credentials, 'omit');
  assert.equal(seen[0].options.redirect, 'manual');
  assert.equal(seen[0].options.referrerPolicy, 'no-referrer');
  assert.equal(seen[0].options.targetAddressSpace, 'public');
  assert.equal(out.compatibilityFallback, false);
});

test('public redirect is followed and each target is revalidated', async () => {
  let n = 0;
  const out = await fetchBounded('https://example.com/a', { fetchFn: async () => {
    n += 1;
    return n === 1 ? new Response(null, { status: 302, headers: { location: 'https://example.org/b' } }) : response('done');
  } });
  assert.equal(n, 2);
  assert.equal(out.finalUrl, 'https://example.org/b');
});

test('redirect to localhost is blocked before second request', async () => {
  let n = 0;
  await assert.rejects(() => fetchBounded('https://example.com', { fetchFn: async () => {
    n += 1;
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } });
  } }), /blocked|禁止/);
  assert.equal(n, 1);
});

test('hidden opaque redirects fail closed', async () => {
  const fake = { type: 'opaqueredirect', status: 0, headers: new Headers(), ok: false };
  await assert.rejects(() => fetchBounded('https://example.com', { fetchFn: async () => fake }), /hidden|隐藏/);
});

test('content-length larger than limit is rejected', async () => {
  await assert.rejects(() => fetchBounded('https://example.com', {
    maxBytes: 4,
    fetchFn: async () => response('tiny', { headers: { 'content-length': '5' } }),
  }), /exceeds|超过/);
});

test('streamed body larger than limit is rejected even without content-length', async () => {
  await assert.rejects(() => fetchBounded('https://example.com', { maxBytes: 3, fetchFn: async () => response('1234') }), /exceeds|超过/);
});

test('network errors retry once', async () => {
  let n = 0;
  const out = await fetchBoundedWithRetry('https://example.com', { attempts: 2, fetchFn: async () => {
    n += 1;
    if (n === 1) throw new TypeError('Failed to fetch');
    return response('ok');
  } });
  assert.equal(n, 2);
  assert.equal(new TextDecoder().decode(out.bytes), 'ok');
  assert.equal(out.compatibilityFallback, false);
});

test('strict address-space failure falls back once without targetAddressSpace for HTTPS proxy/fake-IP compatibility', async () => {
  const seen = [];
  const out = await fetchBoundedWithRetry('https://example.com/data', {
    attempts: 1,
    fetchFn: async (_url, options) => {
      seen.push(options);
      if (options.targetAddressSpace === 'public') throw new TypeError('Failed to fetch');
      return response('proxy-ok');
    },
  });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].targetAddressSpace, 'public');
  assert.equal('targetAddressSpace' in seen[1], false);
  assert.equal(seen[1].credentials, 'omit');
  assert.equal(seen[1].redirect, 'manual');
  assert.equal(seen[1].referrerPolicy, 'no-referrer');
  assert.equal(out.compatibilityFallback, true);
  assert.equal(new TextDecoder().decode(out.bytes), 'proxy-ok');
});

test('proxy compatibility fallback can be disabled', async () => {
  let n = 0;
  await assert.rejects(() => fetchBoundedWithRetry('https://example.com', {
    attempts: 1,
    proxyCompatibilityFallback: false,
    fetchFn: async () => { n += 1; throw new TypeError('Failed to fetch'); },
  }), /Failed to fetch/);
  assert.equal(n, 1);
});

test('proxy compatibility fallback is HTTPS-only', async () => {
  let n = 0;
  await assert.rejects(() => fetchBoundedWithRetry('http://example.com', {
    attempts: 1,
    fetchFn: async () => { n += 1; throw new TypeError('Failed to fetch'); },
  }), /Failed to fetch/);
  assert.equal(n, 1);
});

test('compatibility fallback still blocks private redirect before the second request', async () => {
  let n = 0;
  await assert.rejects(() => fetchBoundedWithRetry('https://example.com', {
    attempts: 1,
    fetchFn: async (_url, options) => {
      n += 1;
      if (options.targetAddressSpace === 'public') throw new TypeError('Failed to fetch');
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } });
    },
  }), /blocked|禁止/);
  assert.equal(n, 2);
});

test('compatibility fallback refuses HTTPS to HTTP downgrade redirects', async () => {
  let n = 0;
  await assert.rejects(() => fetchBoundedWithRetry('https://example.com', {
    attempts: 1,
    fetchFn: async (_url, options) => {
      n += 1;
      if (options.targetAddressSpace === 'public') throw new TypeError('Failed to fetch');
      return new Response(null, { status: 302, headers: { location: 'http://example.org/plain' } });
    },
  }), /HTTPS-only|仅允许 HTTPS/);
  assert.equal(n, 2);
});

test('non-retryable HTTP 404 is not retried or compatibility-fetched', async () => {
  let n = 0;
  await assert.rejects(() => fetchBoundedWithRetry('https://example.com', { attempts: 2, fetchFn: async () => {
    n += 1;
    return new Response('no', { status: 404 });
  } }), /HTTP 404/);
  assert.equal(n, 1);
});

test('timeout aborts a stuck fetch', async () => {
  await assert.rejects(() => fetchBounded('https://example.com', {
    timeoutMs: 10,
    fetchFn: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  }), /aborted/);
});
