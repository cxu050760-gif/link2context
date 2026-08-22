# Link2Context

[English](./README.en.md) | 中文

**在网页 AI 里只发一个链接，Link2Context 在你的浏览器里把真实内容取回来、识别类型、清洗成 AI 真正需要的上下文，再交给当前 AI。**

> 当前测试分支：**V0.5.3**。本版正在针对真实浏览器交付做收尾：保留 V0.5.2 的授权浏览器回退与安全边界，但不再叠加 V0.5.1 + V0.5.2 两套发送状态机；当前使用 V0.5.3 通用 runtime，并为 Qwen / 通义千问增加独立的“真实编辑状态验证”适配层。**V0.5.3 仍是 Draft 候选，真实网页 smoke 未通过前不合并。**

## V0.5.3 当前收尾重点

- **Qwen / 千问不再把“看得到”当“真的能发”**：真实测试曾出现扩展生成内容无法删除、用户后来输入几个字后发送却只发出那几个字。这证明页面可见内容仍可能没有进入千问内部发送状态。V0.5.3 因此要求更强的状态证据。
- **普通网页文本改走浏览器编辑路径**：千问文本交付使用浏览器原生编辑命令写入当前 editor，不直接改 `innerHTML` / `textContent`，也不在写入后伪造 `InputEvent`；写入后必须经过失焦/回焦仍存在，并且千问自己的发送控件已经自行可用，才算交付成功。否则明确报 `QWEN_EDITOR_STATE_UNCONFIRMED`。
- **PDF / 图片等原始二进制仍保持原文件**：附件文件名出现在 DOM 中不再算充分成功；至少还必须观察到可用发送控件，否则报 `QWEN_ATTACHMENT_STATE_UNCONFIRMED`。
- **Qwen 手势只有一个 owner**：`qwen-state-bridge-v053.js` 在通用 `content-script-v053.js` 前加载，并对已经接管的 paste / Enter / click 使用 `stopImmediatePropagation()`，避免两个状态机同时处理一次操作。
- **自动发送继续 fail-closed**：点击按钮不算成功；必须有生成状态或消息真正离开输入区的独立证据，否则返回 `SEND_UNCONFIRMED`。
- **STOP 覆盖完整交付阶段**：网络读取、附件等待、编辑器写入和自动发送等待都可取消。
- **分页继续扩展但保持边界**：支持 `rel=next`、数字分页、`data-url` / `data-page` / 同源 `onclick location` 等声明型分页；限制同源、同文章 family、最多 8 页和总大小上限。

## 你实际怎么用

1. 在 ChatGPT、DeepSeek、豆包、Kimi、Claude、Gemini、Qwen 等网页 AI 的聊天框里只粘一个 `http://` 或 `https://` 链接；
2. Link2Context 拦截这次真实用户操作，在浏览器里读取、分类、清洗/解析目标资源；
3. 根据目标 AI 和内容类型选择文本或附件交付；
4. 发送行为仍独立可选：默认手动确认，也可以显式开启自动发送；
5. 如果公开抓取遇到 401 / 403 或 client-render shell，可由用户在 popup 中显式授权浏览器上下文回退；未授权不静默借用登录态。

## V0.5.2 保留能力：授权浏览器回退

- 普通抓取默认无登录态；
- 401 / 403 / `CLIENT_RENDER_CONTENT_MISSING` 只有显式授权后才进入 Authorized Browser Context；
- 授权可撤销，并支持 host deny list；
- 不使用 `chrome.cookies` 直接读取或保存 Cookie 值；
- 请求 URL / 最终 URL、大小、超时、取消边界继续校验；
- 不绕过登录墙、验证码、DRM、付费墙或站点访问控制。

## 通用资源管线

```text
获取 Acquire → 类型识别 Classify → 必要时渲染 Render → 正文提取 Extract → 交付 Handoff
```

Link2Context 使用 byte-first 识别：文件签名、MIME 和 URL 扩展名共同判断资源类型。PDF、图片、ZIP、Office、音视频和未知二进制默认保持原文件附件，避免把二进制乱码当文本交给 AI。

HTML 会做轻量正文抽取并移除常见导航、footer、sidebar、script/style 等噪声。JSON、纯文本、XML、CSV 等会转换成可读上下文。ChatGPT 分享与 WorkBuddy 分享有专用干净对话解析，只保留有用的用户/助手正文并过滤大块图片、推理和工具载荷。

## 多页文章

安全分页目前覆盖：

- `<link rel="next">`；
- 明确“下一页 / Next”且属于同文章 URL family 的链接；
- 数字分页；
- `data-href` / `data-url` / `data-next-url` / `data-page-url`；
- `data-page` / `data-page-number` / `data-pageno`；
- 同源 `onclick` location 跳转。

仍然要求同源，最多 8 页，并受总响应大小与取消链约束。V0.5.3 不宣称支持任意 SPA 无限滚动。

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
- 单次/总响应受大小上限与超时限制；
- 自动抓取必须来自真实用户事件，后台再次验证调用方 AI host；
- 通用 browser-context fallback 只有用户显式授权后才启用，且可撤销、可按 host 禁用；
- 不直接读取 Cookie 值；
- 外部正文标记为不可信数据；
- 敏感查询参数脱敏；
- 不强行解除网页控件的 `disabled / aria-disabled`；
- 对 Qwen / 千问尤其不把 DOM 可见状态当作发送成功状态。

详见 [SECURITY.md](./SECURITY.md)。

## 测试

```bash
npm test
npm run check
```

V0.5.3 当前 GitHub Actions 会同时执行语法检查与全量 Node 回归。自动化通过仍不等于第三方网页 DOM 一定兼容，因此 Qwen、DeepSeek、豆包、多页网页、STOP、PDF、图片仍保留最小真实浏览器 smoke gate。

## License

MIT
