# Link2Context

[English](./README.en.md) | 中文

**把各种链接转换成网页 AI 能直接吃的上下文。**

Link2Context 是一个本地浏览器扩展。它不要求 ChatGPT、豆包、Kimi、Claude、Gemini 等云端 AI 自己去抓远程 URL，而是在你的浏览器里完成抓取、清洗和转换，然后让你把 Markdown 文本复制给 AI，或者保存成 `.md` / 原文件后上传给 AI。

## 现在能做什么

- **WorkBuddy 分享链接**：识别 `https://workbuddy.link/p/...`，自动改写到公开的 `conversation-data.json`，提取聊天正文，跳过图片 base64、工具参数和推理大块。
- **普通网页**：抓 HTML，去掉脚本、样式等噪声，提取主要文本并输出 Markdown 包装。
- **JSON / API 响应**：完整解析后转成可读 Markdown；支持服务端未正确声明 `Content-Type` 的情况。
- **纯文本 / XML / JavaScript**：转成带来源信息的 AI 上下文。
- **PDF / 图片 / 压缩包 / 其他二进制**：不硬解析，走受限的“下载原文件”，然后可上传给网页 AI。
- **中文网页编码**：根据响应头处理 UTF-8、GBK/GB2312、ISO-8859-1 等浏览器支持的字符集。

## 为什么对网页 AI 有用

很多云端 AI 的联网工具有域名、响应类型、大小、超时或安全策略限制。Link2Context 把“拿到链接背后的内容”这一步放在**你的浏览器**里：

```text
链接
  ↓
Link2Context 浏览器扩展（本机抓取）
  ↓
Markdown / 原文件
  ↓
ChatGPT / 豆包 / Kimi / Claude / Gemini / 其他网页 AI
```

因此不依赖某一家 AI 是否支持任意 URL 抓取。

## 安装（Chrome / Edge）

1. 下载或克隆本仓库。
2. 打开浏览器扩展管理页：
   - Chrome：`chrome://extensions`
   - Edge：`edge://extensions`
3. 打开“开发者模式”。
4. 点击“加载已解压的扩展”。
5. **选择本仓库里的 `extension` 文件夹。**
6. 固定 Link2Context 图标，之后点击即可使用。

## 使用

1. 复制一个 `http://` 或 `https://` 链接。
2. 打开 Link2Context。
3. 粘贴链接，点击 **“转换 / Convert”**。
4. 文本类内容会变成 Markdown：
   - 点 **“复制 / Copy”**，粘贴给任意网页 AI；或
   - 点 **“保存 .md / Save”**，把文件上传给网页 AI。
5. 如果是 PDF、图片、ZIP 等二进制，点 **“下载原文件 / Download original”**，再上传给 AI。

## WorkBuddy 示例

输入：

```text
https://workbuddy.link/p/fqAaNqzcOZ0DzTS9JZGXsM?ext2=copy_link
```

扩展会自动解析分享码并抓取：

```text
https://workbuddy-space-static.codebuddy.work/page/fqAaNqzcOZ0DzTS9JZGXsM/0/conversation-data.json
```

然后输出轻量的聊天 Markdown，不把大块图片 base64 和工具参数塞进 AI 上下文。

## 安全边界

V0.1 不是“无限制 curl”。它会：

- 只允许 HTTP / HTTPS；
- 拒绝 URL 内账号密码；
- 拒绝 localhost、常见私网/链路本地地址和云元数据地址；
- **每次重定向都重新检查目标**；
- 最多跟随 5 次重定向；
- 单次抓取上限 12 MiB；
- 抓取超时 25 秒；
- 对输出里的敏感查询参数（token、api_key、secret 等）做脱敏；
- 把外部内容明确标记为“不可信数据”，降低网页内容提示注入混淆风险。

注意：浏览器扩展无法像后端代理一样可靠地做 DNS 解析后私网判定，因此 V0.1 不宣称能够防御所有 DNS rebinding 场景。不要把扩展暴露成远程可调用的任意 URL 代理。

## 当前限制

- SPA / 强依赖 JavaScript 渲染的网站，直接 fetch 到的 HTML 可能正文很少；后续可增加“读取当前已渲染页面”模式。
- PDF、图片、Office 等二进制文件当前只负责安全下载，不做 OCR / PDF 转 Markdown。
- V0.1 采用“复制 / 保存 / 上传”方式兼容所有网页 AI，**还没有针对每个 AI 网站做自动注入输入框**。
- 最大响应 12 MiB，超过会拒绝。

## 测试

需要 Node.js 20+：

```bash
npm test
npm run check
```

当前 V0.1 包含针对 WorkBuddy、大 JSON、URL 安全、重定向、异常时间戳、编码、打包完整性等回归测试。

## 攻击式自审

开发过程中至少进行了 6 轮攻击式审查，并在每轮发现问题后修复和补回归测试。详见：

[docs/ATTACK-REVIEW.md](./docs/ATTACK-REVIEW.md)

## 许可证

MIT License。详见 [LICENSE](./LICENSE)。
