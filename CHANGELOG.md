# Changelog / 变更记录

## V0.6.1 — 2026-08-22

状态：V0.6.0 的安全/可靠性补丁候选；不扩大 V0.6 产品范围，不把缺少真实浏览器证据的能力从 `UNVERIFIED`（未验证）升级为 PASS。

### 20 轮核心对抗加固

- 保留 public `targetAddressSpace`（公网地址空间）保护，网络兼容回退不再默认削弱 SSRF / 私网边界；401/403/404/429 等非重试错误保持类型化失败。
- 重定向逐跳重新验证，私网目标和 HTTPS→HTTP 降级保持 fail-closed（失败时不放行）。
- OAuth code、token、signature、session、API key 等敏感 query 值从 AI-facing URL（面向 AI 的来源链接）中脱敏，fragment/hash 不进入上下文来源。
- CDP（Chrome DevTools Protocol，Chrome 调试协议）在 attach 后、每个输入命令前重新校验当前 tab host，降低导航 TOCTOU（检查-使用竞态）风险。
- V0.6 generic debugger（通用调试回退）继续只开放 Enter；任意文本注入只保留千问专用、已验证路径。
- STOP 前后台共享 `startedAt` 任务身份；旧任务停止请求不会误杀新任务。
- source partial / media partial（来源/媒体部分完成）向交付层传播；只要内容不完整就禁用自动发送，不把“部分成功”冒充完整成功。
- 通用附件入口限制到当前 composer（输入区）；只有从当前输入区触发菜单后新出现的兼容 file input 才能作为受限回退。
- 附件文件名证据限制在当前 composer/附件区域；页面其他文字不能伪造上传成功。
- 严格尊重 `<input type="file" accept=...>`；没有兼容入口就失败，不临时移除 `accept`。
- 原始 PDF、图片、Office、压缩包、音视频及其他二进制继续保留原文件附件；图片取消保持 `USER_CANCELLED`，不会被吞成 partial。
- Authorized Browser Context（授权浏览器上下文）在导航后重新检查授权/deny-list，并绑定最初授权 origin；跨 origin 自动停止。
- 自动“加载更多”不点击 form / submit 控件，也不点击跨源 anchor。
- Article Identity（文章身份）校验阻止“下一页”静默串入下一篇文章；达到分页/总字节上限会显式 partial。
- 结构化解析对巨型表格、超长单元格、海量列表设置资源上限，并暴露 `structuredTruncated`。
- 外部 prompt-like text（类似提示词的网页文字）继续只作为 `untrusted-external` 数据，不能伪造 canonical trust boundary（规范信任边界）。

完整矩阵见 `docs/V0.6.1-HARDENING.md`。

### 继续自我迭代后的追加修复

- 调试器入口和每个命令前的当前标签页复查现在都要求 **HTTPS**；允许域名的 HTTP 页面也会拒绝 CDP 输入。
- debugger busy / attach failure / command failure / navigation denied（占用 / 连接失败 / 命令失败 / 导航越界）改为不同错误码，不再把执行失败误报成 attach 失败。
- 首轮 hardening CI 暴露 3 个旧源码字符串断言；确认实现本身符合更严格契约后，测试改为验证新行为而不是旧写法。

### 验证规则

- `npm run check` 必须 PASS。
- 全量 `npm test` 必须 PASS。
- GitHub Actions CI 必须在最终 head 全绿。
- CI 通过不等于第三方网页 AI 永久兼容；V0.6 / V0.6.1 尚未重新做 live smoke（真实浏览器冒烟）的能力继续保持 `UNVERIFIED`。
- V0.5.3 千问真实输入/编辑/自动发送 PASS 继续仅作为历史基线。

---

## V0.6.0 — 2026-08-22

状态：本记录随 PR #11 合并到 `main` 生效；V0.6 功能开发已冻结。

### 产品目标

V0.6 从“把链接转成一段文本”升级为 **Structured Context Bridge（结构化上下文桥）**：

> 只要用户给出一个链接，就尽可能完整地读取真实信息并交给当前 AI；任何拿不到、读不全、传不过去或尚未验证的部分都必须明确暴露，禁止静默丢失后假装完整。

### 主要变化

- 新增 canonical Context Model（规范上下文模型），正文内部不再以一坨 Markdown 作为唯一真值；保留标题、段落、列表、引用、代码、表格、链接、图片、附件及 provenance（来源关系）。
- 复用并固定 Mozilla Readability，再叠加 structured DOM walker（结构化 DOM 遍历器）；Markdown 变成输出格式，而不是内部状态。
- 新增关键图片 inventory / acquisition（清单与实际下载）：支持 `src`、`srcset`、常见 lazy-load 属性、图注、去重、噪声过滤、实际 MIME 校验、数量/大小预算。
- 新增 Article Identity（文章身份）分页校验和去重，避免把“下一篇文章”静默拼进当前正文。
- 新增 bounded rendered acquisition（有限渲染采集）：仅在显式授权浏览器上下文后启用，等待正文、有限滚动/加载更多、DOM 稳定后退出。
- 编码链升级为 BOM → HTTP charset → HTML/XML 文档声明 → UTF-8 合法性 → 有界回退，并记录编码来源/置信度。
- 新增 ChatGPT / DeepSeek / 豆包 / 千问 Target Profile（目标 AI 能力画像），把安全阈值、交付方式、自动发送策略与 live evidence（真实证据）分开记录。
- 千问继续保留 V0.5.3 已实测的 CDP `Input.insertText` + 真实 Enter 路径，不为了架构整齐重写已经验证的核心能力。
- ChatGPT / DeepSeek / 豆包自动发送采用 fail-closed（失败时不假装成功）的 button → form → 仅显式 Auto-send 时受限 CDP Enter fallback（回退）链。
- PDF、图片、Office、压缩包、音视频和其他原始二进制继续走原文件附件，不把二进制乱码伪造成文本。
- V0.5.3 的特殊分享源、原始二进制、安全 URL、授权浏览器上下文、STOP 等稳定路径继续作为兼容 fallback。

### 最终安全收口

- 外部网页内容一律标记为 `untrusted-external`（不可信外部数据），网页中的提示词文本不能升级成系统/用户指令。
- V0.6 附件交付严格尊重网站 file input 的 `accept` 类型约束；没有兼容入口时明确失败/partial，不再临时移除 `accept` 强塞文件。
- 授权渲染采集在页面导航后重新检查授权与 host deny-list（站点禁用列表），避免通过重定向进入明确禁用站点。
- 自动“加载更多”不会点击跨源 anchor（链接）候选。
- `debugger` 通用回退只开放 Enter，并且只在显式开启 Auto-send、指定目标站点和顶层页面上允许；千问调试输入仍只开放固定 `insertText` / `pressEnter` 动作。
- 不使用 `Runtime.evaluate` 作为任意网页脚本执行接口，不通过 debugger Network/Cookie 能力抓取凭据。
- 自动发送、媒体附件和编辑状态必须有独立证据；证据不足就返回 partial / `SEND_UNCONFIRMED` / 明确错误。

### 自动化验证

- `npm run check`：PASS（通过）。
- 全量 `npm test`：**322 / 322 PASS**（全部通过）。
- GitHub Actions CI（持续集成）run **#416**：**SUCCESS（成功）**。
- 新增回归覆盖：附件 `accept` 安全边界、渲染导航授权边界、V0.6/V0.5.3 版本兼容、能力证据状态等。

### Live evidence / 真实浏览器证据

- V0.5.3 千问真实文本编辑/删除与自动发送 PASS 继续作为历史回归基线。
- V0.6 候选的 ChatGPT / DeepSeek / 豆包 / 千问实时能力不会因为合并自动标记 PASS；尚未在 V0.6 候选上实测的项目继续保持 `UNVERIFIED`。
- 真实状态以 `docs/V0.6-LIVE-EVIDENCE.md` 为准。

### 已知边界

- 不绕过登录、验证码、付费墙、DRM 或站点访问控制。
- 不承诺任意 SPA 无限滚动/加载更多全网通吃。
- 本版不自动理解音视频内容本身；目标是保留/交付原文件。
- 第三方网页 AI 的编辑器、附件与发送机制会变化；出现真实 blocker/regression 后允许做定向修复，但 V0.6 不再扩功能 scope（范围）。

---

## V0.5.3 — 2026-08-22

状态：已合并到 `main`（PR #10）。

### 主要修复

- 中国千问 `qianwen.com` / `www.qianwen.com` / `qwenwork.cn` 改用 `chrome.debugger` + CDP（Chrome DevTools Protocol，Chrome 调试协议）真实输入路径。
- 文本交付使用 `Input.insertText`，解决“DOM 看得到但不可正常编辑/实际发送状态没有内容”的真实回归。
- 千问自动发送使用 `Input.dispatchKeyEvent` 发送真实 Enter，不再依赖不稳定的发送按钮 DOM。
- 自动发送继续采用 fail-closed（失败时不假装成功）语义：必须取得独立的发送后页面证据，否则返回 `SEND_UNCONFIRMED`。
- STOP 扩展为端到端取消：覆盖网络读取、分页、附件等待、编辑器交付和自动发送等待。
- 分页识别扩展到 `rel=next`、数字分页、`data-url` / `data-page`、同源 `onclick location` 等，同时保留同源、同文章 URL family、最多 8 页和总大小限制。
- PDF、图片及其他原始二进制继续保持原文件附件。

### 安全变化

- manifest 新增 `debugger` 权限。
- 调试输入仅允许顶层 `qianwen.com` / `qwenwork.cn` 页面。
- 仅开放 `insertText` 与 `pressEnter` 两类内部动作。
- 每次调试操作临时 attach，结束后立即 detach。
- 已被 DevTools 或其他调试器占用的标签页会明确失败，不抢占。
- 不新增 `Runtime.evaluate`、debugger Network 捕获、Cookie/Local Storage/凭据读取能力。

### 验证

- `npm run check`：PASS（通过）。
- `npm test`：292 / 292 PASS（全部通过）。
- GitHub Actions CI（持续集成）：SUCCESS（成功）。
- `www.qianwen.com` 核心文本交付真实浏览器回归：PASS；提取文本可正常编辑、删除。

### 已知边界

- 任意 SPA（单页应用）无限滚动或“加载更多”不是通用保证。
- 千问真实输入依赖 Chrome `debugger` 权限；同一标签页被其他调试器占用时可能返回 `QIANWEN_DEBUGGER_BUSY`。
- 第三方网页 AI 的 DOM / 编辑器 / 发送机制未来变化仍可能需要重新适配。

---

## V0.5.2

V0.5.2 的授权浏览器上下文、资源分类、二进制附件、安全 URL 校验等能力已被 V0.5.3 保留；V0.5.2 PR #9 未合并，后续由 V0.5.3 取代。
