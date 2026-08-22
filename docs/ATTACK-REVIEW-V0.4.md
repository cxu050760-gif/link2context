# Link2Context V0.4.0 — Adversarial Review / 攻击式审查

目标：验证 V0.4 的通用五层没有为了“支持更多链接”而牺牲安全边界，也不允许二进制、认证失败、空壳页、分页等重新落回一个模糊的 SUCCESS/FAIL。

## 结论

V0.4 在 V0.1–V0.3.1 全部既有回归基础上新增资源类型、错误分类、HTML 清洗、分页和错误阶段测试。首轮 CI 暴露了一个“声明 text/html 但字节明显二进制”的 fail-open 风险，已修成 fail-closed；第二轮 CI 暴露 4 个旧测试仍绑定 V0.3.1 实现细节，已升级为验证 V0.4 契约，而不是倒退代码。

最终合并门禁必须同时满足：

- `npm test` 全通过；
- `npm run check` 全通过；
- GitHub Actions 全绿；
- PR 非 Draft 后再合并；
- 不用 CI 冒充真实外部网站验收。

## 攻击轮次

| # | 攻击 | 预期 / 结果 |
|---|---|---|
| 1 | PDF 返回正确 `application/pdf` | 原文件附件，不 decode 文本 |
| 2 | PDF 错报 `text/plain` | `%PDF-` magic 优先，仍为 PDF |
| 3 | `.pdf` + `application/octet-stream` | 扩展名保守兜底为 PDF |
| 4 | 服务器声称 `text/html`，字节含 NUL/控制字节 | fail-closed 为 binary；此项首轮发现并修复 |
| 5 | PNG/JPEG/GIF/WebP 错 MIME | magic 识别为 image |
| 6 | ZIP / gzip / 7z / RAR | archive，不转文本 |
| 7 | DOCX/XLSX/PPTX 的 ZIP 容器 | 结合扩展名恢复 Office MIME |
| 8 | MP3/WAV/OGG/MP4/WebM | audio/video，不转文本 |
| 9 | 真正纯文本却返回 octet-stream | 文本字节检测后安全救回 text |
| 10 | JSON/HTML 返回 octet-stream | sniff 后进入 JSON/HTML 路径 |
| 11 | NUL-heavy / control-heavy payload | unknown binary，不喂给 Markdown |
| 12 | HTTP 401 | `AUTH_REQUIRED_401`, stage=`AUTH`，不重试撞墙 |
| 13 | HTTP 403 | `FETCH_BLOCKED_403`, stage=`FETCH`，不假称 handoff 失败 |
| 14 | HTTP 404 | `NOT_FOUND_404`，不重试 |
| 15 | HTTP 429 | `RATE_LIMITED_429`，不做兼容 fetch |
| 16 | HTTP 5xx | 允许受限重试，最终仍保留 `HTTP_5XX` |
| 17 | 网络错误 / Fake-IP | HTTPS-only compatibility fallback，错误 code 保留 |
| 18 | timeout | `FETCH_TIMEOUT`，不裸露成 AbortError |
| 19 | Content-Length / stream 超上限 | `RESPONSE_TOO_LARGE` |
| 20 | 重定向到 localhost/private | 每跳重验，继续阻断 SSRF |
| 21 | 大 JS shell + empty root | `CLIENT_RENDER_CONTENT_MISSING`, stage=`RENDER` |
| 22 | 很短但合法静态 HTML | 不因“内容短”误杀成 shell |
| 23 | main/article + 巨量 nav/footer | 优先正文并移除常见 UI chrome |
| 24 | sidebar/menu/toolbar wrapper | 清洗掉 UI，保留 article |
| 25 | `rel=next` 同源分页 | 允许安全追页 |
| 26 | “下一页” `_2.html` / `?page=2` | 同文章 family 时允许 |
| 27 | 跨域 `rel=next` | 拒绝 |
| 28 | 普通 Next 指向另一篇文章 | 无 `rel=next` 且 family 不同则拒绝 |
| 29 | self-link / fragment / redirect loop | visited/self 检查阻止循环 |
| 30 | 无限分页 | 最多 8 页 + 总 12 MiB + 每后页 3 MiB |
| 31 | 第 3 页开始 403/超时 | 保留前 2 页，标记 PARTIAL |
| 32 | 泛化 browser fallback 到任意网页 | 明确拒绝默认实现，避免携带登录 Cookie 读私有 DOM |
| 33 | WorkBuddy fallback 越界 | 仍固定官方静态域名 |
| 34 | ChatGPT Share fallback 越界 | 仍固定 `https://chatgpt.com/share/<id>` |
| 35 | 上游 FETCH/AUTH/RENDER 错误到 content script | `errorStage/errorCode` 保留，不重新包装成 HANDOFF |
| 36 | 本地附件入口/发送失败 | 才归 `HANDOFF`，不与上游失败混淆 |
| 37 | ChatGPT / DeepSeek 目标分流 | 保留 V0.3.1 已验证策略 |
| 38 | 相似域名伪装 ChatGPT | 既有 host 边界继续阻断 |
| 39 | 恶意外部 prompt 文本 | 仍以“不可信数据”包装，不提升为指令 |
| 40 | ChatGPT share prototype pollution / base64 膨胀 / mapping cycle | V0.3 既有安全回归继续通过 |

## 首轮发现并修正

### Finding A — textual MIME could still override binary bytes

问题：初版 classifier 对已声明 `text/html` / `application/json` 的响应过于信任，极端情况下二进制仍可能进入文本路径。

修复：任何声明为文本类的 MIME 都必须先通过 `looksLikeTextBytes()`。字节明显二进制时直接返回 `binary`，magic header 仍优先。

### Finding B — old tests encoded old implementation, not behavior

4 个旧测试绑定了 V0.3.1 的具体字符串：裸 AbortError、旧 `sourceKind` 调用表达式、固定 `handoff-error` stage、固定 `direct-failed/error` progress literal。

修复：测试改为验证 V0.4 真正契约：结构化 timeout、真实 sender host + 分类后 sourceKind、stage-aware errors、typed progress metadata。

## 明确不宣称解决的边界

- 403：现在准确分类，不代表一定能获得被 CDN/站点拒绝的资源；
- 401：准确提示需要认证，不绕过登录/付费墙；
- CAPTCHA / Cloudflare / DRM：不绕过；
- client-only SPA：能检测 shell，但默认不会偷用浏览器已登录 Cookie 做通用 DOM fallback；
- 正文抽取：已增强，但仍是零依赖轻量 extractor，不宣称等价于 Mozilla Readability / Defuddle / Trafilatura；
- 分页：只处理安全、明确、同源的文章分页，不做无限滚动或跨站爬虫。

## Reviewer verdict gate

只有最终 CI 全绿且 PR head 未变化时，才允许从 Draft 转 Ready 并 merge。真实网站行为继续由浏览器实机测试作为下一层证据。
