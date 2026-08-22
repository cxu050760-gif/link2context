const SENSITIVE_QUERY_KEY = /(token|key|secret|signature|sig|auth|password|passwd|credential|session|jwt|api[-_]?key)/i;

function parseIpv4(host) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return null;
  const octets = host.split('.').map(Number);
  if (octets.some((n) => n < 0 || n > 255)) return null;
  return octets;
}

function isBlockedIpv4(host) {
  const o = parseIpv4(host);
  if (!o) return false;
  const [a, b, c] = o;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 192 && b === 88 && c === 99) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function isBlockedIpv6(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === '::1' || h === '::') return true;
  if (/^(fc|fd)/.test(h)) return true; // unique local fc00/7
  if (/^fe[89ab]/.test(h)) return true; // link-local fe80/10
  if (/^ff/.test(h)) return true; // multicast
  if (h.startsWith('2001:db8:') || h === '2001:db8::') return true; // documentation
  if (h.startsWith('::ffff:')) return true; // IPv4-mapped form: fail closed
  if (h.startsWith('64:ff9b:')) return true; // well-known NAT64 prefix: avoid private-v4 tunnelling
  return false;
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
  if (isBlockedIpv4(host)) {
    throw new Error('Private/reserved IPv4 targets are blocked / 禁止访问私有或保留 IPv4 地址');
  }
  if (host.includes(':') && isBlockedIpv6(host)) {
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
