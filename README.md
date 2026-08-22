# Link2Context

> 把链接变成可直接交给网页 AI 使用的干净上下文。 / Turn links into clean, AI-ready context for any web AI.

Link2Context 是一个浏览器扩展实验项目：当你在 ChatGPT、DeepSeek、豆包、千问等网页 AI 中粘贴一个 URL 时，它会尝试在本地完成抓取、类型识别、清洗、分页、必要时的浏览器上下文回退，并把结果交给当前网页 AI。

当前测试分支版本：**0.5.1**。

## V0.5.1 真实环境修正

- **交付形式可选**：智能 / Markdown 文档 / 长文本。
- **发送行为可选**：手动确认（默认、推荐）/ 自动发送。
  - 手动确认：处理完成后停在输入框，用户检查后再点一次发送。
  - 自动发送：只有用户原本用 Enter 或发送按钮提交链接时，处理成功后才继续自动发送。
  - 单纯粘贴 URL 永远不会立即自动发送，避免测试时误发。
- **附件确认容错**：网页 AI 把附件文件名显示成 `workbuddy.link-8yp…` 这种截断形式时，不再因为看不到完整文件名而误报上传失败。
- **千问附件入口增强**：当附件入口藏在 `+ / 更多` 菜单后时，会优先寻找“文件/附件”动作，而不是把图片上传入口误当成文档入口。
- **千问富文本保护**：继续避免直接改 DOM 导致“看着有字、内部状态没更新、发送按钮灰掉”的问题；安全事件路径不被接受时 fail closed（安全失败）。

## V0.5 主要能力

- 通用 URL 安全校验与来源路由。
- WorkBuddy / ChatGPT Share / 通用网页内容解析。
- HTML → Markdown、JSON / 纯文本归一化。
- 分页发现：`rel=next`、下一页文本、aria/title/class、数字分页等。
- 401 / 403 或 JS 空壳页面在用户明确授权后，可尝试 Authorized Browser Context（授权浏览器上下文）回退。
- 不读取或保存 Cookie 值，不申请 `chrome.cookies`。
- host deny list（站点排除列表）与全局撤销。
- 真实 STOP / AbortSignal 取消链。
- PDF / 图片 / 压缩包等原始二进制保持文件交付，不伪装成长文本。

## 开发与测试

```bash
npm test
npm run check
```

当前 V0.5.1 额外加入了针对以下问题的攻击式回归检查：发送偏好 fail-safe、误自动发送、附件文件名截断、短名称误判、千问 `+ / 更多` 菜单、图片入口误选、禁用发送按钮强行启用、手动模式误报失败等。

## 安全边界

- 只处理 HTTP(S) URL。
- 未授权时不使用登录态浏览器上下文。
- 不直接读取或持久化 Cookie 值。
- 最终 URL 仍重新经过 public HTTP(S) 校验。
- 登录墙、付费墙、验证码无法通过时明确失败，不伪装成成功。
- 不强行移除网页发送按钮的 `disabled / aria-disabled` 状态。

## 当前状态

V0.5.1 仍位于 `feat/v0.5-authorized-browser-router` 测试分支和 PR #9，**尚未合并 main**。真实网页验收完成前保持 Draft。

## License

MIT
