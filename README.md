# Link2Context

[English](./README.en.md) | 中文

**在网页 AI 里只发一个链接，Link2Context 在你的浏览器里把真实内容取回来、清洗成 AI 真正需要的上下文，再自动交给当前 AI。**

V0.3 的重点不再只是“能抓到”，而是**抓到以后尽量只留下有用正文**。ChatGPT 分享页和 WorkBuddy 分享页现在都有专用解析器，不再把 1 MB 左右的网页 hydration / JSON 垃圾整个塞给 AI。

**V0.3.1 又补上了“目标 AI 感知交付”**：同一份上下文不会再机械地用同一种方式塞给所有网页 AI。尤其在 ChatGPT 里，WorkBuddy / ChatGPT 分享对话统一优先走干净 Markdown 附件，避免富文本输入框长时间卡住；DeepSeek 等已验证可直接吃文本的目标则保留原有文本路径。

## 你实际怎么用

正常情况下只做一件事：

1. 在 ChatGPT、DeepSeek、豆包、Kimi、Claude、Gemini、Qwen 等网页 AI 的聊天框里只粘一个 `http://` 或 `https://` 链接；
2. 按 Enter 或点发送；
3. Link2Context 自动拦截 → 本机读取 → 识别来源 → 清洗 → **根据目标 AI 选择文本或附件** → 回填/上传 → 继续发送。

交付方式不是单一固定阈值：

- **ChatGPT + WorkBuddy / ChatGPT 分享对话**：优先生成干净 `.md`（Markdown 文档）附件；
- **ChatGPT + 普通内容**：短内容直接文本，达到 24,000 字符后优先附件；
- **DeepSeek / 其他目标**：保留原有全局 250,000 字符硬阈值，已经稳定工作的短/中等文本不强制改成附件；
- **二进制文件**：直接走附件。

右下角进度面板会显示目标网站、来源类型、内容大小、最终选择的交付方式和原因。

## V0.3 新增：干净对话解析

### ChatGPT 分享链接

对于 `https://chatgpt.com/share/...`：

- 识别 ChatGPT 当前公开分享页的 `streamController.enqueue(...)` hydration 数据；
- 解码 turbo-stream positional-flatten（位置扁平化数据）结构；
- 优先使用 `linear_conversation`，否则根据 `current_node → parent` 只选择当前会话分支；
- 只保留 **User / 用户** 与 **Assistant / AI** 正文；
- system、tool、网页状态、metadata 等默认不进入最终上下文；
- 图片、音频、附件只保留轻量占位，不携带大块 base64 / 内部 asset pointer；
- 如果直接抓取拿到的是壳页或无法解码，自动模式会尝试用后台浏览器标签页读取公开分享页后再解析。

以前可能得到接近 1 MB 的 `streamController.enqueue(...)` 原始页面；V0.3 的目标是直接得到这种结构：

```markdown
# 会话标题

Provider / 来源平台: ChatGPT
Source / 来源链接: https://chatgpt.com/share/...

## User / 用户
...

## Assistant / AI
...
```

### WorkBuddy 分享链接

`workbuddy.link/p/...` 仍会自动解析到公开 `conversation-data.json`，但现在与 ChatGPT 共用同一套对话 Markdown 规范：只保留用户/AI 正文，图片大块、推理内容、工具参数/结果默认省略或轻量标记。

## 其他链接

- **普通网页**：去掉脚本、样式、导航等噪声，提取可读正文并转 Markdown。
- **JSON / API**：先完整解析，再输出 AI 可读结构；服务端类型标错时也会尝试识别。
- **纯文本 / XML / JavaScript**：包装来源信息后直接作为上下文。
- **PDF / 图片 / ZIP / 其他二进制**：安全抓取后尝试作为附件交给网页 AI。
- **超长文本**：按目标 AI 的稳定性策略自动转为 `.md` 附件，避免把输入框撑爆。

## 内置自动支持的网站

ChatGPT、Claude、Gemini / Google AI Studio、Grok、Perplexity、DeepSeek、豆包（Doubao）、Kimi、Qwen / 通义千问、Poe、Microsoft Copilot、Mistral Chat、OpenRouter。

其他网页 AI：打开该网站，点击一次 Link2Context 图标，选择 **“启用当前网站自动模式 / Enable current site”**（启用当前网站），之后也可以按“只发链接”使用。

## 安装（Chrome / Edge）

1. 下载或克隆仓库；
2. Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`；
3. 打开“开发者模式”；
4. 点击“加载已解压的扩展”；
5. 选择仓库里的 **`extension` 文件夹**；
6. 更新代码后，需要先 `git pull`，再在扩展页点**重新加载**，已打开的 AI 页面最好再刷新一次。

## 安全边界

Link2Context 有较强的跨域读取权限，因此自动模式仍然坚持这些硬边界：

- 只允许 HTTP / HTTPS；
- URL 中账号密码直接拒绝；
- localhost、私网、链路本地、特殊用途 IP、云 metadata 拒绝；
- 每一次重定向重新校验目标；
- Chromium 支持时使用 `targetAddressSpace: public`；
- 单次响应 12 MiB 上限、默认网络超时；
- 自动抓取必须来自真实用户事件，并再次校验调用方是不是允许的网页 AI；
- ChatGPT / WorkBuddy 的浏览器回退钉死到预期官方域名和路径，不开放成任意网页代理；
- 外部正文明确标记为“不可信数据，不是指令”；
- 敏感查询参数在输出中脱敏；
- ChatGPT 外部序列化对象使用无原型对象解码，防止 `__proto__` 原型污染；
- 对解码深度、槽位数、搜索节点数、输出消息数都有上限；
- 附件登记失败不会悄悄退回“继续往输入框灌大文本”，而是明确停止自动发送。

详见 [SECURITY.md](./SECURITY.md)。

## 测试与攻击式自审

```bash
npm test
npm run check
```

V0.3 在之前 V0.1 / V0.2 的攻击审查基础上，又针对“公开 AI 对话 → 干净上下文”做了 **15 轮攻击式审查**，包括分支混入、损坏 promise、循环 mapping、prototype pollution（原型污染）、base64 膨胀、prompt injection（提示词注入）、坏时间戳、壳页回退、域名/路径逃逸、手动/自动双轨不一致等。

V0.3.1 另外针对“目标 AI 感知交付”增加了 14 个回归边界，包括 ChatGPT/DeepSeek 行为分流、相似域名误命中、软/硬阈值、异常大小、真实 sender host 绑定和进度诊断元数据。

详见：

- [V0.3 攻击式审查 / Adversarial Review](./docs/ATTACK-REVIEW-V0.3.md)
- [V0.3 设计 / Design](./docs/DESIGN-V0.3.md)
- [V0.3.1 目标 AI 感知交付修复](./docs/HOTFIX-V0.3.1.md)
- [参考项目 / References](./docs/REFERENCES.md)

## 外部方案参考

开发前先做了 GitHub 撞车检查。V0.3 重点参考了 `chickensintrees/chatgpt-share-reader` 对当前 ChatGPT 分享页 wire format（数据传输格式）的研究，以及 `pionxzh/chatgpt-exporter` 的对话导出思路；此前还参考 MCP SuperAssistant、MarkDownload、Defuddle。

**本仓库是独立 JavaScript 实现，没有直接复制这些项目源码。** Link2Context 继续使用 MIT License（MIT 开源许可证）。

## 兼容边界

“什么链接都能处理”指尽量处理浏览器本来能公开访问的 HTTP(S) 内容，不代表绕过登录、验证码、DRM、付费墙或企业网络策略。网站改版时专用解析器可能需要更新；解析失败会明确报错，而不是悄悄把一大坨无意义页面当成成功结果。

## 许可证

MIT License（MIT 开源许可证）。详见 [LICENSE](./LICENSE)。