# Link2Context V0.2.1 Hotfix / 修复说明

## 中文

### 现象

在部分 Windows + Chrome + TUN/Fake-IP 代理环境中，网页 AI 自动拦截正常，但后台抓取公网 HTTPS 链接时报：

```text
Link2Context: Failed to fetch
```

浏览器直接打开同一链接通常正常。

### 根因

V0.2 为防御 DNS rebinding，在 Chromium `fetch()` 中显式设置了：

```js
targetAddressSpace: 'public'
```

Clash / Mihomo / Surge 等 Fake-IP 模式可能把正常公网域名暂时解析到 `198.18.0.0/15`。该网段是 RFC2544 benchmark 地址，Chromium 的网络地址空间分类会把它当成非 public 地址，因此严格 fetch 会失败，即使实际流量之后会被代理正确转发到公网。

### V0.2.1 修复

1. 第一次仍然使用严格 `targetAddressSpace: public`。
2. 严格模式只有在网络类错误时才考虑兼容回退。
3. 兼容回退只允许原始 **HTTPS** URL。
4. 兼容回退只重试一次，并移除 `targetAddressSpace` 提示。
5. 仍保留：私网/localhost/metadata 字面地址阻止、每跳 redirect 校验、`credentials: omit`、`referrerPolicy: no-referrer`、12 MiB 上限和超时。
6. 兼容回退拒绝 HTTPS → HTTP 降级。
7. HTTP URL 不使用兼容回退。

这使常见的 Clash/Mihomo Fake-IP 环境能够正常工作，同时避免把修复做成“关闭全部 SSRF 防护”。

## English

### Symptom

On some Windows + Chrome setups using TUN/Fake-IP proxies, automatic interception works but the extension background fetch fails with:

```text
Link2Context: Failed to fetch
```

The same URL can usually be opened normally in the browser.

### Root cause

V0.2 explicitly used:

```js
targetAddressSpace: 'public'
```

as an extra DNS-rebinding defense. Clash/Mihomo/Surge-style Fake-IP DNS can temporarily map ordinary public domains into `198.18.0.0/15` (RFC2544 benchmarking space). Chromium therefore sees the resolved destination as non-public and rejects the strict fetch even though the proxy would route the traffic to the real public destination.

### V0.2.1 fix

1. Strict `targetAddressSpace: public` remains the first attempt.
2. Compatibility fallback is considered only after a network-class strict failure.
3. Fallback is limited to original **HTTPS** URLs.
4. It retries once without the `targetAddressSpace` hint.
5. Private/localhost/metadata literal blocking, redirect validation, `credentials: omit`, `referrerPolicy: no-referrer`, size limits, and timeouts remain active.
6. HTTPS-to-HTTP downgrade redirects are rejected in fallback mode.
7. Plain HTTP URLs never receive this compatibility fallback.

This restores compatibility with common Fake-IP proxy environments without simply disabling the extension's URL safety model.
