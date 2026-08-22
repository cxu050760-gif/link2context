# Security / 安全说明

## 中文

Link2Context V0.2.1 的能力比普通扩展强：它需要 `http://*/*` 与 `https://*/*` 主机权限，才能替网页 AI 在用户浏览器里抓取公开链接。因此设计目标不是“让任何网页都能调用一个万能代理”，而是“只有用户在允许的 AI 聊天输入框里真实发送 URL 时才执行”。

### 自动模式保护

- 仅 HTTP(S)；URL 中的 username/password 直接拒绝。
- 阻止 localhost、`.local`、云 metadata、常见私网/链路本地/特殊用途 IPv4 与 IPv6，包括 IPv4-mapped IPv6。
- 每一跳 redirect 都重新做 URL 安全校验；不透明 redirect fail-closed。
- 正常请求首先声明 `targetAddressSpace: public`，在支持的 Chromium 中增加实际网络地址空间约束。
- 为兼容 Clash/Mihomo/Surge 等 TUN/Fake-IP 环境：如果严格模式只以网络类错误失败，且原始目标是 **HTTPS**，会进行一次不携带 `targetAddressSpace` 的兼容重试。兼容重试仍然保持 URL 校验、每跳重定向校验、`credentials: omit`、`referrerPolicy: no-referrer`、大小/超时限制，并拒绝 HTTPS → HTTP 降级。
- 兼容重试不会用于 HTTP URL，也不会放行私网字面地址或私网重定向。
- 12 MiB 最大响应、25 秒默认超时、有限重试。
- Manifest 不声明 `externally_connectable`，普通网页不能直接调用扩展后台。
- content script 不监听 `window.postMessage`，自动拦截只接受 `event.isTrusted === true` 的用户 paste / Enter / click。
- 后台再次检查消息 sender：必须是顶层 frame，且 hostname 为内置 AI 或用户在弹窗中显式启用的 exact host。
- 外部正文按“不可信数据”处理；显示 URL 中疑似 token/key/secret/session 参数会脱敏。
- 附件未确认在网页 AI 页面登记时，停止自动发送，避免“文字发出但附件没跟上”。

### 仍然存在的边界

浏览器扩展无法像专门的后端网络代理一样，对所有 DNS rebinding 情况做最终 socket IP 审计。严格模式的 `targetAddressSpace: public` 是额外防线；V0.2.1 的 HTTPS-only 代理兼容重试为了兼容 Fake-IP/TUN 环境，会在严格网络类失败后放弃这一条地址空间提示，因此不能宣称完全防御 DNS rebinding。

兼容路径仍只接受真实用户在已允许 AI 页面触发的 HTTPS URL，并拒绝明文 HTTP 降级。不要把 Link2Context 改造成网页可静默远程调用的任意 URL API。

自动读取 URL 本身可能包含敏感内容。只有在你本来就打算把该链接内容交给当前 AI 时使用自动模式。未知 AI 网站默认不启用，需要用户主动点一次启用。

报告漏洞时，不要在公开 issue 粘贴真实密钥、token、私有 URL 或敏感文件。

## English

Link2Context V0.2.1 requires broad `http://*/*` and `https://*/*` host permissions so it can retrieve public links locally for a web AI. The design therefore avoids exposing an arbitrary fetch proxy to ordinary pages: automatic retrieval is tied to a real user action inside an enabled AI chat composer.

### Automatic-mode protections

- HTTP(S) only; credential-bearing URLs are rejected.
- localhost, `.local`, cloud metadata, common private/link-local/special-purpose IPv4 and IPv6 ranges, and IPv4-mapped IPv6 are blocked.
- every redirect destination is revalidated; opaque redirects fail closed.
- normal requests first ask for `targetAddressSpace: public` where Chromium supports it.
- for Clash/Mihomo/Surge-style TUN or Fake-IP compatibility: if strict mode fails only with a network-class error and the original target is **HTTPS**, Link2Context performs one compatibility retry without the `targetAddressSpace` hint. That retry still keeps URL validation, redirect revalidation, `credentials: omit`, `referrerPolicy: no-referrer`, size/time limits, and rejects HTTPS-to-HTTP downgrade redirects.
- the compatibility retry is never used for HTTP URLs and does not allow private literal targets or private redirects.
- 12 MiB response cap, 25-second default timeout, bounded retries.
- the manifest does not expose `externally_connectable`; ordinary pages cannot directly call the background worker.
- the content script does not consume `window.postMessage`; interception requires trusted paste / Enter / click events.
- the background re-checks the sender: top frame only, with an exact built-in or user-enabled AI host.
- fetched body text is marked as untrusted external data and likely secret query parameters are redacted in displayed source URLs.
- auto-send stops if a binary attachment is not confirmed by the target web-AI page.

### Remaining boundary

A browser extension cannot provide the same final socket-IP audit as a dedicated backend proxy for every DNS-rebinding case. Strict mode's `targetAddressSpace: public` is an extra Chromium defense. The V0.2.1 HTTPS-only proxy-compatibility retry intentionally omits that address-space hint after a strict network-class failure, so complete DNS-rebinding protection is not claimed.

The compatibility path is still limited to HTTPS URLs triggered by a real user action on an enabled AI page, and plaintext downgrade redirects are refused. Do not turn Link2Context into a remotely callable arbitrary-URL service.

Only use automatic mode when you actually intend to provide the linked content to the current AI. Unknown AI sites are disabled until the user explicitly enables that exact host.

Do not publish real secrets, tokens, private URLs, or sensitive files in a public vulnerability report.
