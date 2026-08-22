# Security / 安全说明

## 中文

Link2Context V0.5.3 需要 `http://*/*` 与 `https://*/*` 主机权限，才能替网页 AI 在用户浏览器里读取链接。V0.5.3 还为中国千问增加了 `debugger`（Chrome 调试器）权限，用于解决受控富文本编辑器“DOM 看得到、真实发送状态却没有内容”的问题。

安全目标不是“任何网页都能调用的万能代理/万能浏览器控制器”，而是：**只有用户在允许的 AI 聊天输入框里真实提交 URL 时，才允许受限抓取；普通抓取默认不带登录态；需要浏览器上下文时必须显式授权；千问调试输入只允许在指定千问域名、顶层页面和极少数固定输入动作中使用。**

### V0.5.3：为什么需要 `debugger`

真实 `www.qianwen.com` 测试曾出现：扩展生成的内容能显示在输入区，但无法正常删除；用户后来手动输入几个字后，真正发送出去的只有后来输入的文字。这证明直接修改 DOM 或调用旧式编辑命令并不能可靠进入千问内部的受控编辑状态。

V0.5.3 因此改用 Chrome DevTools Protocol（CDP，Chrome 调试协议）的真实输入路径：

- 文本：`Input.insertText`；
- 自动发送：`Input.dispatchKeyEvent`，仅发送 Enter 的 `rawKeyDown` / `keyUp`；
- 不使用 `Runtime.evaluate` 执行任意页面脚本；
- 不通过 debugger Network 域读取额外网络流量；
- 不通过 debugger 读取 Cookie、Local Storage 或浏览器凭据；
- 不把 `debugger` 暴露为通用网页自动化接口。

### `debugger` 权限收口

`debugger` 是强权限，因此 V0.5.3 在后台增加了明确的硬边界：

- 只处理扩展内部消息类型 `L2C_QIANWEN_CDP`；
- 只允许顶层 frame，子 frame 会返回 `QIANWEN_DEBUGGER_FRAME_DENIED`；
- 调用方页面必须属于 `qianwen.com` / `www.qianwen.com` / 其子域，或 `qwenwork.cn` / 其子域；其他 host 返回 `QIANWEN_DEBUGGER_HOST_DENIED`；
- 必须存在真实 sender tab；
- 只允许 `insertText` 与 `pressEnter` 两种动作，其他动作返回 `QIANWEN_DEBUGGER_ACTION_INVALID`；
- 单次文本上限 180,000 字符；
- 每次操作临时 `attach`，完成或失败后都在 `finally` 中 `detach`；
- 如果标签页已被 DevTools 或其他调试器占用，返回 `QIANWEN_DEBUGGER_BUSY` / attach failure，不抢占、不绕过。

Chrome 在此期间可能显示“扩展正在调试浏览器/标签页”的提示，这是 `chrome.debugger` 的浏览器级可见安全提示，不应隐藏。

### 页面交付成功边界

V0.5.3 不把“页面上看得到”作为充分成功证据：

- 中国千问文本通过 CDP `Input.insertText` 后，必须再次读取正文签名，并经过 blur/refocus（失焦/回焦）后仍保持；否则返回 `QIANWEN_CDP_STATE_UNCONFIRMED`；
- 千问自动发送通过真实 Enter 后，还必须观察到生成状态或消息离开 composer（输入区）等独立证据，否则返回 `SEND_UNCONFIRMED`；
- PDF / 图片等原始二进制仍保持文件附件，不把二进制强行解码成文本；
- 通用网页 AI 的自动发送同样遵循 fail-closed（失败时拒绝假成功）；
- Link2Context 永不强行移除网页控件的 `disabled` / `aria-disabled`；
- STOP 会中止网络读取、分页、附件等待、编辑器交付和自动发送等待。

### URL / 网络边界

- 仅允许 HTTP / HTTPS；
- URL 内嵌用户名或密码会被拒绝；
- localhost、私网、链路本地、特殊用途 IP 与云 metadata（元数据）目标被阻止；
- 每次重定向都重新校验；
- 响应大小、超时、重试与取消均受限制；
- 自动抓取必须来自真实用户事件，background（后台）还会再次验证调用方网页 AI host；
- 页面正文会作为**不可信数据**交付给 AI，而不是作为系统指令执行。

### 浏览器上下文授权

V0.5.2 引入、V0.5.3 保留的 Authorized Browser Context（授权浏览器上下文）默认关闭：

- 普通抓取不带登录态；
- 401 / 403 / `CLIENT_RENDER_CONTENT_MISSING` 只有用户显式授权后才可进入浏览器上下文回退；
- 授权可以全局撤销，并支持 host deny list（按站点禁用列表）；
- Link2Context 不使用 `chrome.cookies` 直接读取或保存 Cookie 值；
- 授权标签页中的站点上下文只用于用户明确授权的目标，目标 URL 与最终 URL 仍重新校验；
- 授权不是绕过登录、验证码、DRM、付费墙或站点访问控制的机制；这些限制导致失败时必须明确失败。

### 数据最小化

- 外部 URL 展示时会脱敏常见 credential/token（凭据/令牌）查询参数；
- ChatGPT Share / WorkBuddy Share 清理系统、工具、大块 base64、推理等非必要内容；
- 外部反序列化对象使用安全结构，避免 `__proto__` 原型污染；
- 文件名会做安全化与长度限制；
- 二进制类型先看字节签名/MIME/扩展名，避免误解码成文本。

### V0.5.3 验证状态

- PR #10 已合并到 `main`；
- `npm run check`：通过；
- 全量 `npm test`：292 / 292 通过；
- GitHub Actions CI：成功；
- `www.qianwen.com` 的核心文本交付真实浏览器回归已通过，提取文本可正常编辑、删除。

第三方网页 AI 会持续变化。以上验证说明 V0.5.3 当前实现通过了已知回归门槛，但不代表第三方站点未来永久兼容；网页结构变化后仍应重新做真实浏览器 smoke test（冒烟测试）。

---

## English

Link2Context V0.5.3 requests `http://*/*` and `https://*/*` host permissions so it can acquire URLs on behalf of a web-AI chat. V0.5.3 also adds Chrome's `debugger` permission for Chinese Qianwen, specifically to solve the controlled-editor failure where text was visible in the DOM but absent from the site's real send state.

The security goal is not a universal proxy or generic browser-control surface. **Restricted acquisition starts only from a real user URL gesture in an allowed AI composer; ordinary fetching is unauthenticated by default; browser-context reuse requires explicit authorization; and Qianwen debugger input is limited to designated Qianwen hosts, the top frame, and a tiny fixed action set.**

### Why V0.5.3 needs `debugger`

A live `www.qianwen.com` regression showed extension-created content visibly present but not normally deletable. After the user typed extra characters, only those new characters were actually sent. Direct DOM editing therefore did not reliably enter Qianwen's controlled editor state.

V0.5.3 uses the Chrome DevTools Protocol (CDP) real-input path instead:

- text: `Input.insertText`;
- auto-send: `Input.dispatchKeyEvent`, limited to Enter `rawKeyDown` / `keyUp`;
- no arbitrary `Runtime.evaluate` execution;
- no debugger Network-domain capture;
- no debugger-based Cookie, Local Storage, or credential extraction;
- no generic debugger automation API is exposed.

### `debugger` permission confinement

Because `debugger` is a powerful permission, V0.5.3 enforces hard background gates:

- only the internal `L2C_QIANWEN_CDP` message type is handled;
- only the top frame is accepted; subframes fail with `QIANWEN_DEBUGGER_FRAME_DENIED`;
- the sender must be `qianwen.com` / its subdomains or `qwenwork.cn` / its subdomains; other hosts fail with `QIANWEN_DEBUGGER_HOST_DENIED`;
- a real sender tab is required;
- only `insertText` and `pressEnter` actions are accepted; all others fail with `QIANWEN_DEBUGGER_ACTION_INVALID`;
- text input is capped at 180,000 characters per operation;
- every operation attaches temporarily and detaches in `finally`, including failure paths;
- if DevTools or another debugger already owns the tab, the operation fails explicitly with `QIANWEN_DEBUGGER_BUSY` / attach failure instead of taking over.

Chrome may display a visible “extension is debugging this browser/tab” banner during these operations. That is an expected browser-level security indicator and is not suppressed.

### Page-handoff success boundary

V0.5.3 does not treat visible UI as sufficient proof of successful handoff:

- after Chinese-Qianwen text is inserted through CDP `Input.insertText`, text signatures must still be present after blur/refocus reconciliation or the result is `QIANWEN_CDP_STATE_UNCONFIRMED`;
- after a real Enter auto-send, independent evidence such as generation state or the message leaving the composer is required or the result is `SEND_UNCONFIRMED`;
- original PDF/image/binary resources remain file attachments rather than being force-decoded as text;
- generic web-AI auto-send also remains fail-closed;
- Link2Context never force-removes `disabled` / `aria-disabled` from site controls;
- STOP cancels network acquisition, pagination, attachment waiting, editor handoff, and auto-send waiting.

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

- ordinary acquisition does not reuse login state;
- 401 / 403 / `CLIENT_RENDER_CONTENT_MISSING` may use browser context only after explicit user authorization;
- authorization is globally revocable and hosts can be deny-listed;
- Link2Context does not directly read or store Cookie values through `chrome.cookies`;
- target and final URLs remain revalidated when authorized browser context is used;
- authorization is not a mechanism for bypassing login walls, CAPTCHAs, DRM, paywalls, or site access control; those failures remain explicit.

### Data minimization

- common credential/token query parameters are redacted in displayed source URLs;
- ChatGPT Share / WorkBuddy Share cleanup excludes unnecessary system/tool/base64/reasoning payloads;
- external serialized objects are decoded safely against `__proto__` prototype pollution;
- attachment names are sanitized and bounded;
- binary classification uses byte signatures/MIME/extensions before text decoding.

### V0.5.3 validation status

- PR #10 is merged into `main`;
- `npm run check`: passed;
- full `npm test`: 292 / 292 passed;
- GitHub Actions CI: successful;
- the core `www.qianwen.com` live-browser text-handoff regression passed, with extracted text entering a normally editable/deletable state.

Third-party web-AI UIs continue to evolve. These results establish the current V0.5.3 regression baseline but do not guarantee permanent compatibility with future site changes; live-browser smoke testing remains appropriate after target-site changes.
