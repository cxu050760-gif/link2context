# Link2Context

[English](./README.en.md) | 中文

**在网页 AI 里只发一个链接，Link2Context 自动把链接背后的真实内容拿回来，再交给当前 AI。**

V0.2 的目标不是“下载器”，而是网页 AI 的本地链接桥：ChatGPT、豆包、Kimi、Claude、Gemini、DeepSeek、Qwen 等网页端自己抓不到某个 URL 时，由浏览器扩展在本机完成抓取、清洗、转换和回填。

## 最终使用方式

正常情况下，你只做原本就会做的动作：

1. 在网页 AI 的聊天输入框里粘贴一个 `http://` 或 `https://` 链接；
2. 按 Enter 或点击发送；
3. Link2Context 会拦住这次“只含链接”的发送；
4. 在本机读取链接；
5. 自动整理成 AI 可读上下文；
6. 自动替换当前消息并继续发送。

```text
你： https://workbuddy.link/p/xxxx
        ↓
Link2Context（本机浏览器）
        ↓
抓取真实数据 → 清洗/转换 → 回填聊天框
        ↓
网页 AI 实际收到：整理后的完整上下文
```

你不需要再手动“下载 → 转 Markdown → 复制 → 上传”。

## 内置自动支持的网站

当前内置：

- ChatGPT
- Claude
- Gemini / Google AI Studio
- Grok
- Perplexity
- DeepSeek
- 豆包（Doubao）
- Kimi
- Qwen / 通义千问
- Poe
- Microsoft Copilot
- Mistral Chat
- OpenRouter

其他网页 AI：打开该网站后点一次 Link2Context 图标，选择 **“启用当前网站自动模式 / Enable”**，之后同样可以按“只发链接”使用。

## 链接类型

- **WorkBuddy 分享链接**：自动把 `workbuddy.link/p/...` 解析到真实 `conversation-data.json`，提取聊天正文，跳过图片 base64、工具参数和推理大块。
- **普通网页**：提取 HTML 中可读正文并包装成 Markdown 上下文。
- **JSON / API**：完整解析后变成 AI 可读 Markdown；即使服务端 `Content-Type` 写错也会尝试识别。
- **纯文本 / XML / JavaScript**：直接整理成带来源信息的上下文。
- **PDF / 图片 / ZIP / 其他二进制**：自动抓取文件并尝试附加到当前网页 AI 消息。
- **超长文本**：如果直接塞进聊天框过长，会自动转成 `.md` 附件，避免把网页 AI 输入框撑爆。

## 安装（Chrome / Edge）

1. 下载或克隆本仓库；
2. Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`；
3. 打开“开发者模式”；
4. 点击“加载已解压的扩展”；
5. 选择仓库里的 **`extension` 文件夹**；
6. 打开一个支持的网页 AI，直接发送一个链接测试。

## 安全边界

Link2Context 拥有广泛 URL 读取能力，所以 V0.2 把自动抓取限制在真实用户操作链上：

- 只接受 HTTP / HTTPS；
- 拒绝 URL 内账号密码；
- 拦 localhost、私网、链路本地、常见特殊用途 IP、云 metadata；
- 每次重定向都重新校验目标；
- Chrome 支持时额外声明 `targetAddressSpace: public`；
- 单次响应最多 12 MiB、默认 25 秒超时；
- 普通网页不能直接远程调用扩展；
- 自动模式只响应真实浏览器事件（`isTrusted`）；
- 后台再次检查调用方是否为内置/用户显式启用的 AI 网站；
- 敏感查询参数在输出里脱敏；
- 外部网页正文明确标为“不可信数据”，不把网页里的提示词当系统指令。

详见 [SECURITY.md](./SECURITY.md)。

## 兼容说明

“任意 URL”不是承诺绕过网站登录、验证码、DRM、付费墙或浏览器本身的企业网络策略。V0.2 的目标是：**对浏览器本来可以公开 GET 的 HTTP(S) 内容，网页 AI 不再需要自己具备 URL 抓取能力。**

强依赖前端 JavaScript 渲染的 SPA，直接 GET 可能只有很少正文；二进制自动上传也取决于目标 AI 网站是否提供兼容的文件输入控件。遇到未知 AI 网站可用弹窗启用自动模式，手动转换器仍保留作兼容后备。

## 测试与攻击式自审

```bash
npm test
npm run check
```

V0.2 在原 V0.1 六轮攻击基础上，又执行了 **15 轮**针对自动模式的攻击式审查，包括 SSRF 变体、重定向、假发送成功、附件抢跑、富文本编辑器、恶意网页借用扩展、超长上下文等。

详见：

- [V0.2 攻击式审查 / Adversarial Review](./docs/ATTACK-REVIEW-V0.2.md)
- [参考项目 / References](./docs/REFERENCES.md)

## 参考思路

V0.2 在设计前专门做了 GitHub 撞车检查，参考了 MCP SuperAssistant 的网页 AI 回填思路、MarkDownload 的浏览器端网页转 Markdown 思路、Defuddle 的正文提取思路。**没有复制这些项目的代码**，本仓库继续使用 MIT License。

## 许可证

MIT License。详见 [LICENSE](./LICENSE)。
