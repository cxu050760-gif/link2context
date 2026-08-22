# V0.1 攻击式自审 / Adversarial Self-Review

本文件记录 V0.1 在提交前执行的攻击式审查。目标不是“证明代码没问题”，而是主动找能让真实用户失败、泄漏或绕过边界的问题。

This file records adversarial pre-merge review for V0.1. The goal is not to prove perfection; it is to actively find failures, leaks, bypasses, and packaging defects before release.

## 第 1 轮：URL / SSRF 边界与重定向绕过

**攻击 / Attack**

- `file:` / `data:` 等非 HTTP 协议。
- URL 内嵌账号密码。
- localhost、127/8、10/8、172.16/12、192.168/16、169.254/16、IPv6 loopback。
- 十进制/十六进制 IPv4 表示法。
- 公开 URL 302 到私网地址。
- 来源 URL 查询参数携带 token / api_key / secret。

**发现 / Finding**

初版只检查第一次输入 URL，自动跟随 redirect 会让公开地址跳转到私网目标。

The initial implementation validated only the first URL. Automatic redirects could bypass that check.

**修复 / Fix**

- 改为手动 redirect；每一跳重新执行 URL 安全校验。
- 最多 5 跳。
- 来源展示时脱敏敏感查询参数。
- 增加回归测试。

## 第 2 轮：真实 WorkBuddy 大 JSON

**攻击 / Attack**

构造 >1.5M 字符的 WorkBuddy JSON，并把主要体积放在 image base64 中，模拟真实分享记录。

Use a WorkBuddy JSON payload larger than 1.5M characters, dominated by image base64, matching real exported-chat behavior.

**发现 / Finding**

通用文本截断发生在 `JSON.parse()` 之前，会把合法大 JSON 截成残片，正好破坏项目核心场景。

The generic text cap ran before `JSON.parse()`, corrupting valid large JSON and breaking the primary use case.

**修复 / Fix**

JSON 在 12 MiB 网络上限内先完整解析，转换时丢弃图片/工具大块，最终 Markdown 再限长。

JSON is now fully parsed within the 12 MiB network cap; bulky fields are omitted during normalization; the final Markdown is capped afterward.

## 第 3 轮：真实扩展安装路径

**攻击 / Attack**

不看单元测试，直接按照 README 的方式把 `extension/` 当作 Chrome “加载已解压扩展”的根目录检查模块引用。

Treat `extension/` exactly as Chrome's unpacked-extension root and verify every imported module exists inside that root.

**发现 / Finding**

初版运行代码从 `extension/` 引用了上一级 `src/`，单测能跑，但 Chrome 实际安装会缺模块。

The initial extension imported modules outside the extension root. Unit tests passed, but Chrome unpacked installation would fail.

**修复 / Fix**

把真正运行的核心模块放入 `extension/core/`，测试直接引用同一份运行代码，并增加打包完整性测试。

Runtime modules now live under `extension/core/`; tests exercise the exact shipped files and assert the extension is self-contained.

## 第 4 轮：脏消息 / 异常时间戳

**攻击 / Attack**

给 WorkBuddy 消息注入越界时间戳。

Inject an out-of-range timestamp into a WorkBuddy message.

**发现 / Finding**

`Date.toISOString()` 会抛 `RangeError`，一条坏消息能杀死整份导出。

`Date.toISOString()` could throw, allowing one malformed message to kill the whole export.

**修复 / Fix**

增加安全时间格式化：非法时间只省略时间字段，正文继续导出。

Invalid timestamps are now omitted while the rest of the conversation remains readable.

## 第 5 轮：原文件下载旁路

**攻击 / Attack**

检查“下载原文件”是否绕过转换路径中的 redirect 校验、大小限制和超时。

Check whether the "Download original" action bypasses redirect validation, size caps, or timeouts.

**发现 / Finding**

初版把远程 URL 直接交给浏览器下载 API，绕过了受限抓取器。

The first implementation handed the remote URL directly to the downloads API, bypassing the bounded fetch path.

**修复 / Fix**

原文件也先经过同一个 `fetchBounded()`，再从本地 Blob 下载；增加静态回归测试防止以后重新旁路。

Original downloads now go through the same bounded fetch path and are saved from a local Blob. A regression assertion prevents reintroducing the bypass.

## 第 6 轮：非 UTF-8 网页

**攻击 / Attack**

模拟带 `charset=iso-8859-1` 的响应，并检查错误 charset 声明时的回退。

Test a non-UTF8 response and a bogus charset declaration.

**发现 / Finding**

初版无论响应头如何都强制 UTF-8，老网页和部分中文站会乱码。

The initial implementation forced UTF-8 and would corrupt legacy-encoded pages.

**修复 / Fix**

根据 `Content-Type` 的 charset 使用浏览器 `TextDecoder`，不支持的标签回退 UTF-8，并增加测试。

The decoder now honors supported response charsets and safely falls back to UTF-8.

## 当前结果 / Current result

提交前本地验证：

- `npm test`：27 tests passed
- `npm run check`：JavaScript syntax checks passed

Pre-commit local verification:

- `npm test`: 27 tests passed
- `npm run check`: JavaScript syntax checks passed

这不是“永久安全证明”。V0.1 仍明确保留的限制写在 README 的“当前限制 / Current limitations”中。

This is not a permanent security proof. Remaining V0.1 limitations are documented in the README.
