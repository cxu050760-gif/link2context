# Security / 安全说明

## 中文

Link2Context V0.5.3 需要 `http://*/*` 与 `https://*/*` 主机权限，才能替网页 AI 在用户浏览器里读取链接。安全目标不是“任何网页都能调用的万能代理”，而是：**只有用户在允许的 AI 聊天输入框里真实发送 URL 时，才允许受限抓取；普通抓取默认不带登录态；需要浏览器上下文时必须由用户显式授权，并且可撤销、可按 host 禁用。**

### V0.5.3 新增的页面交付边界

真实千问测试证明：**DOM 中看得到文本或附件卡片，不等于网页 AI 的内部发送状态真的包含这些内容。** 具体失败表现曾是：扩展生成的内容无法删除，用户另外输入文字后发送，最终只发送了用户后来输入的文字。因此 V0.5.3 不再把“可见”当作充分成功证据。

- Qwen / Tongyi 普通文本交付使用浏览器编辑路径，不直接设置 `innerHTML` / `textContent`，也不在写入后伪造 `InputEvent`；
- 写入文本必须在失焦/回焦后仍可读，并且千问自身的发送控件必须自行进入可用状态，否则返回 `QWEN_EDITOR_STATE_UNCONFIRMED`；
- PDF / 图片等原始二进制仍可走网页文件输入，但附件名可见本身不够，必须同时看到网页自身可用的发送控件，否则返回 `QWEN_ATTACHMENT_STATE_UNCONFIRMED`；
- Qwen 专用适配层先于通用 V0.5.3 runtime 处理同一次用户手势，并对已接管事件停止继续传播，避免两个状态机竞争；
- 自动发送点击不算成功，必须看到生成状态或消息真正离开 composer 的独立证据，否则返回 `SEND_UNCONFIRMED`；
- Link2Context 永不强行移除网页控件的 `disabled` / `aria-disabled`；
- STOP 会同时中止网络读取、附件等待、编辑器交付与自动发送等待。

### URL / 网络边界

- 仅允许 HTTP / HTTPS；
- URL 内嵌用户名或密码会被拒绝；
- localhost、私网、链路本地、特殊用途 IP 与云 metadata 目标被阻止；
- 每次重定向都重新校验；
- 响应大小、超时、重试与取消均受限制；
- 自动抓取必须来自真实用户事件，background 还会再次验证调用方网页 AI host；
- 页面正文会作为**不可信数据**交付给 AI，而不是作为系统指令执行。

### 浏览器上下文授权

V0.5.2 引入、V0.5.3 保留的 Authorized Browser Context 默认关闭：

- 普通抓取不带登录态；
- 401 / 403 / `CLIENT_RENDER_CONTENT_MISSING` 只有用户显式授权后才可进入浏览器上下文回退；
- 授权可以全局撤销，并支持 host deny list；
- Link2Context 不使用 `chrome.cookies` 直接读取或保存 Cookie 值；
- 授权标签页中的站点上下文只用于用户明确授权的目标，目标 URL 与最终 URL仍重新校验；
- 授权不是绕过登录、验证码、DRM、付费墙或站点访问控制的机制；这些限制导致失败时必须明确失败。

### 数据最小化

- 外部 URL 展示时会脱敏常见 credential/token 查询参数；
- ChatGPT Share / WorkBuddy Share 清理系统、工具、大块 base64、推理等非必要内容；
- 外部反序列化对象使用安全结构，避免 `__proto__` 原型污染；
- 文件名会做安全化与长度限制；
- 二进制类型先看字节签名/MIME/扩展名，避免误解码成文本。

V0.5.3 当前仍为 Draft 候选。自动化测试通过不代表第三方网页今天的 DOM 一定兼容，真实浏览器 smoke 仍是合并门槛。

---

## English

Link2Context V0.5.3 requests `http://*/*` and `https://*/*` host permissions so it can acquire URLs on behalf of a web-AI chat. The security goal is not a universal proxy callable by arbitrary pages. **Restricted acquisition starts only from a real user URL gesture in an allowed AI composer; ordinary fetching is unauthenticated by default; browser-context reuse requires explicit, revocable user authorization and can be denied per host.**

### V0.5.3 page-handoff boundary

Live Qwen testing demonstrated that **text or an attachment-looking card being visible in the DOM does not prove that the web AI's internal send state contains it.** One observed failure left extension-created content undeletable; after the user typed additional characters, Qwen sent only those newly typed characters. V0.5.3 therefore rejects visibility-only success.

- Ordinary Qwen/Tongyi text delivery uses the browser editing path instead of assigning `innerHTML` / `textContent` or manufacturing a synthetic `InputEvent` after the write.
- Text must survive blur/refocus reconciliation and Qwen's own send control must become enabled; otherwise the result is `QWEN_EDITOR_STATE_UNCONFIRMED`.
- Original PDF/image/binary resources may still use the site's file input, but filename visibility alone is insufficient; an enabled site send control is also required or the result is `QWEN_ATTACHMENT_STATE_UNCONFIRMED`.
- The Qwen-specific adapter owns an intercepted user gesture before the generic V0.5.3 runtime and stops further propagation for that gesture, preventing competing handoff state machines.
- An auto-send click is never success by itself. Independent generation/message evidence is required or the result is `SEND_UNCONFIRMED`.
- Link2Context never force-removes `disabled` / `aria-disabled` from site controls.
- STOP cancels network acquisition, attachment waiting, editor handoff, and auto-send waiting.

### URL / network boundary

- HTTP / HTTPS only.
- Embedded URL credentials are rejected.
- localhost, private/link-local/special-purpose address space, and cloud metadata targets are blocked.
- Every redirect destination is revalidated.
- Response size, timeout, retry, and cancellation are bounded.
- Automatic acquisition requires a real user event and the background validates the calling web-AI host again.
- Extracted page content is explicitly treated as untrusted data, not system instructions.

### Authorized Browser Context

The Authorized Browser Context introduced in V0.5.2 and retained in V0.5.3 is off by default:

- Ordinary acquisition does not reuse login state.
- 401 / 403 / `CLIENT_RENDER_CONTENT_MISSING` may use browser context only after explicit user authorization.
- Authorization is globally revocable and hosts can be deny-listed.
- Link2Context does not directly read or store Cookie values through `chrome.cookies`.
- Target and final URLs remain revalidated when authorized browser context is used.
- Authorization is not a mechanism for bypassing login walls, CAPTCHAs, DRM, paywalls, or site access control; those failures remain explicit.

### Data minimization

- Common credential/token query parameters are redacted in displayed source URLs.
- ChatGPT Share / WorkBuddy Share cleanup excludes unnecessary system/tool/base64/reasoning payloads.
- External serialized objects are decoded safely against `__proto__` prototype pollution.
- Attachment names are sanitized and bounded.
- Binary classification uses byte signatures/MIME/extensions before text decoding.

V0.5.3 remains a Draft candidate. Green automation does not prove that a third-party site's live DOM is still compatible, so live-browser smoke remains a merge gate.
