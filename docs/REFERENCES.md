# References / 参考项目

Link2Context V0.2 was designed after checking existing projects first. / V0.2 开发前先做了现成方案撞车检查。

- **MCP SuperAssistant** — https://github.com/Tibutti/mcp-superassistant  
  参考 / Idea reused: inserting local/tool results back into multiple web-AI chat UIs. / 把本地工具结果重新回填到多个网页 AI 输入界面的架构思路。
- **MarkDownload** — https://github.com/deathau/markdownload  
  参考 / Idea reused: browser-side page extraction and Markdown output. / 浏览器端提取网页并转换为 Markdown 的思路。
- **Defuddle** — https://github.com/kepano/defuddle  
  参考 / Idea reused: reducing page chrome/noise and keeping main readable content. / 去页面噪声、保留可读正文的思路。
- **Chrome Extensions documentation** — https://developer.chrome.com/docs/extensions/develop/concepts/network-requests  
  参考 / Security guidance: cross-origin extension fetch is powerful and must not become an arbitrary fetch primitive exposed to untrusted page content. / 跨域抓取权限很强，不能把它暴露成恶意网页可调用的任意请求接口。

No source code from the projects above is copied into this repository. / 本仓库未复制上述项目源代码，继续采用 MIT License。
