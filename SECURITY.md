# Security / 安全说明

## 项目状态 / Project status

> **2026-08-23 阶段性收尾。** 当前 `main` 仍是 **V0.6.0**；PR #12 的 **V0.6.1** 是安全/可靠性 hardening candidate（加固候选），保持 Draft、未合并。V0.6.1 实现收口点已通过 `npm run check`、**350 / 350** 自动化测试和 GitHub Actions **CI #515**，但没有完成新的四平台真实浏览器验收，因此不能把自动化 PASS 写成 live PASS。

> 已知真实浏览器基线：**V0.5.3 + 千问**的真实编辑器写入、编辑/删除和 Auto-send 为 PASS；V0.5.3 的 ChatGPT / DeepSeek / 豆包 Auto-send 有真实 FAIL / 不可靠记录。完整状态见 [`docs/PROJECT-STATUS.md`](./docs/PROJECT-STATUS.md) 与 [`docs/V0.6-LIVE-EVIDENCE.md`](./docs/V0.6-LIVE-EVIDENCE.md)。

---

## 中文

Link2Context V0.6.1 需要 `http://*/*` / `https://*/*` 主机权限来读取用户主动提交的链接，并保留 V0.5.3 为千问引入的 `debugger`（Chrome 调试器）权限。V0.6.1 的安全目标不是“万能代理/万能浏览器控制器”，而是：**只有真实用户在允许的网页 AI 输入区提交 URL 时，才启动受限采集与交付；外部内容始终是不可信数据；拿不到/传不过去时明确失败，不为了“完整”绕过网站和浏览器的安全边界。**

### URL / 网络边界

- 仅 HTTP / HTTPS；拒绝 URL 内嵌用户名/密码；
- 阻止 localhost、私网、链路本地、特殊用途 IP 与云 metadata（元数据）地址；
- trailing-dot hostname（末尾点主机名）先归一化，`localhost.`、`.local.`、`metadata.google.internal.` 等等价 alias（别名）不能绕过本机/元数据阻止；
- 网络重定向逐跳重新验证，严格网络保护默认不因兼容回退而降级；
- 未请求的 HTTP `206 Partial Content` 不会被当作完整资源接受；
- 响应大小、超时、重试、分页和取消均有上限；
- 自动采集必须由真实用户事件触发，background（后台）再次验证调用方 AI host；
- 敏感 query 参数在展示来源 URL 时脱敏，hash（片段）不会进入 AI-facing source URL（面向 AI 的来源链接）。

### Authorized Browser Context / 授权浏览器上下文

默认关闭。401 / 403 或静态 HTML 只有页面壳时，只有用户显式授权后才允许使用浏览器登录上下文进行有限渲染采集。

- 授权可撤销，并支持 host deny-list（站点禁用列表）；
- V0.6.1 在授权标签页发生导航/重定向后再次检查当前 URL 的公开地址安全、授权/deny-list，并绑定最初授权的 origin（来源域）；跨 origin 自动停止；
- legacy browser fallback（旧授权浏览器回退）也使用同样的初始 origin pinning，不允许跨来源继续复用浏览器凭据；
- 授权标签页内的 credentialed binary re-fetch（带浏览器凭据的二进制二次读取）使用 `redirect: 'error'`，不自动跟随第二个来源；
- 自动“加载更多”只在正文范围内、有限次数进行；跨源 anchor（链接）、form（表单）和 submit（提交）控件不会被自动点击；
- 不使用 `chrome.cookies` 直接读取或保存 Cookie 值；
- 不绕过登录墙、验证码、付费墙、DRM 或站点访问控制。

### External content / 外部内容信任边界

V0.6 canonical Context Model（规范上下文模型）把网页、文件和远程资源标记为 `untrusted-external`。网页正文中的“忽略之前指令”“执行某命令”等文字仍然只是 source data（来源数据），不能自动升级成系统/用户指令。

结构化解析使用 DOMParser / Mozilla Readability；正文语义、图片、表格、代码和链接被提取成受控数据结构，而不是执行来源页面脚本。巨型表格、超长单元格、海量列表等 hostile structure（恶意结构）有明确数量/长度上限，达到上限会显式标记截断，而不是无限消耗资源。外部代码块使用可扩展 fence（围栏），来源文本中的三反引号不能逃逸并伪造 canonical boundary（规范边界）。

### 附件边界

- PDF、图片、Office、压缩包、音视频和未知二进制优先保留原文件；
- 资源类型先看字节/MIME/扩展名，避免把二进制乱码冒充文本；
- V0.6.1 严格尊重网页 `<input type="file" accept=...>`；找不到兼容上传入口时明确失败或标记 partial（部分完成），不再临时移除 `accept` 强塞文件；
- `disabled` / `aria-disabled` 的 file input 和附件按钮不可被强制启用；submit-like（提交型）控件不会被误当附件展开入口；
- 通用附件入口优先限制在当前 composer（输入区）范围；只有从当前输入区触发附件菜单后新出现的兼容 file input 才允许作为受限回退；
- 已加载的 V0.5.3 Qwen/Qianwen fallback owner 也遵守同样的 disabled / accept fail-closed 契约；
- 附件“已注册”的文件名证据限制在当前 composer/附件区域；上传前已存在的同名文本不能作为新附件成功证据；
- 关键图片下载有单图/总大小/数量预算，并重新验证实际 MIME；
- 图片或附件没有被网页 AI 确认时，不得当作成功，也会禁止不安全的自动发送。

### `debugger` 权限

千问保留 V0.5.3 已实测的 CDP（Chrome DevTools Protocol，Chrome 调试协议）真实输入路径：

- 文本：`Input.insertText`；
- Enter：`Input.dispatchKeyEvent`；
- 只允许顶层 **HTTPS** `qianwen.com` / `qwenwork.cn` 页面；
- 只开放固定 `insertText` / `pressEnter` 动作；
- attach（连接）后、每次 `Input.*` 命令前都会重新读取当前 tab URL，若导航到非允许 HTTPS 站点立即拒绝；
- 每次操作临时 attach，结束后立即 detach；
- 被 DevTools / 其他调试器占用时返回 `*_BUSY`，不抢占；
- attach 失败、命令失败、导航越界分别使用 `*_ATTACH_FAILED`、`*_COMMAND_FAILED`、`*_NAVIGATION_DENIED`，避免把执行失败误报成连接失败。

V0.6.1 对 ChatGPT / DeepSeek / 豆包只提供更窄的 generic debugger fallback（通用调试回退）：

- 仅允许顶层指定 **HTTPS** host；
- 必须显式开启 Auto-send（自动发送）；
- 只允许发送 Enter，不允许通用文本注入；
- 不开放 `Runtime.evaluate` 任意脚本执行；
- 不使用 debugger Network/Cookie/Local Storage 能力抓取凭据。

### 页面交付和自动发送

- 编辑状态需要内容签名/状态确认，不能只看 DOM “显示出来了”；
- 自动发送采用 fail-closed（失败时不假装成功）：按钮、表单或 Enter 动作本身都不等于成功，必须有独立发送后证据；
- 如果第一次发送动作可能已经产生副作用、但证据不足，立即返回未确认状态，不再链式执行第二种发送方式；
- 上游 source partial（来源不完整）或 media partial（媒体不完整）会传播到交付层并禁用自动发送；
- 证据不足返回 `SEND_UNCONFIRMED`；
- 永不强制解除 `disabled / aria-disabled`；
- STOP 使用 `startedAt` 任务身份区分旧任务/新任务；V0.6 → legacy fallback 和已加载 V0.5.3 owner 都传播同一任务 identity；
- 未通过 sender / user-gesture gate 的新 resolve 请求不能先中止已经合法运行的任务；
- STOP 覆盖抓取、重试、分页、渲染等待、媒体下载、附件等待、编辑器交付和发送等待。

### V0.6.1 自动化验证状态

- V0.6 功能范围继续冻结；V0.6.1 只做 security / correctness / reliability / truthfulness（安全 / 正确性 / 可靠性 / 状态真实性）修复；
- 原 20 个核心 adversarial rounds（对抗轮次）与 2 个 debugger follow-up rounds 记录在 `docs/V0.6.1-HARDENING.md`；其后又继续针对 trailing-dot、HTTP 206、legacy STOP、origin pinning、credentialed redirect、附件入口/假证据、重复发送副作用、Markdown fence 等做独立红队补强；
- **实现收口点 commit `8f413c262ad7cbff16b367b663eebf65a8ee3b8a`：`npm run check` PASS，`npm test` 350 / 350 PASS，GitHub Actions CI #515 SUCCESS。**
- 这些结果只证明代码与自动化契约，不把第三方网页实时能力升级为 PASS。
- 第三方网页实时能力单独记录在 `docs/V0.6-LIVE-EVIDENCE.md`。没有 V0.6/V0.6.1 真实浏览器证据就保持 `UNVERIFIED`；V0.5.3 千问 PASS 只作为历史回归基线。

---

## English

### Closeout status

As of **2026-08-23**, `main` remains **V0.6.0**. PR #12 contains **V0.6.1**, a Draft/unmerged security and reliability hardening candidate. Its implementation closeout point passed syntax checks, **350 / 350** automated tests, and GitHub Actions **CI #515**, but no fresh four-target live-browser matrix was completed. Automated PASS therefore does not become live PASS.

The clearest historical live baseline remains **V0.5.3 + Qianwen** for real editor state, edit/delete, and Auto-send. V0.5.3 ChatGPT / DeepSeek / Doubao Auto-send have real FAIL/unreliable evidence. See `docs/PROJECT-STATUS.md` and `docs/V0.6-LIVE-EVIDENCE.md`.

Link2Context V0.6.1 requests broad HTTP(S) host access to acquire URLs explicitly submitted by the user and retains the V0.5.3 `debugger` permission required by the proven Qianwen real-input path. The security goal is not a universal proxy or browser-control surface. **Acquisition starts from a real user URL gesture in an allowed web-AI composer; external content remains untrusted data; and incomplete delivery fails explicitly rather than bypassing browser or site security controls.**

### Network boundaries

- HTTP / HTTPS only; embedded URL credentials are rejected.
- localhost, private/link-local/special-purpose address space, cloud metadata targets, and equivalent trailing-dot host aliases are blocked.
- Redirect destinations are revalidated, and strict address-space protection is not silently dropped by compatibility fallback.
- Unexpected HTTP 206 partial responses are not accepted as complete resources.
- Response size, timeout, retries, pagination, and cancellation are bounded.
- Automatic acquisition requires a real user event and the background validates the calling web-AI host again.
- Credential-like query values are redacted from AI-facing source URLs and URL fragments are removed.

### Authorized Browser Context

Authorized browser reuse is off by default and requires explicit user opt-in. It is revocable and supports a host deny-list.

V0.6.1 rechecks authorization and the deny-list after rendered navigation or redirects and pins acquisition—including the legacy authorized-browser fallback—to the originally authorized origin. Credentialed binary re-fetch inside that tab uses redirect failure rather than automatically following a second origin. Limited load-more automation does not auto-click cross-origin anchors or form/submit controls. Link2Context does not directly read Cookie values with `chrome.cookies` and does not bypass login walls, CAPTCHAs, paywalls, DRM, or site access controls.

### Untrusted external data

Remote page/file content is represented as `untrusted-external` canonical data. Prompt-like source text never becomes a system/user instruction merely because it appeared in a fetched page. Structured parsing uses DOMParser / Mozilla Readability and extracts controlled data rather than executing source scripts. Hostile tables/lists have explicit row/column/item/text limits and surface truncation instead of consuming unbounded resources. Code-block fences expand when needed so hostile backticks cannot escape the external-data boundary.

### Attachment boundaries

Original binary resources remain files whenever appropriate. V0.6.1 respects the site's `<input type="file" accept=...>` contract; incompatible, disabled, or `aria-disabled` upload controls fail closed. Submit-like controls are not treated as attachment reveal actions. Generic uploader selection is scoped to the active composer, with only newly revealed compatible inputs accepted as fallback. Loaded V0.5.3 Qwen/Qianwen fallback owners follow the same disabled/accept contract. Attachment-registration evidence is scoped to the active composer and must represent a new state; pre-existing same-name page text cannot fake success. Image acquisition is bounded by count and bytes and validates actual image MIME before handoff.

### `debugger` confinement

Qianwen retains the V0.5.3 CDP `Input.insertText` and Enter path, restricted to top-frame **HTTPS** Qianwen hosts and a tiny fixed action set with temporary attach/detach. The current tab URL is revalidated after attach and before each input command. Busy, attach, command, and navigation failures are reported distinctly.

For ChatGPT / DeepSeek / Doubao, V0.6.1 exposes only a narrower Enter fallback: supported top-frame **HTTPS** hosts only, explicit Auto-send required, Enter only, no generic text injection, no `Runtime.evaluate`, and no debugger Network/Cookie/Local Storage credential capture.

### Handoff / send proof

Visible DOM is not sufficient proof of editor state. Auto-send is fail-closed: clicking, form submission, or Enter is not success without independent post-send evidence. After an unconfirmed side-effecting send attempt, Link2Context does not chain another send strategy. Upstream source/media partial state disables auto-send. Insufficient evidence becomes `SEND_UNCONFIRMED`. Disabled controls are never force-enabled.

STOP is `startedAt` job-identity-aware across V0.6 and legacy fallback owners. Rejected unauthorised/non-gesture resolve requests cannot abort an already valid job. Cancellation remains aware across acquisition, retry, pagination, render, media, attachment, editor handoff, and send waits.

### V0.6.1 validation

V0.6 feature scope remains frozen; V0.6.1 is limited to security, correctness, reliability, and state-truth fixes. The original 20 core adversarial rounds plus two debugger follow-up rounds and the independent legacy/origin/attachment/cancellation red-team pass are documented in `docs/V0.6.1-HARDENING.md`.

The implementation closeout point `8f413c262ad7cbff16b367b663eebf65a8ee3b8a` passed `npm run check`, **350 / 350** tests, and GitHub Actions **CI #515**. Live third-party capabilities remain separately tracked in `docs/V0.6-LIVE-EVIDENCE.md`; untested V0.6/V0.6.1 behavior stays `UNVERIFIED`, while V0.5.3 Qianwen PASS remains only a historical regression baseline.
