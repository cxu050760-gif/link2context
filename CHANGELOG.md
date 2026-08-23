# Changelog / 变更记录

## V0.6.1 — 2026-08-22 ~ 2026-08-23

状态：**V0.6.0 的安全/可靠性加固候选，PR #12 保持 Draft（草稿）、未合并。** 项目于 2026-08-23 阶段性收尾。本版不扩大 V0.6 产品范围，也不把缺少真实浏览器证据的能力从 `UNVERIFIED`（未验证）升级为 PASS。

> 当前 `main` 仍是 **V0.6.0**。如果只看“已有真实浏览器 PASS 的可用基线”，目前最明确的是 **V0.5.3 + 千问**。V0.5.3 的 ChatGPT / DeepSeek / 豆包 Auto-send 则有明确 FAIL / 不可靠记录。详细状态见 `docs/PROJECT-STATUS.md`。

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

### 追加 2 轮 debugger 加固

- 调试器入口和每个命令前的当前标签页复查都要求 **HTTPS**；允许域名的 HTTP 页面也会拒绝 CDP 输入。
- debugger busy / attach failure / command failure / navigation denied（占用 / 连接失败 / 命令失败 / 导航越界）使用不同错误码：`*_BUSY` / `*_ATTACH_FAILED` / `*_COMMAND_FAILED` / `*_NAVIGATION_DENIED`。

### 独立红队继续攻击后的追加收口

在原 20+2 轮之后继续攻击当前加载链和 legacy fallback，新增/确认并修复：

- trailing-dot hostname（末尾点主机名）绕过：`localhost.`、`.local.`、云 metadata alias 等等价本机/元数据目标继续被阻止；
- 意外 HTTP `206 Partial Content` 不再被当作完整资源接受；
- Authorized Browser Context 的 legacy browser fallback 绑定初始 origin，跨 origin 导航立即失败；
- 授权标签页内带凭据的二进制 re-fetch 使用 `redirect: 'error'`，不让凭据请求自动跟随到第二来源；
- V0.6 → legacy fallback 共用任务 identity，STOP 同时覆盖新旧 pipeline；legacy owner 也把同一 `startedAt` 传到后台；
- 未通过 sender / user-gesture gate 的新 resolve 请求不能先 abort 已合法运行的任务；
- V0.6 和已加载的 V0.5.3 Qwen/Qianwen owner 都严格拒绝 disabled / `aria-disabled` / accept 不兼容的附件入口；
- 页面预先存在同名文本不能再冒充新附件注册成功；
- generic Auto-send 在一次可能已经产生副作用的发送尝试未确认后立即停止，不再链式尝试第二种发送方式；
- hostile triple-backticks（恶意三反引号）不能逃逸外部代码块 fence（围栏）并伪装上下文边界；
- 多个旧测试由“写死源码形状”改为验证真实安全契约，未为追求绿灯回退生产保护。

完整矩阵见 `docs/V0.6.1-HARDENING.md`。

### 自动化收口

V0.6.1 **实现收口点**：commit `8f413c262ad7cbff16b367b663eebf65a8ee3b8a`。

- `npm run check`：**PASS**。
- 全量 `npm test`：**350 / 350 PASS**。
- GitHub Actions **CI #515**（run `32613750724`）：**SUCCESS**。

后续仅更新阶段性说明文档，不把文档提交本身冒充新的功能验证。

### Live-browser truth / 真实浏览器状态

- 本轮没有重新完成 ChatGPT / DeepSeek / 豆包 / 千问四个平台的 V0.6.1 live smoke（真实浏览器冒烟）。
- 因此 V0.6.0 / V0.6.1 尚未真实验证的 Manual text、editable state、mixed media、original binary、Auto-send、STOP 等能力继续保持 `UNVERIFIED`。
- V0.5.3 千问真实输入/编辑/删除/Auto-send PASS 继续作为历史回归基线；**不能自动继承成 V0.6/V0.6.1 PASS**。
- V0.5.3 ChatGPT / DeepSeek / 豆包 Auto-send 的真实 FAIL 记录继续保留，不用新代码的单元测试覆盖掉真实失败事实。

### 阶段性收尾决定

- PR #12 暂时保持 **Draft / unmerged**；
- `main` 保持 **V0.6.0**；
- 不再继续扩 V0.6 scope；
- 未来恢复项目时，先重新跑真实浏览器矩阵，再决定是否把 V0.6.1 提升为 Ready for Review / merge；
- 项目总状态见 `docs/PROJECT-STATUS.md`，真实网页证据见 `docs/V0.6-LIVE-EVIDENCE.md`。

---

## V0.6.0 — 2026-08-22

状态：本记录随 PR #11 合并到 `main` 生效；V0.6 功能开发已冻结。**截至 2026-08-23，V0.6.0 仍是当前 `main`，但四个主要网页 AI 的 V0.6 live matrix 没有重新完整验证，因此应理解为 CODE PASS / LIVE UNVERIFIED，而不是全平台稳定版。**

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

### 自动化验证

- `npm run check`：PASS（通过）。
- 全量 `npm test`：**322 / 322 PASS**（全部通过）。
- GitHub Actions CI（持续集成）run **#416**：**SUCCESS（成功）**。

### Live evidence / 真实浏览器证据

- V0.5.3 千问真实文本编辑/删除与自动发送 PASS 继续作为历史回归基线。
- V0.6 的 ChatGPT / DeepSeek / 豆包 / 千问实时能力不会因为合并自动标记 PASS；尚未在 V0.6 候选上实测的项目继续保持 `UNVERIFIED`。
- 真实状态以 `docs/V0.6-LIVE-EVIDENCE.md` 为准。

---

## V0.5.3 — 2026-08-22

状态：已合并到 `main`（PR #10）；后来被 V0.6.0 取代为主线版本，但**仍是当前最重要的真实浏览器回归基线**。

### 主要修复

- 中国千问 `qianwen.com` / `www.qianwen.com` / `qwenwork.cn` 改用 `chrome.debugger` + CDP（Chrome DevTools Protocol，Chrome 调试协议）真实输入路径。
- 文本交付使用 `Input.insertText`，解决“DOM 看得到但不可正常编辑/实际发送状态没有内容”的真实回归。
- 千问自动发送使用 `Input.dispatchKeyEvent` 发送真实 Enter，不再依赖不稳定的发送按钮 DOM。
- 自动发送继续采用 fail-closed（失败时不假装成功）语义：必须取得独立的发送后页面证据，否则返回 `SEND_UNCONFIRMED`。
- STOP 扩展为端到端取消：覆盖网络读取、分页、附件等待、编辑器交付和自动发送等待。
- 分页识别扩展到 `rel=next`、数字分页、`data-url` / `data-page`、同源 `onclick location` 等，同时保留同源、同文章 URL family、最多 8 页和总大小限制。
- PDF、图片及其他原始二进制继续保持原文件附件。

### 验证

- `npm run check`：PASS（通过）。
- `npm test`：292 / 292 PASS（全部通过）。
- GitHub Actions CI（持续集成）：SUCCESS（成功）。
- `www.qianwen.com` 核心文本交付真实浏览器回归：**PASS**；提取文本可正常编辑、删除。
- 千问 Auto-send：**PASS**。
- ChatGPT / DeepSeek / 豆包 Auto-send：真实使用记录为 **FAIL / 不可靠**，因此 V0.5.3 不能称全平台稳定版。

### 当前意义

如果只需要一条“真正用过并证明工作的路径”，**V0.5.3 + 千问是目前推荐的历史基线**。它用于实际对照和未来回归，不代表应该把整个项目回退到 V0.5.3。

---

## V0.5.2

V0.5.2 的授权浏览器上下文、资源分类、二进制附件、安全 URL 校验等能力已被 V0.5.3 保留；V0.5.2 PR #9 未合并，后续由 V0.5.3 取代，不再推荐继续使用。
