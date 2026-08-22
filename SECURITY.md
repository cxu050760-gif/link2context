# Security / 安全说明

## 中文

Link2Context V0.5.2 需要 `http://*/*` 与 `https://*/*` 主机权限，才能替网页 AI 在用户浏览器里读取链接。安全目标不是“任何网页都能调用的万能代理”，而是：**只有用户在允许的 AI 聊天输入框里真实发送 URL 时，才允许受限抓取；普通抓取默认不带登录态；需要浏览器上下文时必须由用户显式授权，并且可撤销、可按 host 禁用。**

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
- 发送成功不能只靠“点击过按钮”判定；V0.5.2 要求额外页面证据，并给旧 snapshot / 附件 proof 设置生命周期，减少跨任务误判。

### V0.4 二进制安全出口

通用资源在任何文本解码之前先做 byte-first 类型识别：Magic Header / MIME / URL extension / text plausibility。

- `%PDF-`、PNG/JPEG、ZIP、音视频等强签名优先于错误的文本 MIME；
- 服务器即使声明 `text/html` / `application/json`，但字节明显含 NUL / binary control，也 fail-closed 成二进制；
- PDF、图片、archive、Office、音视频和 unknown binary 默认保持原文件附件；
- 二进制不允许默认进入 `decodeBytes → Markdown` 路径。

这避免二进制乱码污染上下文、撑爆消息或被错误解释成文本指令。

### 通用 Browser Context fallback：默认关闭，显式授权后最小使用

V0.4 已能识别“HTML 抓到了，但只是 client-render shell”的场景。V0.5 起，401 / 403 / `CLIENT_RENDER_CONTENT_MISSING` 在**用户显式授权**后可以进入受控浏览器上下文回退；V0.5.2 继续加固这一边界。

关键规则：

- **未授权时不使用登录态。** 普通网络抓取仍保持 `credentials: omit`；需要 browser context 时返回明确的授权要求，而不是静默继续。
- **授权必须由用户主动开启。** 状态保存在扩展 storage 以便持续使用，但用户可全局撤销；`browserContextDeniedHosts` 可把具体 host 永久排除在授权回退之外。
- **不直接读取或保存 Cookie 值。** 扩展不使用 `chrome.cookies` API。授权路径是在受控后台标签页中使用浏览器已有站点上下文；二进制需要重新读取时，站点页内 fetch 才使用 `credentials: include`。
- **请求 URL 与最终 URL 继续重新验证。** 授权不等于放弃 SSRF / redirect / public HTTP(S) 边界；标签页跳转到不允许目标时必须 fail-closed。
- **授权不是绕过访问控制。** 登录页、验证码、付费墙、DRM、CDN/403 或站点自身拒绝在授权后仍可能失败；失败必须明确返回，不能伪造成功。
- **过程可见且可取消。** 进度面板会显示授权浏览器回退状态；STOP / AbortSignal 继续传递到后台标签页流程。
- **窗口归属保持一致。** 后台 fallback 可沿用发起任务标签页的 `windowId`，避免把授权读取随意开到另一个浏览器窗口。

WorkBuddy 和 ChatGPT Share 的既有公开分享 fallback 仍有更窄的固定边界：

- WorkBuddy 只允许 `https://workbuddy-space-static.codebuddy.work/...`；
- ChatGPT Share 只允许同一个 `https://chatgpt.com/share/<shareId>`。

### V0.5.2 交付可靠性边界

- Auto-send 仍是显式 opt-in，手动确认为默认。
- 禁止把 `disabled / aria-disabled` 发送控件强行改成可用。
- `click()` 成功本身不是发送成功；必须观察独立页面证据。
- 旧 runtime 报告 `sent` 时，V0.5.2 仍会独立核验；没有证据就抑制成功并 fail-closed。
- 附件证据通过 MutationObserver 观察后才允许镜像；仅给候选 composer 使用，并设置 TTL，隐藏的镜像节点不能反过来制造新证据。
- Qwen `.md → .txt` 兼容只允许扩展自己触发的 synthetic file event、且必须是 Qwen/Tongyi + 用户显式 document 模式；文件内容不修改，真实用户文件事件不适配。
- 自动发送等待期间允许重新定位重渲染后的 composer，但仍只使用具备明确发送语义且已启用的控件。

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

403、401、CAPTCHA、DRM、付费墙、站点访问控制不会被 Link2Context 保证绕过。**显式 browser-context 授权只是允许在用户已有站点会话中继续尝试读取，不代表获得新的访问权限。**

网站结构可能变化。专用解析器结构不匹配时应失败等待升级，不应猜测性输出内部数据。

只有在你本来就打算把该链接内容交给当前 AI 时使用自动模式。未知 AI 网站默认不启用，需要用户主动启用 exact host。

报告漏洞时，不要在公开 issue 粘贴真实密钥、token、私有 URL 或敏感文件。

---

## English

Link2Context V0.5.2 requires broad HTTP(S) host permissions, but it is not intended to become a universal browser proxy. Automatic retrieval must originate from a real user action in an enabled AI composer. Normal fetching does not use the logged-in browser session; browser-context fallback requires explicit user authorization and remains revocable and deny-listable per host.

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
- send success needs independent page evidence; a successful button click alone is insufficient.

### V0.4 binary safety exit

Resource classification happens before generic text decoding. Magic signatures, MIME, extension hints, and byte-level text plausibility are combined. Strong binary signatures beat misleading textual MIME, and clearly binary bytes fail closed even behind `text/html` or `application/json`.

PDF, images, archives, Office files, audio/video, and unknown binary default to original-file attachments and do not fall through to Markdown decoding.

### Generic browser-context fallback: off by default, explicit opt-in

V0.5 turns the former “future capability” into an explicit authorization boundary for 401 / 403 / `CLIENT_RENDER_CONTENT_MISSING` cases:

- normal public fetching keeps `credentials: omit` and never silently borrows the logged-in session;
- the user must explicitly enable authorized browser context in the extension popup;
- authorization can be revoked globally and individual hosts can be blocked through the deny list;
- Link2Context does not use `chrome.cookies` to read or persist cookie values; an authorized background tab uses the browser's existing site context, and in-page binary refetch may use `credentials: include`;
- requested and final URLs are still revalidated, and size/time/cancellation limits remain active;
- authorization does not promise to bypass authentication walls, CAPTCHAs, DRM, paywalls, CDNs, or site access controls;
- authorized fallback is visible in progress reporting and remains cancellable;
- the fallback can remain in the originating browser window via `windowId` rather than opening arbitrarily elsewhere.

WorkBuddy and ChatGPT Share keep their narrower public-share fallbacks pinned to their exact official hosts/paths.

### V0.5.2 handoff reliability boundary

- Auto-send remains explicit opt-in; manual review is the default.
- Disabled / aria-disabled send controls are never force-enabled.
- Legacy `sent` status is independently verified and suppressed fail-closed without evidence.
- Attachment proof must be observed, may be mirrored only into candidate composer scopes, expires with a TTL, and extension-owned hidden proof cannot recursively manufacture new proof.
- Qwen Markdown-to-text filename/MIME adaptation is limited to extension-generated synthetic file events under explicit Qwen/Tongyi document mode; content is unchanged and trusted user file events are untouched.
- Composer rerenders may be re-resolved while waiting, but document-wide fallback only accepts enabled controls with strong send semantics.

### Safe pagination

Pagination is same-origin, bounded to eight pages, globally byte-capped, loop-protected, and limited to strong `rel=next` or clear same-article pagination. Later-page failure yields partial content instead of cross-site crawling.

### Remaining boundary

Complete DNS-rebinding protection is not claimed. Authentication, 403 blocking, CAPTCHAs, DRM, paywalls, and site access controls are not guaranteed to be bypassed. Explicit browser-context authorization only permits another attempt inside the user's existing site session; it grants no new access rights.

Only use automatic mode when you intend to provide the linked content to the current AI. Unknown AI sites remain disabled until explicitly enabled.
