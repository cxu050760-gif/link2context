# Security / 安全说明

## 中文

Link2Context 运行在用户自己的浏览器扩展上下文中，并拥有 `http://*/*` 与 `https://*/*` 主机权限，才能替用户抓取公开链接。这是强权限，因此项目尽量把能力限制为“用户手动输入 URL 后执行”，不提供远程可调用的任意 URL 代理。

当前保护包括：HTTP(S) only、显式阻止常见私网/localhost/metadata 目标、每跳 redirect 重新校验、12 MiB 响应上限、25 秒超时、敏感查询参数显示脱敏，以及外部内容“不可信数据”标记。

已知限制：浏览器扩展无法像受控后端一样在 DNS 解析完成后可靠检查最终 IP，因此无法宣称完全防御 DNS rebinding。不要把本扩展包装成任何网页都能静默调用的远程接口。

发现漏洞时，请不要在公开 issue 中粘贴真实密钥、token、私有 URL 或敏感数据。可以先提交不含敏感值的最小复现描述。

## English

Link2Context runs in the user's browser extension context and requires `http://*/*` and `https://*/*` host permissions to fetch public links on the user's behalf. That is a powerful permission, so the project intentionally keeps execution user-initiated and does not expose a remotely callable arbitrary-URL proxy.

Current protections include HTTP(S)-only validation, explicit blocking of common private/localhost/metadata targets, redirect re-validation on every hop, a 12 MiB response cap, a 25-second timeout, redaction of likely credential query parameters in displayed source URLs, and an "untrusted external data" marker in generated context.

Known limitation: a browser extension cannot reliably perform the same post-DNS final-IP checks as a controlled backend service, so complete DNS-rebinding protection is not claimed. Do not wrap this extension in a remotely callable interface that arbitrary web pages can invoke silently.

When reporting a vulnerability, do not paste real secrets, tokens, private URLs, or sensitive data into a public issue. Start with a minimal reproduction that contains no sensitive values.
