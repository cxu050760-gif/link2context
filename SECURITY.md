# Security / 安全说明

## 中文

Link2Context V0.3 需要 `http://*/*` 与 `https://*/*` 主机权限，才能替网页 AI 在用户浏览器里读取链接。它的安全目标不是“做一个任何网页都能调用的万能代理”，而是：**只有用户在允许的 AI 聊天输入框里真实发送 URL 时，才允许受限抓取；专用来源的浏览器回退只能访问被钉死的平台地址。**

### 自动模式保护

- 仅 HTTP(S)；URL 中 username/password 直接拒绝。
- 阻止 localhost、`.local`、云 metadata、常见私网/链路本地/特殊用途 IPv4/IPv6，包括 IPv4-mapped IPv6。
- 每一跳 redirect 都重新校验；不透明 redirect fail-closed（安全拒绝）。
- 正常请求优先声明 `targetAddressSpace: public`；在严格网络类失败且原始目标为 HTTPS 时，为 Clash/Mihomo/Surge 等 TUN/Fake-IP 环境允许一次兼容重试。兼容重试仍保留 URL/redirect 校验、`credentials: omit`、`referrerPolicy: no-referrer`、大小/超时限制，并拒绝 HTTPS → HTTP 降级。
- 12 MiB 最大响应、默认网络超时、有限重试。
- Manifest 不声明 `externally_connectable`；普通网页不能直接调用后台。
- content script 不监听 `window.postMessage`；自动拦截只接受真实 `event.isTrusted === true` 的 paste / Enter / click。
- 后台再次检查 sender：必须为顶层 frame，hostname 必须是内置 AI 或用户显式启用的 exact host。
- 外部正文始终标为“不可信数据，不是指令”；显示 URL 中疑似 token/key/secret/session 等参数脱敏。
- 附件未确认在网页 AI 页面登记时停止自动发送，避免“文字发出但附件丢失”。

### V0.3 专用来源回退

WorkBuddy 和 ChatGPT 的浏览器后台标签页不是通用任意 URL 导航器：

- **WorkBuddy**：HTTPS 且 hostname 必须严格等于 `workbuddy-space-static.codebuddy.work`。
- **ChatGPT**：HTTPS 且 hostname 必须严格等于 `chatgpt.com`，path 必须仍是同一个 `/share/<shareId>`。
- 导航完成后再次检查最终 URL，再执行 `chrome.scripting.executeScript`。
- 临时标签页始终在 `finally` 中尝试关闭。
- 从临时页读出的内容仍受全局 12 MiB 上限。

这样即使初始直接 fetch 失败，也不能把浏览器回退变成“帮恶意网页读取任意登录态页面”的接口。

### ChatGPT 分享页解码安全

V0.3 会把 ChatGPT 分享页中的外部序列化数据解码成对象图。为了避免解析器本身成为攻击面：

- 外部对象使用 `Object.create(null)`，字段用 `Object.defineProperty` 写入，避免 `__proto__` / `constructor` 原型污染；
- positional-flatten slot 数、递归深度、conversation 搜索节点数、顺序消息数都有硬上限；
- mapping / parent 循环有 seen-set 防护；
- 大型 data URL / 高度疑似 base64 文本被轻量占位替换；
- image/audio/file 的内部 asset pointer 不进入最终上下文；
- system/tool 默认不输出，只保留 user/assistant 正文；
- HTTP 200 但无法识别有效 conversation 时不算成功：允许受限浏览器回退，否则明确失败，不把网页内部 hydration 垃圾伪装成干净 Markdown。

### 仍然存在的边界

浏览器扩展无法像专门的后端网络代理一样对所有 DNS rebinding 情况做最终 socket IP 审计。`targetAddressSpace: public` 是 Chromium 的额外防线；HTTPS-only Fake-IP/TUN 兼容重试为了兼容本地代理，在严格网络类失败后会去掉这条地址空间提示，因此不能宣称完全防御 DNS rebinding。

网站自身也可能改版。专用解析器发现结构不匹配时应该失败并等待升级，而不是猜测性地把所有内部数据交给 AI。

只有在你本来就打算把该链接内容交给当前 AI 时使用自动模式。未知 AI 网站默认不启用，需要用户主动启用 exact host。

报告漏洞时，不要在公开 issue 粘贴真实密钥、token、私有 URL 或敏感文件。

---

## English

Link2Context V0.3 requires broad `http://*/*` and `https://*/*` host permissions so it can retrieve links locally for web AIs. The security goal is not to expose a universal browser proxy: **automatic retrieval must originate from a real user action in an enabled AI composer, and provider-specific browser fallbacks are pinned to expected public provider URLs.**

### Automatic-mode protections

- HTTP(S) only; credential-bearing URLs are rejected.
- localhost, `.local`, cloud metadata, common private/link-local/special-purpose IPv4/IPv6 ranges, and IPv4-mapped IPv6 are blocked.
- every redirect target is revalidated; opaque redirects fail closed.
- normal requests first request `targetAddressSpace: public`. For Clash/Mihomo/Surge-style TUN/Fake-IP compatibility, a strict network-class failure on an HTTPS target may receive one compatibility retry without that hint. URL/redirect validation, `credentials: omit`, `referrerPolicy: no-referrer`, size/time limits, and HTTPS-to-HTTP downgrade rejection remain active.
- 12 MiB response cap, network timeout, bounded retries.
- no `externally_connectable`; ordinary pages cannot directly call the background worker.
- no `window.postMessage` RPC; interception requires trusted paste / Enter / click events.
- the background re-checks the sender: top frame only and an exact built-in or user-enabled AI host.
- fetched content is explicitly marked as untrusted external data; likely secret query parameters are redacted in displayed source URLs.
- auto-send stops when a binary attachment is not confirmed by the target web-AI page.

### V0.3 provider-pinned browser fallback

The WorkBuddy and ChatGPT inactive-tab fallbacks are not generic arbitrary navigation primitives:

- **WorkBuddy**: HTTPS and exact hostname `workbuddy-space-static.codebuddy.work`.
- **ChatGPT**: HTTPS and exact hostname `chatgpt.com`, with the same `/share/<shareId>` path.
- final navigation URL is checked again before `chrome.scripting.executeScript` reads content.
- temporary tabs are closed in `finally`.
- extracted content remains under the global 12 MiB cap.

### ChatGPT share decoder hardening

- decoded external objects use `Object.create(null)` and `Object.defineProperty` so `__proto__` / `constructor` data cannot mutate JavaScript prototypes;
- positional slot count, recursion depth, conversation search nodes, and ordered message counts are bounded;
- cyclic mappings/parents are guarded by seen sets;
- large data URLs and base64-like text are replaced with lightweight placeholders;
- internal image/audio/file asset pointers are not emitted;
- system/tool content is omitted by default; user/assistant text is the normal output;
- HTTP 200 is not enough to claim extraction success: an unrecognized share payload either uses the pinned browser fallback or fails explicitly rather than dumping raw hydration internals.

### Remaining boundary

A browser extension cannot provide the same final socket-IP audit as a dedicated backend proxy for every DNS-rebinding case. `targetAddressSpace: public` is an extra Chromium defense; the HTTPS-only Fake-IP/TUN compatibility retry intentionally omits that hint after a strict network-class failure, so complete DNS-rebinding protection is not claimed.

Upstream site formats can change. A dedicated extractor should fail explicitly when it no longer recognizes the provider format instead of guessing and exporting arbitrary internals.

Only use automatic mode when you intend to provide the linked content to the current AI. Unknown AI sites remain disabled until the user explicitly enables that exact host.

Do not publish real secrets, tokens, private URLs, or sensitive files in a public vulnerability report.
