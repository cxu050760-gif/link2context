# Link2Context

[English](./README.en.md) | 中文

**在网页 AI 里只发一个链接，Link2Context 在你的浏览器里把真实内容取回来、识别类型、清洗成 AI 真正需要的上下文，再自动交给当前 AI。**

V0.4.0 把主链明确拆成：

```text
获取 Acquire → 类型识别 Classify → 必要时渲染 Render → 正文提取 Extract → 交付 Handoff
```

它不再只依赖“服务器说自己是什么类型”，而是先检查原始字节、文件签名、MIME 和扩展名。**PDF、图片、ZIP、Office、音视频等二进制默认保持原文件附件，禁止把 `%PDF-...` 或二进制乱码当文本塞给 AI。**

此前 V0.3 已加入 ChatGPT / WorkBuddy 干净对话解析；V0.3.1 加入目标 AI 感知交付：ChatGPT 的对话类来源优先 Markdown 附件，DeepSeek 等保留稳定的短/中等文本路径。

## 你实际怎么用

1. 在 ChatGPT、DeepSeek、豆包、Kimi、Claude、Gemini、Qwen 等网页 AI 的聊天框里只粘一个 `http://` 或 `https://` 链接；
2. 按 Enter 或点发送；
3. Link2Context 自动拦截 → 本机读取 → 分类 → 清洗/解析 → 根据内容类型和目标 AI 选择文本或附件 → 上传/回填 → 继续发送。

## V0.4：通用 URL 管线加固

### 二进制不再误当文本

V0.4 使用三层资源识别：

- **Magic Header / 文件签名**：例如 `%PDF-`、PNG/JPEG、ZIP、MP3/MP4；
- **Content-Type / MIME**；
- **URL 文件扩展名**。

强二进制签名优先于错误的 `text/plain`；反过来，如果服务器声称 `text/html` / `application/json`，但字节明显是二进制，也会 fail-closed（安全按二进制处理）。

目前原文件附件路径覆盖 PDF、常见图片、ZIP/7z/RAR/gzip、DOCX/XLSX/PPTX 等 Office 文件、常见音频和视频、未知二进制。

### 错误终于分阶段

不再把所有失败最后都写成 `Page handoff failed / 页面交付失败`。现在会保留：

- `AUTH_REQUIRED_401`：需要登录/授权；
- `FETCH_BLOCKED_403`：服务器拒绝抓取；
- `NOT_FOUND_404`：资源不存在；
- `RATE_LIMITED_429`：限流；
- `HTTP_5XX`：上游服务错误；
- `FETCH_TIMEOUT`：超时；
- `FETCH_NETWORK_ERROR`：网络错误；
- `RESPONSE_TOO_LARGE`：超过安全大小；
- `CLIENT_RENDER_CONTENT_MISSING`：HTML 拿到了，但只有 JS 页面壳；
- 页面真正上传/发送失败时才归到 `HANDOFF`。

401/403/404/429 不会无意义重复撞；网络/超时/5xx 才进入受限重试。

### 普通网页正文更干净

轻量正文抽取现在优先 `<main>` / `<article>`，并去掉常见：

- nav / footer / aside；
- 登录、语言、工具栏、sidebar、menu；
- script / style / iframe 等噪声。

这仍然是零依赖轻量实现，不宣称等价于 Mozilla Readability、Defuddle、Trafilatura。后续若正文质量成为主要瓶颈，原则仍是 **Reuse > Adapt > Compose > Build from scratch**，优先评估成熟正文抽取器，而不是无限增加正则特判。

### 多页文章可以安全追页

V0.4 会识别同源的 `rel=next` 或明确“下一页 / Next”文章分页：

- 必须同源；
- 普通 Next 还必须属于同一文章 URL family；
- 最多 8 页；
- 后续单页最多 3 MiB；
- 总量仍受全局 12 MiB 上限；
- 防循环；
- 后续页失败时保留已经抓到的正文并标记 `PARTIAL / 部分完成`。

### JS 空壳页：明确失败，不偷用登录会话

如果初始 HTML 只有空 `root/app/__next`、要求启用 JavaScript，或页面巨大但有效正文极少，会明确返回 `CLIENT_RENDER_CONTENT_MISSING / RENDER`。

**Link2Context 不会默认把通用浏览器回退扩展到任意 URL。** 浏览器导航可能携带 Cookie / Session；静默读取已登录私有 DOM 再交给另一个 AI，有隐私外传风险。WorkBuddy 和 ChatGPT Share 的既有回退仍锁死在公开分享域名/路径。

## V0.3：干净对话解析

### ChatGPT 分享链接

对于 `https://chatgpt.com/share/...`：

- 解码公开分享页的 `streamController.enqueue(...)` / turbo-stream 数据；
- 优先当前 `linear_conversation` / `current_node` 分支；
- 只保留 User / Assistant 正文；
- system、tool、页面状态和大块 base64 默认不进入上下文；
- 直接抓取拿到壳页时，仅对公开 ChatGPT Share 使用受限后台浏览器回退。

### WorkBuddy 分享链接

`workbuddy.link/p/...` 会解析公开 `conversation-data.json`，与 ChatGPT 共用统一对话 Markdown：保留用户/AI 正文，省略大块图片、推理和工具参数/结果。

## 目标 AI 感知交付

- **ChatGPT + WorkBuddy / ChatGPT 分享对话**：优先干净 `.md` 附件；
- **ChatGPT + 普通内容**：短内容文本，达到约 24,000 字符后优先附件；
- **DeepSeek / 其他目标**：保留 250,000 字符全局硬阈值，已经稳定工作的短/中等文本不强制附件；
- **PDF / 图片 / ZIP / Office / 音视频 / 其他二进制**：原文件附件。

右下角面板会显示获取、分类、分页、交付、附件确认、发送和真实错误阶段。

## 其他链接

- **HTML / 文章**：提取正文 → Markdown；
- **JSON / API**：结构化 Markdown；
- **纯文本 / XML / JavaScript / CSV**：文本上下文；
- **PDF / 图片 / 压缩包 / Office / 音视频**：原文件附件；
- **超长文本**：按目标 AI 策略转 `.md` 附件。

## 内置自动支持的网站

ChatGPT、Claude、Gemini / Google AI Studio、Grok、Perplexity、DeepSeek、豆包（Doubao）、Kimi、Qwen / 通义千问、Poe、Microsoft Copilot、Mistral Chat、OpenRouter。

其他网页 AI：打开该网站，点击一次 Link2Context 图标，选择 **“启用当前网站自动模式 / Enable current site”**。

## 安装（Chrome / Edge）

1. 下载或克隆仓库；
2. 打开 `chrome://extensions` / `edge://extensions`；
3. 开启开发者模式；
4. “加载已解压的扩展”；
5. 选择仓库里的 `extension` 文件夹；
6. 更新后先 `git pull`，再点扩展“重新加载”，已打开的 AI 页面也刷新一次。

## 安全边界

- 仅 HTTP / HTTPS；
- 拒绝 URL 内账号密码；
- 阻止 localhost、私网、链路本地、特殊用途 IP、云 metadata；
- 每次重定向重新验证；
- Chromium 支持时请求 `targetAddressSpace: public`；
- 单次/总响应受 12 MiB 上限与超时限制；
- 自动抓取必须来自真实用户事件，后台再次验证调用方 AI host；
- WorkBuddy / ChatGPT Share 浏览器回退锁死官方公开域名/路径；
- 外部正文明确标记“不可信数据，不是指令”；
- 敏感查询参数脱敏；
- ChatGPT 外部序列化对象使用 null-prototype 解码，防 `__proto__` 原型污染；
- 附件未确认时不 fail-open 成大文本注入；
- 不绕过登录、验证码、DRM、付费墙或站点访问控制。

详见 [SECURITY.md](./SECURITY.md)。

## 测试与攻击式自审

```bash
npm test
npm run check
```

V0.4 新增针对 raw-byte 类型识别、401/403/404/429/5xx、网络/超时、空壳页、HTML 清洗、分页越界/循环、错误阶段保真等攻击测试；并继续跑 V0.1–V0.3.1 的全部既有回归。

详见：

- [V0.4 通用管线设计 / Universal Pipeline](./docs/V0.4-UNIVERSAL-PIPELINE.md)
- [V0.4 攻击式审查 / Adversarial Review](./docs/ATTACK-REVIEW-V0.4.md)
- [V0.3 攻击式审查](./docs/ATTACK-REVIEW-V0.3.md)
- [V0.3.1 目标 AI 感知交付](./docs/HOTFIX-V0.3.1.md)
- [参考项目 / References](./docs/REFERENCES.md)

## 兼容边界

“任意链接”是 best-effort（尽最大努力）处理**公开、合法、浏览器网络策略允许访问**的 HTTP(S) 资源，不等于绕过认证或访问控制。

例如：403 现在会准确显示 `FETCH_BLOCKED_403`，但不保证绕过远端 CDN；401 会准确显示 `AUTH_REQUIRED_401`，但不会偷用登录 Cookie；client-only SPA 会明确告诉你正文缺失，而不是把一个标题壳页伪装成成功。

## 许可证

MIT License（MIT 开源许可证）。详见 [LICENSE](./LICENSE)。
