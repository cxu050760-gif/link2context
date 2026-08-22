# Changelog / 变更记录

## V0.5.3 — 2026-08-22

状态：已合并到 `main`（PR #10）。

### 主要修复

- 中国千问 `qianwen.com` / `www.qianwen.com` / `qwenwork.cn` 改用 `chrome.debugger` + CDP（Chrome DevTools Protocol，Chrome 调试协议）真实输入路径。
- 文本交付使用 `Input.insertText`，解决“DOM 看得到但不可正常编辑/实际发送状态没有内容”的真实回归。
- 千问自动发送使用 `Input.dispatchKeyEvent` 发送真实 Enter，不再依赖不稳定的发送按钮 DOM。
- 自动发送继续采用 fail-closed（失败时不假装成功）语义：必须取得独立的发送后页面证据，否则返回 `SEND_UNCONFIRMED`。
- STOP 扩展为端到端取消：覆盖网络读取、分页、附件等待、编辑器交付和自动发送等待。
- 分页识别扩展到 `rel=next`、数字分页、`data-url` / `data-page`、同源 `onclick location` 等，同时保留同源、同文章 URL family、最多 8 页和总大小限制。
- PDF、图片及其他原始二进制继续保持原文件附件。

### 安全变化

- manifest 新增 `debugger` 权限。
- 调试输入仅允许顶层 `qianwen.com` / `qwenwork.cn` 页面。
- 仅开放 `insertText` 与 `pressEnter` 两类内部动作。
- 每次调试操作临时 attach，结束后立即 detach。
- 已被 DevTools 或其他调试器占用的标签页会明确失败，不抢占。
- 不新增 `Runtime.evaluate`、debugger Network 捕获、Cookie/Local Storage/凭据读取能力。

### 验证

- `npm run check`：PASS（通过）。
- `npm test`：292 / 292 PASS（全部通过）。
- GitHub Actions CI（持续集成）：SUCCESS（成功）。
- `www.qianwen.com` 核心文本交付真实浏览器回归：PASS；提取文本可正常编辑、删除。

### 已知边界

- 任意 SPA（单页应用）无限滚动或“加载更多”不是通用保证。
- 千问真实输入依赖 Chrome `debugger` 权限；同一标签页被其他调试器占用时可能返回 `QIANWEN_DEBUGGER_BUSY`。
- 第三方网页 AI 的 DOM / 编辑器 / 发送机制未来变化仍可能需要重新适配。

---

## V0.5.2

V0.5.2 的授权浏览器上下文、资源分类、二进制附件、安全 URL 校验等能力已被 V0.5.3 保留；V0.5.2 PR #9 未合并，后续由 V0.5.3 取代。
