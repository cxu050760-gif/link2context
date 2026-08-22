# References / 参考项目

Link2Context follows a **reuse first / 先撞车再开发** rule: check existing projects, reuse proven ideas where appropriate, and only implement the missing integration layer. / Link2Context 开发前先检索成熟方案，能复用思路就不从零猜协议。

## V0.3 — clean conversation extraction / 干净对话提取

- **chickensintrees/chatgpt-share-reader** — https://github.com/chickensintrees/chatgpt-share-reader  
  License / 许可证: MIT.  
  Reference / 参考点: current ChatGPT public-share pages stream React Router hydration through one or more `streamController.enqueue(...)` calls; the payload uses a positional-flatten wire format with integer references and optional `P<idx>:` deferred-promise lines; conversation-shaped data can be found under loader data and contains `mapping` / `linear_conversation`. / 当前 ChatGPT 公开分享页的 turbo-stream、positional-flatten、deferred promise、`mapping` / `linear_conversation` 等协议理解。  
  Link2Context uses an **independent JavaScript decoder** with its own safety limits, active-branch selection, null-prototype decoding, browser fallback, and normalized renderer. It does not copy the Python implementation. / Link2Context 为独立 JavaScript 实现，并增加自己的安全边界、当前分支选择、无原型对象解码、浏览器回退和统一渲染。

- **pionxzh/chatgpt-exporter** — https://github.com/pionxzh/chatgpt-exporter  
  Reference / 参考点: conversation export/rendering UX and the value of separating provider-specific extraction from output formats. / 对话导出体验，以及把“来源解析”和“最终输出格式”分层的思路。

## V0.2 — web-AI bridge / 网页 AI 桥

- **MCP SuperAssistant** — https://github.com/Tibutti/mcp-superassistant  
  Reference / 参考点: inserting local/tool results back into multiple web-AI chat UIs. / 把本地工具结果重新回填到多个网页 AI 输入界面的架构思路。

- **MarkDownload** — https://github.com/deathau/markdownload  
  Reference / 参考点: browser-side page extraction and Markdown output. / 浏览器端提取网页并转换为 Markdown 的思路。

- **Defuddle** — https://github.com/kepano/defuddle  
  Reference / 参考点: reducing page chrome/noise and keeping main readable content. / 去页面噪声、保留可读正文的思路。

- **Chrome Extensions documentation** — https://developer.chrome.com/docs/extensions/develop/concepts/network-requests  
  Reference / 安全参考: cross-origin extension fetch is powerful and must not become an arbitrary fetch primitive exposed to untrusted page content. / 跨域抓取权限很强，不能把它暴露成恶意网页可调用的任意请求接口。

## Code reuse statement / 代码复用声明

No source code from the projects above is copied into Link2Context. Protocol behavior and architectural ideas were studied, then independently implemented and tested in this repository. / 本仓库没有直接复制上述项目源代码；只参考已公开的协议理解和架构思路，再独立实现并测试。

Link2Context remains under the MIT License. / Link2Context 继续采用 MIT License（MIT 开源许可证）。
