# Link2Context

[English](./README.en.md) | 中文

**在网页 AI 里只给一个链接，Link2Context 尽可能完整地读取真实信息，保留结构、关键图片与原文件，再按当前 AI 能接收的方式交过去。读不全、传不全或尚未验证的部分会明确暴露，不静默丢失。**

> 当前版本：**V0.6.0 — Structured Context Bridge（结构化上下文桥）**。V0.6 已完成代码收口并冻结功能开发；真实第三方网页能力与代码完成状态分开记录，详见 `docs/V0.6-LIVE-EVIDENCE.md`。

## V0.6 的核心变化

- **结构不再被压成一坨文本**：内部使用 canonical Context Model（规范上下文模型）保存标题、段落、列表、引用、代码、表格、链接、图片、附件和来源关系；Markdown 只是输出格式。
- **复用 Mozilla Readability**：正文提取以固定版本 Readability + structured DOM walker（结构化 DOM 遍历）为主，不继续堆正则正文提取器。
- **真正处理图文**：识别 `src` / `srcset` / 常见 lazy-load 图片，过滤追踪图和明显噪声，实际下载关键图片并校验 MIME；图片交付失败会明确标记 partial（部分完成），不会静默自动发送。
- **分页更保守**：传统分页之外加入 Article Identity（文章身份）检查与去重，宁可明确停止，也不把下一篇文章拼进当前正文。
- **动态网页有限渲染**：只有显式授权 Authorized Browser Context（授权浏览器上下文）后，才允许受限等待正文、DOM settle（稳定）、有限滚动/加载更多；所有步骤有次数、大小、超时和取消边界。
- **旧编码更稳**：BOM → HTTP charset → HTML/XML 声明 → UTF-8 合法性 → 有界回退，并记录编码来源/置信度。
- **按目标 AI 交付**：ChatGPT、DeepSeek、豆包、千问拥有独立 Target Profile（目标 AI 能力画像）；手动交付与 Auto-send（自动发送）分开，未有真实证据的能力保持 `UNVERIFIED`。
- **保留已验证能力**：千问继续使用 V0.5.3 已实测的 CDP `Input.insertText` + 真实 Enter；PDF、图片、Office、压缩包、音视频和未知二进制继续保持原文件附件。

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
- 阻止 localhost、私网、链路本地、特殊用途 IP 和云 metadata（元数据）目标；
- 网络重定向重新校验；授权渲染页面导航后也重新检查授权与 host deny-list（站点禁用列表）；
- “加载更多”自动化有次数边界，跨源链接不会被自动点击；
- 普通抓取默认无登录态；Authorized Browser Context 必须用户显式授权，可撤销、可按 host 禁用；
- 不用 `chrome.cookies` 直接读取 Cookie 值；不绕过登录、验证码、付费墙、DRM；
- 外部正文统一标记为 `untrusted-external`（不可信外部数据）；
- 附件严格尊重网站 `<input type="file" accept=...>`，没有兼容入口就明确失败，不强行解除限制；
- 不强制启用 `disabled / aria-disabled` 控件；
- `debugger` 不是通用浏览器控制接口：千问仅固定输入动作；其他目标只允许显式 Auto-send 下的受限 Enter fallback（回退）；
- 自动发送必须取得独立发送后证据，否则返回 `SEND_UNCONFIRMED`。

详见 [SECURITY.md](./SECURITY.md)。

## 内置网页 AI 目标

ChatGPT、Claude、Gemini / Google AI Studio、Grok、Perplexity、DeepSeek、豆包（Doubao）、Kimi、Qwen / 通义千问、Poe、Microsoft Copilot、Mistral Chat、OpenRouter。

V0.6 对 ChatGPT、DeepSeek、豆包、千问维护专门 Target Profile；其他站点继续使用通用安全路径或用户显式启用当前网站。

## 安装（Chrome / Edge）

1. 下载或克隆仓库；
2. 打开 `chrome://extensions` / `edge://extensions`；
3. 开启开发者模式；
4. 选择“加载已解压的扩展”；
5. 选择仓库里的 `extension` 文件夹；
6. 更新后执行 `git pull`，重新加载扩展，并刷新已经打开的 AI 页面。

## 测试与证据

```bash
npm test
npm run check
```

V0.6 发布候选要求全量自动化和 GitHub Actions CI（持续集成）全绿，并单独维护真实浏览器 evidence（证据）。**CI 通过不等于第三方网页 AI 永久兼容。**

已知历史基线：V0.5.3 的 `www.qianwen.com` 核心文本输入/编辑删除及自动发送曾完成真实浏览器 PASS。V0.6 没有重新实测的能力不会继承为 V0.6 PASS，而是继续保持 `UNVERIFIED`。

详见：

- [V0.6 Design / 设计](./docs/V0.6-DESIGN.md)
- [V0.6 Scope Freeze / 范围冻结](./docs/V0.6-SCOPE-FREEZE.md)
- [V0.6 Live Evidence / 真实浏览器证据](./docs/V0.6-LIVE-EVIDENCE.md)
- [Changelog / 更新记录](./CHANGELOG.md)

## 已知边界

- 不承诺任意 SPA 无限滚动 / “加载更多”全网通吃；
- 本版不会自动理解音视频内容本身，而是保留/交付原文件；
- 第三方网页 AI 的 DOM、编辑器、附件和发送机制会变化；真实 blocker/regression（阻断/回归）允许定向修复；
- **V0.6 功能开发已冻结，不再继续扩 scope（范围）。**

## License

MIT
