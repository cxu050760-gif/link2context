# V0.2.3 攻击式自审 / Adversarial Review

本轮只审 V0.2.3 新增的“可见进度”能力，不重复冒充此前 V0.2/V0.2.2 的安全审查。

1. **真实阶段而非假动画** — PASS：阶段由 background 实际执行路径上报。
2. **长等待可见** — PASS：面板每秒显示总耗时；WorkBuddy 后台标签页等待每约 2 秒刷新状态与剩余超时窗口。
3. **直接抓取重试不可见** — PASS：`fetch-url.js` 上报 retry。
4. **Fake-IP / HTTPS 兼容重试不可见** — PASS：兼容回退单独显示。
5. **WorkBuddy 浏览器回退不可见** — PASS：打开、等待、提取、成功分别显示。
6. **失败后错误瞬间消失** — PASS：error 状态保留，直到用户关闭。
7. **成功面板永久挡住网页** — PASS：成功约 7 秒后自动移除。
8. **页面 CSS 污染/覆盖面板** — PASS：使用 Shadow DOM 隔离样式，并使用顶层固定定位。
9. **错误文本造成 HTML/XSS 注入** — PASS：阶段、详情、日志均通过 `textContent` 写入。
10. **进度上报异常反过来打断抓取** — PASS：`tabs.sendMessage` 和 `onProgress` 均 fail-soft；进度仅为可观察性。
11. **上一任务日志混入下一任务** — FIXED：新 `start` 会清空历史并重新计时。
12. **旧任务迟到消息覆盖新任务** — FIXED：按 `startedAt` 隔离，只接受当前任务状态。
13. **用户手动关闭后同一任务下一条进度又弹回来** — FIXED：关闭后抑制当前任务；下一条新任务重新启用。
14. **日志无限增长拖慢网页** — PASS：最多保留最近 7 条阶段记录。

结论：本轮发现 3 个进度 UI 状态管理问题，其中 3 个已修复并增加/扩展回归覆盖；无剩余阻断项。

---

## English summary

V0.2.3 received 14 focused adversarial checks covering real-stage telemetry, long waits, retry visibility, WorkBuddy browser fallback, persistent errors, auto-hide behavior, Shadow DOM isolation, text-only rendering, fail-soft telemetry, cross-job log/state contamination, close behavior, and bounded history. Three state-management issues were found and fixed; no blocking issue remains.
