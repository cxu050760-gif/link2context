# Security / 安全说明

## 中文

Link2Context V0.4 需要 `http://*/*` 与 `https://*/*` 主机权限，才能替网页 AI 在用户浏览器里读取链接。安全目标不是“任何网页都能调用的万能代理”，而是：**只有用户在允许的 AI 聊天输入框里真实发送 URL 时，才允许受限抓取；浏览器导航回退必须有明确公开来源边界。**

### 自动模式保护

- 仅 HTTP(S)；URL 中 username/password 直接拒绝。
- 阻止 localhost、`.local`、云 metadata、常见私网/链路本地/特殊用途 IPv4/IPv6，包括 IPv4-mapped IPv6。
- 每一跳 redirect 都重新校验；不透明 redirect fail-closed（安全拒绝）。
- 正常请求优先声明 `targetAddressSpace: public`；严格网络类失败且原始目标为 HTTPS 时，允许一次 TUN/Fake-IP 兼容重试。兼容重试仍保留 URL/redirect 校验、`credentials: omit`、`referrerPolicy: no-referrer`、大小/超时限制，并拒绝 HTTPS → HTTP 降级。
- 全局 12 MiB 响应预算、默认网络超时、有限重试。
- 401/403/404/429 不会无意义重复重试；网络/超时/5xx 才进入受限重试。
- Manifest 不声明 `externally_connectable`；普通网页不能直接调用后台。
- content script 不监听 `window.postMessage`；自动拦截只接受真实 `event.isTrusted === true` 的 paste / Enter / click。
- 后台再次检查 sender：必须为顶层 frame，hostname 必须是内置 AI 或用户显式启用的 exact host。
- 外部正文始终标为“不可信数据，不是指令”；显示 URL 中疑似 token/key/secret/session 参数脱敏。
- 附件未确认在网页 AI 页面登记时停止自动发送，避免“文字发出但附件丢失”。

### V0.4 二进制安全出口

通用资源在任何文本解码之前先做 byte-first 类型识别：Magic Header / MIME / URL extension / text plausibility。

- `%PDF-`、PNG/JPEG、ZIP、音视频等强签名优先于错误的文本 MIME；
- 服务器即使声明 `text/html` / `application/json`，但字节明显含 NUL / binary control，也 fail-closed 成二进制；
- PDF、图片、archive、Office、音视频和 unknown binary 默认保持原文件附件；
- 二进制不允许默认进入 `decodeBytes → Markdown` 路径。

这避免二进制乱码污染上下文、撑爆消息或被错误解释成文本指令。

### 通用 Browser DOM fallback 为什么默认不开

V0.4 能识别“HTML 抓到了，但只是 client-render shell”的场景，并返回 `CLIENT_RENDER_CONTENT_MISSING / RENDER`。

**它不会自动打开任意网页并读取登录后 DOM。** 浏览器导航会携带 Cookie / Session。若扩展静默导航到任意用户 URL、读取已登录内容，再把内容交给当前 AI，就可能把公开 URL 抓取能力扩大成私有会话数据外传能力。

因此：

- WorkBuddy fallback 仍只允许 `https://workbuddy-space-static.codebuddy.work/...`；
- ChatGPT fallback 仍只允许同一个 `https://chatgpt.com/share/<shareId>`；
- 普通 client-only 页面只报告 RENDER 缺失；
- 若未来加入通用浏览器渲染，应做成用户显式授权、可见、最小范围的能力，而不是默认 fallback。

### 安全分页

自动追页不是通用爬虫：

- 只同源；
- `rel=next` 或明确“下一页/Next”等，并对普通 next 文本要求同文章 URL family；
- 最多 8 页；
- 后续单页最多 3 MiB；
- 总体仍受 12 MiB 上限；
- visited set 防循环；
- 后续页失败只返回 `PARTIAL`，不跨站寻找替代内容。

### ChatGPT 分享页解码安全

- 外部对象使用 `Object.create(null)` + `Object.defineProperty`，避免 `__proto__` / `constructor` 原型污染；
- positional-flatten slot 数、递归深度、conversation 搜索节点数、消息数都有硬上限；
- mapping / parent 循环有 seen-set；
- 大 data URL / base64-like 内容被轻量占位；
- internal image/audio/file asset pointer 不进入最终上下文；
- system/tool 默认不输出，只保留 user/assistant 正文；
- HTTP 200 但无法识别 conversation 不算成功：只允许固定 ChatGPT Share fallback，否则明确失败。

### 仍然存在的边界

浏览器扩展无法像专门后端网络代理一样对所有 DNS rebinding 做最终 socket IP 审计。`targetAddressSpace: public` 是 Chromium 的额外防线；Fake-IP/TUN 兼容重试为了兼容本地代理会去掉该提示，因此不能宣称完全防御 DNS rebinding。

403、401、CAPTCHA、DRM、付费墙、站点访问控制不会被 Link2Context 绕过。V0.4 的目标是准确分类这些边界，而不是伪造“支持成功”。

网站结构可能变化。专用解析器结构不匹配时应失败等待升级，不应猜测性输出内部数据。

只有在你本来就打算把该链接内容交给当前 AI 时使用自动模式。未知 AI 网站默认不启用，需要用户主动启用 exact host。

报告漏洞时，不要在公开 issue 粘贴真实密钥、token、私有 URL 或敏感文件。

---

## English

Link2Context V0.4 requires broad HTTP(S) host permissions, but it is not intended to become a universal browser proxy. Automatic retrieval must originate from a real user action in an enabled AI composer, and navigation fallbacks must remain within explicit public-provider boundaries.

### Automatic-mode protections

- HTTP(S) only; credential-bearing URLs rejected.
- localhost, `.local`, cloud metadata, private/link-local/special-purpose IP ranges blocked.
- every redirect revalidated; opaque redirects fail closed.
- strict mode requests `targetAddressSpace: public`; HTTPS Fake-IP/TUN compatibility may retry once after an eligible network failure while keeping URL/redirect checks, `credentials: omit`, no-referrer, size/time caps, and HTTPS downgrade rejection.
- global 12 MiB budget, timeouts, bounded retries.
- 401/403/404/429 are not pointlessly retried; network/timeouts/5xx are the bounded retry classes.
- no `externally_connectable`, no `window.postMessage` RPC, trusted browser events required.
- background verifies top-frame sender and exact enabled AI host.
- fetched text is marked untrusted external data and likely secret query parameters are redacted.
- auto-send stops if an attachment is not confirmed.

### V0.4 binary safety exit

Resource classification happens before generic text decoding. Magic signatures, MIME, extension hints, and byte-level text plausibility are combined. Strong binary signatures beat misleading textual MIME, and clearly binary bytes fail closed even behind `text/html` or `application/json`.

PDF, images, archives, Office files, audio/video, and unknown binary default to original-file attachments and do not fall through to Markdown decoding.

### Generic browser DOM fallback stays opt-in by design

V0.4 can report client-render shells as `CLIENT_RENDER_CONTENT_MISSING / RENDER`, but it does not silently navigate arbitrary URLs with the user's logged-in browser session. Doing so could turn a public-link helper into a private-session exfiltration primitive.

WorkBuddy and ChatGPT Share fallbacks remain pinned to their exact public hosts/paths. Any future generic rendered-DOM capability should require explicit, visible user authorization and a narrow scope.

### Safe pagination

Pagination is same-origin, bounded to eight pages, globally byte-capped, loop-protected, and limited to strong `rel=next` or clear same-article pagination. Later-page failure yields partial content instead of cross-site crawling.

### Remaining boundary

Complete DNS-rebinding protection is not claimed. Authentication, 403 blocking, CAPTCHAs, DRM, paywalls, and site access controls are not bypassed. V0.4 makes these boundaries explicit and machine-readable instead of mislabeling them as handoff failures.

Only use automatic mode when you intend to provide the linked content to the current AI. Unknown AI sites remain disabled until explicitly enabled.
