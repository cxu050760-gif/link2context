# Link2Context V0.2.3 可见进度 / Visible Progress

## 中文

V0.2.3 增加了网页内的常驻进度面板，解决“输入框只显示正在读取，但用户不知道程序到底在工作还是卡死”的问题。

处理链接时，页面右下角会显示：

- 当前阶段；
- 总耗时（秒）；
- 最近最多 7 条阶段历史；
- 网络重试 / HTTPS 兼容重试；
- WorkBuddy 浏览器后台标签页回退；
- 页面加载等待状态与剩余超时窗口；
- JSON / HTML / 文本解析与输出整理；
- 成功交接给网页 AI，或具体失败原因。

成功状态保留约 7 秒后自动消失。失败状态不会自动消失，用户可以阅读完整错误后手动关闭。

进度上报只是可观察性功能：即使进度 UI 自身发生异常，也不能中断真正的抓取流程。

## English

V0.2.3 adds an in-page persistent progress panel so users can tell whether Link2Context is actively fetching, retrying, using the WorkBuddy browser-navigation fallback, parsing content, or failing.

The panel shows the current stage, elapsed seconds, up to seven recent events, network/compatibility retries, WorkBuddy fallback navigation status, parsing/output stages, and the final error when a job fails.

Successful jobs keep the panel visible for about seven seconds. Failed jobs remain visible until the user closes the panel.

Progress reporting is observability-only: a progress UI/reporting failure must never break the underlying fetch pipeline.
