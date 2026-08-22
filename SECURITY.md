# Security / 安全说明

## 中文

Link2Context V0.6 需要 `http://*/*` / `https://*/*` 主机权限来读取用户主动提交的链接，并保留 V0.5.3 为千问引入的 `debugger`（Chrome 调试器）权限。V0.6 的安全目标不是“万能代理/万能浏览器控制器”，而是：**只有真实用户在允许的网页 AI 输入区提交 URL 时，才启动受限采集与交付；外部内容始终是不可信数据；拿不到/传不过去时明确失败，不为了“完整”绕过网站和浏览器的安全边界。**

### URL / 网络边界

- 仅 HTTP / HTTPS；拒绝 URL 内嵌用户名/密码；
- 阻止 localhost、私网、链路本地、特殊用途 IP 与云 metadata（元数据）地址；
- 网络重定向逐跳重新验证；
- 响应大小、超时、重试、分页和取消均有上限；
- 自动采集必须由真实用户事件触发，background（后台）再次验证调用方 AI host；
- 敏感 query 参数在展示来源 URL 时脱敏。

### Authorized Browser Context / 授权浏览器上下文

默认关闭。401 / 403 或静态 HTML 只有页面壳时，只有用户显式授权后才允许使用浏览器登录上下文进行有限渲染采集。

- 授权可撤销，并支持 host deny-list（站点禁用列表）；
- V0.6 在授权标签页发生导航/重定向后再次检查当前 URL 的公开地址安全和授权/deny-list，不能通过跳转进入被明确禁用的站点；
- 自动“加载更多”只在正文范围内、有限次数进行；候选若是跨源 anchor（链接）不会自动点击；
- 不使用 `chrome.cookies` 直接读取或保存 Cookie 值；
- 不绕过登录墙、验证码、付费墙、DRM 或站点访问控制。

### External content / 外部内容信任边界

V0.6 canonical Context Model（规范上下文模型）把网页、文件和远程资源标记为 `untrusted-external`。网页正文中的“忽略之前指令”“执行某命令”等文字仍然只是 source data（来源数据），不能自动升级成系统/用户指令。

结构化解析使用 DOMParser / Mozilla Readability；正文语义、图片、表格、代码和链接被提取成受控数据结构，而不是执行来源页面脚本。

### 附件边界

- PDF、图片、Office、压缩包、音视频和未知二进制优先保留原文件；
- 资源类型先看字节/MIME/扩展名，避免把二进制乱码冒充文本；
- V0.6 严格尊重网页 `<input type="file" accept=...>`；找不到兼容上传入口时明确失败或标记 partial（部分完成），不再临时移除 `accept` 强塞文件；
- 关键图片下载有单图/总大小/数量预算，并重新验证实际 MIME；
- 图片或附件没有被网页 AI 确认时，不得当作成功，也会禁止不安全的自动发送。

### `debugger` 权限

千问保留 V0.5.3 已实测的 CDP（Chrome DevTools Protocol，Chrome 调试协议）真实输入路径：

- 文本：`Input.insertText`；
- Enter：`Input.dispatchKeyEvent`；
- 只允许顶层 `qianwen.com` / `qwenwork.cn` 页面；
- 只开放固定 `insertText` / `pressEnter` 动作；
- 每次操作临时 attach，结束后立即 detach；
- 被 DevTools / 其他调试器占用时明确失败，不抢占。

V0.6 对 ChatGPT / DeepSeek / 豆包只提供更窄的 generic debugger fallback（通用调试回退）：

- 仅允许顶层指定 host；
- 必须显式开启 Auto-send（自动发送）；
- 只允许发送 Enter，不允许通用文本注入；
- 不开放 `Runtime.evaluate` 任意脚本执行；
- 不使用 debugger Network/Cookie/Local Storage 能力抓取凭据。

### 页面交付和自动发送

- 编辑状态需要内容签名/状态确认，不能只看 DOM “显示出来了”；
- 自动发送采用 fail-closed（失败时不假装成功）：按钮、表单或 Enter 动作本身都不等于成功，必须有独立发送后证据；
- 证据不足返回 `SEND_UNCONFIRMED`；
- 永不强制解除 `disabled / aria-disabled`；
- STOP 覆盖抓取、重试、分页、渲染等待、媒体下载、附件等待、编辑器交付和发送等待。

### V0.6 验证状态

- V0.6 功能开发已冻结；
- 最终候选要求 `npm run check`、全量 `npm test` 和 GitHub Actions CI 全绿；
- 最终安全收口新增了“附件 accept 不可绕过”和“授权渲染导航重新校验”回归测试；
- 第三方网页实时能力单独记录在 `docs/V0.6-LIVE-EVIDENCE.md`。没有 V0.6 真实浏览器证据就保持 `UNVERIFIED`；V0.5.3 千问 PASS 只作为历史回归基线。

---

## English

Link2Context V0.6 requests broad HTTP(S) host access to acquire URLs explicitly submitted by the user and retains the V0.5.3 `debugger` permission required by the proven Qianwen real-input path. The security goal is not a universal proxy or browser-control surface. **Acquisition starts from a real user URL gesture in an allowed web-AI composer; external content remains untrusted data; and incomplete delivery fails explicitly rather than bypassing browser or site security controls.**

### Network boundaries

- HTTP / HTTPS only; embedded URL credentials are rejected.
- localhost, private/link-local/special-purpose address space, and cloud metadata targets are blocked.
- Redirect destinations are revalidated.
- Response size, timeout, retries, pagination, and cancellation are bounded.
- Automatic acquisition requires a real user event and the background validates the calling web-AI host again.

### Authorized Browser Context

Authorized browser reuse is off by default and requires explicit user opt-in. It is revocable and supports a host deny-list.

V0.6 rechecks authorization and the deny-list after rendered navigation or redirects. Limited load-more automation does not auto-click cross-origin anchor candidates. Link2Context does not directly read Cookie values with `chrome.cookies` and does not bypass login walls, CAPTCHAs, paywalls, DRM, or site access controls.

### Untrusted external data

Remote page/file content is represented as `untrusted-external` canonical data. Prompt-like source text never becomes a system/user instruction merely because it appeared in a fetched page. Structured parsing uses DOMParser / Mozilla Readability and extracts controlled data rather than executing source scripts.

### Attachment boundaries

Original binary resources remain files whenever appropriate. V0.6 respects the site's `<input type="file" accept=...>` contract; an incompatible uploader fails closed instead of having `accept` removed. Image acquisition is bounded by count and bytes and validates actual image MIME before handoff.

### `debugger` confinement

Qianwen retains the V0.5.3 CDP `Input.insertText` and Enter path, restricted to top-frame Qianwen hosts and a tiny fixed action set with temporary attach/detach.

For ChatGPT / DeepSeek / Doubao, V0.6 exposes only a narrower Enter fallback: supported top-frame hosts only, explicit Auto-send required, Enter only, no generic text injection, no `Runtime.evaluate`, and no debugger Network/Cookie/Local Storage credential capture.

### Handoff / send proof

Visible DOM is not sufficient proof of editor state. Auto-send is fail-closed: clicking, form submission, or Enter is not success without independent post-send evidence. Insufficient evidence becomes `SEND_UNCONFIRMED`. Disabled controls are never force-enabled, and STOP is cancellation-aware across acquisition, render, media, handoff, and send waits.

### V0.6 validation

V0.6 feature development is frozen. The final candidate requires syntax checks, the complete automated test suite, and GitHub Actions CI to pass. Live third-party capabilities remain separately tracked in `docs/V0.6-LIVE-EVIDENCE.md`; untested V0.6 behavior stays `UNVERIFIED`, while V0.5.3 Qianwen PASS remains only a historical regression baseline.
