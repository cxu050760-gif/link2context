const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^0\./,
  /^224\./,
  /^240\./,
];

const SENSITIVE_QUERY_KEY = /(token|key|secret|signature|sig|auth|password|passwd|credential|session|jwt|api[-_]?key)/i;

function isPrivate172(host) {
  const m = /^172\.(\d{1,3})\./.exec(host);
  if (!m) return false;
  const n = Number(m[1]);
  return n >= 16 && n <= 31;
}

function isPrivateIpv6(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb');
}

export function validatePublicHttpUrl(input) {
  let url;
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(input);
  } catch {
    throw new Error('Invalid URL / 无效链接');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP(S) URLs are allowed / 仅允许 HTTP(S) 链接');
  }
  if (url.username || url.password) {
    throw new Error('Credentialed URLs are blocked / 禁止在链接中携带账号密码');
  }

  const host = url.hostname.toLowerCase();
  if (!host) throw new Error('Missing hostname / 缺少域名');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error('Local network targets are blocked / 禁止访问本机或局域网地址');
  }
  if (host === 'metadata.google.internal' || host === 'metadata.azure.internal') {
    throw new Error('Cloud metadata targets are blocked / 禁止访问云元数据地址');
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (PRIVATE_IPV4.some((re) => re.test(host)) || isPrivate172(host)) {
      throw new Error('Private/reserved IPv4 targets are blocked / 禁止访问私有或保留 IPv4 地址');
    }
  }
  if (host.includes(':') && isPrivateIpv6(host)) {
    throw new Error('Private/reserved IPv6 targets are blocked / 禁止访问私有或保留 IPv6 地址');
  }

  url.hash = '';
  return url;
}

export function validateRedirect(baseUrl, location) {
  if (!location) throw new Error('Redirect without Location header / 重定向缺少 Location');
  return validatePublicHttpUrl(new URL(location, baseUrl));
}

export function safeDisplayUrl(input) {
  const url = input instanceof URL ? new URL(input.href) : new URL(input);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.set(key, '[REDACTED]');
  }
  return url.href;
}
