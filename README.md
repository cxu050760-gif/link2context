# Link2Context

[English](./README.en.md) | 中文

**在网页 AI 里只给一个链接，Link2Context 尽可能完整地读取真实信息，保留结构、关键图片与原文件，再按当前 AI 能接收的方式交过去。读不全、传不全或尚未验证的部分会明确暴露，不静默丢失。**

> 当前开发候选：**V0.6.1 — Structured Context Bridge（结构化上下文桥）安全/可靠性补丁**。V0.6 功能范围继续冻结；V0.6.1 只做对抗加固与回归修复。真实第三方网页能力与代码完成状态分开记录，详见 [`docs/PROJECT-STATUS.md`](./docs/PROJECT-STATUS.md) 与 `docs/V0.6-LIVE-EVIDENCE.md`。

## 先看这里：现在到底哪个版本能用？

项目于 **2026-08-23 阶段性收尾**。不要把“自动化全绿”理解成“所有网页 AI 都稳定”。

| Version | 当前状态 | 真实使用结论 |
| --- | --- | --- |
| **V0.5.3** | 历史已合并 | **千问 `www.qianwen.com` 是目前最明确的已验证可用基线**：真实编辑器写入、可编辑/删除、Auto-send 均 PASS。ChatGPT / DeepSeek / 豆包 Auto-send 在该版本是已知 FAIL / 不可靠。 |
| **V0.6.0** | **当前 `main`** | 自动化 **322 / 322 PASS、CI SUCCESS**；结构化能力已完成，但 ChatGPT / DeepSeek / 豆包 / 千问的 V0.6 实时交付矩阵没有重新完整验证，因此是 **CODE PASS / LIVE UNVERIFIED**，不是“全平台稳定版”。 |
| **V0.6.1** | **PR #12 Draft，未合并** | 代码层面当前最严格的 hardening candidate；实现收口点 **350 / 350 PASS、CI #515 SUCCESS**。但没有完成新的四平台真实浏览器验收，所以仍是 **LIVE UNVERIFIED**，暂不称稳定发行版。 |
| V0.5.2 | PR #9 未合并，已被后续版本取代 | 不建议继续使用。 |

**如果你只想选一个“真实证明过”的版本/路径：优先 V0.5.3 + 千问。**

**如果你使用当前 `main`（V0.6.0）：建议保持默认 Manual review（手动确认发送），把 Auto-send 和第三方网页适配视为需要重新验证的能力。**

完整阶段状态、已知 FAIL、未验证矩阵和未来恢复步骤见 [Project Status / 项目状态](./docs/PROJECT-STATUS.md)。

## V0.6 的核心变化

- **结构不再被压成一坨文本**：内部使用 canonical Context Model（规范上下文模型）保存标题、段落、列表、引用、代码、表格、链接、图片、附件和来源关系；Markdown 只是输出格式。
- **复用 Mozilla Readability**：正文提取以固定版本 Readability + structured DOM walker（结构化 DOM 遍历）为主，不继续堆正则正文提取器。
- **真正处理图文**：识别 `src` / `srcset` / 常见 lazy-load 图片，过滤追踪图和明显噪声，实际下载关键图片并校验 MIME；图片交付失败会明确标记 partial（部分完成），不会静默自动发送。
- **分页更保守**：传统分页之外加入 Article Identity（文章身份）检查与去重，宁可明确停止，也不把下一篇文章拼进当前正文。
- **动态网页有限渲染**：只有显式授权 Authorized Browser Context（授权浏览器上下文）后，才允许受限等待正文、DOM settle（稳定）、有限滚动/加载更多；所有步骤有次数、大小、超时和取消边界。
- **旧编码更稳**：BOM → HTTP charset → HTML/XML 声明 → UTF-8 合法性 → 有界回退，并记录编码来源/置信度。
- **按目标 AI 交付**：ChatGPT、DeepSeek、豆包、千问拥有独立 Target Profile（目标 AI 能力画像）；手动交付与 Auto-send（自动发送）分开，未有真实证据的能力保持 `UNVERIFIED`。
- **保留已验证能力**：千问继续使用 V0.5.3 已实测的 CDP `Input.insertText` + 真实 Enter；PDF、图片、Office、压缩包、音视频和未知二进制继续保持原文件附件。
- **V0.6.1 对抗加固**：围绕网络地址空间、重定向、调试器 TOCTOU、STOP 任务身份、附件入口隔离、partial 状态传播、分页身份、URL 密钥脱敏、解析资源上限等完成 20 轮核心攻击，并继续补了 HTTPS 调试器约束、CDP 失败分类，以及 trailing-dot 本机/metadata alias、HTTP 206、授权浏览器 origin pinning、legacy STOP/附件 fallback 等独立红队补强。

## 使用方式

1. 在支持的网页 AI 输入框中只粘贴一个 `http://` 或 `https://` 链接；
2. Link2Context 获取并识别资源类型；
3. HTML 尽可能形成结构化正文 + 关键图片，原始二进制保持原文件；
4. 根据当前 AI 选择文本、Markdown 文档、附件或图文混合交付；
5. 默认手动确认发送；只有显式开启 Auto-send 后才尝试自动发送；
6. 任何 partial / unsupported / unverified 都会明确显示，不用“成功”掩盖缺失。

## 资源管线

```text
URL/resource
  → safe acquisition
  → type-aware decoding
  → structured context + original assets
  → target-aware delivery
  → explicit completeness/evidence state
```

特殊分享源（例如 ChatGPT Share / WorkBuddy Share）继续使用专用解析；普通网页走 Readability + 结构化 DOM；静态 HTML 只有页面壳时，在用户授权后可进入 bounded rendered acquisition（有限渲染采集）。

## 安全边界

- 只接受 HTTP / HTTPS，拒绝 URL 内嵌账号密码；
- 阻止 localhost、私网、链路本地、特殊用途 IP 和云 metadata（元数据）目标，包括等价 trailing-dot hostname（末尾点主机名）；
- 网络重定向重新校验；授权渲染页面导航后也重新检查授权、host deny-list（站点禁用列表）和初始 origin（来源域）；
- 带浏览器凭据的授权二进制二次读取禁止自动跟随重定向；
- “加载更多”自动化有次数边界，跨源链接、form / submit 控件不会被自动点击；
- 普通抓取默认无登录态；Authorized Browser Context 必须用户显式授权，可撤销、可按 host 禁用；
- 不用 `chrome.cookies` 直接读取 Cookie 值；不绕过登录、验证码、付费墙、DRM；
- 外部正文统一标记为 `untrusted-external`（不可信外部数据）；
- 附件严格尊重网站 `<input type="file" accept=...>`，没有兼容入口时明确失败，不强行解除限制；附件确认限制在当前 composer（输入区）范围，避免页面其他文字造成假成功；
- 不强制启用 `disabled / aria-disabled` 控件；
- `debugger` 不是通用浏览器控制接口：千问仅在受支持的 HTTPS 域名开放固定输入动作；其他目标只允许显式 Auto-send 下、固定 HTTPS AI host 的受限 Enter fallback（回退）；
- 自动发送必须取得独立发送后证据，否则返回 `SEND_UNCONFIRMED`；一次发送副作用未确认后不会继续链式尝试第二种发送方式；
- STOP 使用同一任务 `startedAt` identity 覆盖 V0.6 与 legacy fallback，避免旧 STOP 误杀新任务或只停 UI、不停后台。

详见 [SECURITY.md](./SECURITY.md)。

## 内置网页 AI 目标

ChatGPT、Claude、Gemini / Google AI Studio、Grok、Perplexity、DeepSeek、豆包（Doubao）、Kimi、Qwen / 通义千问、Poe、Microsoft Copilot、Mistral Chat、OpenRouter。

V0.6 对 ChatGPT、DeepSeek、豆包、千问维护专门 Target Profile；其他站点继续使用通用安全路径或用户显式启用当前网站。

**“内置目标”只表示代码有目标画像/路由，不表示已经完成当前版本真实浏览器 PASS。**

## 安装（Chrome / Edge）

1. 下载或克隆仓库；
2. 打开 `chrome://extensions` / `edge://extensions`；
3. 开启开发者模式；
4. 选择“加载已解压的扩展”；
5. 选择仓库里的 `extension` 文件夹；
6. 当前 `main` 是 V0.6.0。更新后重新加载扩展，并刷新已经打开的 AI 页面；若测试 V0.6.1，请明确使用 PR #12 分支，不要把它误认为已合并正式版。

## 测试与证据

```bash
npm test
npm run check
```

阶段性收尾时：

- V0.6.0（当前 `main`）历史自动化：**322 / 322 PASS**，GitHub Actions CI SUCCESS；
- V0.6.1 实现收口点：**350 / 350 PASS**，GitHub Actions **CI #515 SUCCESS**；
- 但 **CI 通过不等于第三方网页 AI 永久兼容，也不等于 live PASS**。

已知真实浏览器基线：V0.5.3 的 `www.qianwen.com` 核心文本输入/编辑删除及自动发送完成真实浏览器 PASS。V0.5.3 的 ChatGPT / DeepSeek / 豆包 Auto-send 有真实 FAIL 记录。V0.6 / V0.6.1 没有重新实测的能力不会继承为 PASS，而是继续保持 `UNVERIFIED`。

详见：

- [Project Status / 项目状态](./docs/PROJECT-STATUS.md)
- [V0.6 Design / 设计](./docs/V0.6-DESIGN.md)
- [V0.6 Scope Freeze / 范围冻结](./docs/V0.6-SCOPE-FREEZE.md)
- [V0.6 Live Evidence / 真实浏览器证据](./docs/V0.6-LIVE-EVIDENCE.md)
- [V0.6.1 Hardening / 对抗加固记录](./docs/V0.6.1-HARDENING.md)
- [Changelog / 更新记录](./CHANGELOG.md)

## 已知边界

- 不承诺任意 SPA 无限滚动 / “加载更多”全网通吃；
- 本版不会自动理解音视频内容本身，而是保留/交付原文件；
- 第三方网页 AI 的 DOM、编辑器、附件和发送机制会变化；真实 blocker/regression（阻断/回归）允许定向修复；
- V0.5.3 的千问 PASS 不能自动继承成 V0.6/V0.6.1 PASS；
- **V0.6 功能范围继续冻结；V0.6.1 只允许安全、正确性、可靠性和真实性修复，不扩 scope（范围）。**

## License

MIT
