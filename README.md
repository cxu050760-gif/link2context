# Link2Context

[English](./README.en.md) | 中文

**在网页 AI 里只发一个链接，Link2Context 在你的浏览器里把真实内容取回来、识别类型、清洗成 AI 真正需要的上下文，再交给当前 AI。**

> 当前 `main` 版本：**V0.5.3**。PR #10 已于 2026-08-22 合并。V0.5.3 重点解决真实浏览器交付可靠性：移除 V0.5.1 + V0.5.2 叠加发送状态机，为中国千问新增受限的 `chrome.debugger`（Chrome 调试器权限）+ CDP（Chrome DevTools Protocol，Chrome 调试协议）真实输入路径，并继续保留 V0.5.2 的授权浏览器上下文回退与安全边界。

## V0.5.3 已完成的重点

- **中国千问真实编辑状态修复**：`qianwen.com` / `www.qianwen.com` / `qwenwork.cn` 不再通过 DOM（页面元素树）伪造文本状态，而是使用 CDP `Input.insertText` 走 Chrome 的真实编辑输入路径。真实浏览器测试已确认：提取后的文本可以正常编辑、删除，不再出现“看得到但删不掉、实际发送时丢失”的假状态。
- **千问自动发送改用真实 Enter**：自动发送使用 CDP `Input.dispatchKeyEvent` 发送 Enter 键，不再猜测千问不稳定的发送按钮；发送后仍要求生成状态或消息离开输入区等独立证据，否则返回 `SEND_UNCONFIRMED`，不把“按了键”当作成功。
- **`debugger` 权限严格收口**：只接受扩展自身内容脚本发来的千问调试输入消息，只允许顶层 frame（顶层页面），只允许 `qianwen.com` / `qwenwork.cn` 及其子域；每次操作临时 attach（连接），完成后立即 detach（解除连接）。如果标签页已被其他调试器占用，会明确返回 `QIANWEN_DEBUGGER_BUSY`。
- **PDF / 图片 / 其他原始二进制保持原文件附件**：不把二进制乱码转成文本；附件交付仍保留独立成功证据。
- **自动发送继续 fail-closed（失败时不假装成功）**：通用网页 AI 的按钮点击本身不算成功，必须观察到独立页面证据。
- **STOP 覆盖完整任务链**：网络读取、分页、附件等待、编辑器交付、自动发送等待都可取消。
- **分页能力扩展但保持边界**：支持 `rel=next`、数字分页、`data-url` / `data-page` / 同源 `onclick location` 等声明型分页；限制同源、同文章 URL family（同一文章 URL 族）、最多 8 页和总响应大小。

## 你实际怎么用

1. 在 ChatGPT、DeepSeek、豆包、Kimi、Claude、Gemini、Qwen / 千问等网页 AI 的聊天框里只粘一个 `http://` 或 `https://` 链接；
2. Link2Context 拦截这次真实用户操作，在浏览器里读取、分类、清洗/解析目标资源；
3. 根据目标 AI 和内容类型选择文本或附件交付；
4. 发送行为独立可选：默认手动确认，也可以显式开启 Auto-send（自动发送）；
5. 如果公开抓取遇到 401 / 403 或 client-render shell（仅有前端壳、正文需浏览器渲染），可由用户在 popup（扩展弹窗）中显式授权浏览器上下文回退；未授权时不会静默借用登录态。

### 千问使用时的额外提示

V0.5.3 为 `qianwen.com` / `qwenwork.cn` 新增了 `debugger` 权限。Chrome 可能显示“扩展正在调试此浏览器/标签页”之类的提示，这是使用真实输入路径的预期行为。

更新到 V0.5.3 后，请在 `chrome://extensions` 重新加载扩展，并刷新已经打开的千问页面。新增权限可能需要浏览器重新确认。

## 授权浏览器上下文回退

- 普通抓取默认无登录态；
- 401 / 403 / `CLIENT_RENDER_CONTENT_MISSING` 只有显式授权后才进入 Authorized Browser Context（授权浏览器上下文）；
- 授权可撤销，并支持 host deny list（按站点禁用列表）；
- 不使用 `chrome.cookies` 直接读取或保存 Cookie 值；
- 请求 URL / 最终 URL、大小、超时、取消边界继续校验；
- 不绕过登录墙、验证码、DRM、付费墙或站点访问控制。

## 通用资源管线

```text
获取 Acquire → 类型识别 Classify → 必要时渲染 Render → 正文提取 Extract → 交付 Handoff
```

Link2Context 使用 byte-first（字节优先）识别：文件签名、MIME 和 URL 扩展名共同判断资源类型。PDF、图片、ZIP、Office、音视频和未知二进制默认保持原文件附件，避免把二进制乱码当文本交给 AI。

HTML 会做轻量正文抽取并移除常见导航、footer（页脚）、sidebar（侧栏）、script/style 等噪声。JSON、纯文本、XML、CSV 等会转换成可读上下文。ChatGPT 分享与 WorkBuddy 分享有专用干净对话解析，只保留有用的用户/助手正文并过滤大块图片、推理和工具载荷。

## 多页文章

安全分页目前覆盖：

- `<link rel="next">`；
- 明确“下一页 / Next”且属于同文章 URL family 的链接；
- 数字分页；
- `data-href` / `data-url` / `data-next-url` / `data-page-url`；
- `data-page` / `data-page-number` / `data-pageno`；
- 同源 `onclick` location 跳转。

仍然要求同源，最多 8 页，并受总响应大小与取消链约束。**V0.5.3 不宣称支持任意 SPA（单页应用）无限滚动或所有“加载更多”页面。**

## 内置自动支持的网站

ChatGPT、Claude、Gemini / Google AI Studio、Grok、Perplexity、DeepSeek、豆包（Doubao）、Kimi、Qwen / 通义千问、Poe、Microsoft Copilot、Mistral Chat、OpenRouter。

其他网页 AI：打开该网站，点击一次 Link2Context 图标，选择 **“启用当前网站自动模式 / Enable current site”**。

## 安装（Chrome / Edge）

1. 下载或克隆仓库；
2. 打开 `chrome://extensions` / `edge://extensions`；
3. 开启开发者模式；
4. 选择“加载已解压的扩展”；
5. 选择仓库里的 `extension` 文件夹；
6. 更新后先 `git pull`，再点扩展“重新加载”，已打开的 AI 页面也刷新一次。

## 安全边界

- 仅 HTTP / HTTPS；
- 拒绝 URL 内账号密码；
- 阻止 localhost、私网、链路本地、特殊用途 IP、云 metadata（元数据）地址；
- 每次重定向重新验证；
- 单次/总响应受大小上限与超时限制；
- 自动抓取必须来自真实用户事件，后台再次验证调用方 AI host；
- 通用 browser-context fallback（浏览器上下文回退）只有用户显式授权后才启用，且可撤销、可按 host 禁用；
- 不直接读取 Cookie 值；
- 外部正文标记为不可信数据；
- 敏感查询参数脱敏；
- 不强行解除网页控件的 `disabled / aria-disabled`；
- `debugger` 权限只用于中国千问的受限文本输入与 Enter 键操作，不作为通用网页控制能力；
- 对千问不把 DOM 可见状态当作发送成功状态。

详见 [SECURITY.md](./SECURITY.md)。

## 测试与验收

```bash
npm test
npm run check
```

V0.5.3 合并前自动化结果：**292 / 292 测试通过**，`npm run check` 通过，GitHub Actions CI（持续集成）成功。

真实浏览器方面，`www.qianwen.com` 的核心文本交付问题已完成实测闭环：提取文本现在进入真实可编辑状态。第三方网页会持续变更，因此自动化全绿仍不等于所有站点未来永久兼容；出现站点 DOM / 编辑器变化时，应继续以真实浏览器 smoke test（冒烟测试）为准。

## 已知边界

- 任意 SPA 无限滚动 / “加载更多”不是通用保证；
- 千问 CDP 路径需要 Chrome `debugger` 权限，如果同一标签页已被 DevTools（开发者工具）或其他调试器独占，可能返回 `QIANWEN_DEBUGGER_BUSY`；
- 第三方网页 AI 的 DOM、编辑器和发送机制变化可能需要重新适配；
- 自动发送默认关闭，建议先使用手动确认模式验证目标站点。

## License

MIT
