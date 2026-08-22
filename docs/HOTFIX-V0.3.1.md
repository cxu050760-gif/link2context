# Link2Context V0.3.1 — Target-aware handoff / 目标 AI 感知交付

## 中文

### 真实现象

实机出现了一个非常有价值的不对称：

| 来源 | DeepSeek | ChatGPT |
| --- | --- | --- |
| ChatGPT 分享链接 | 正常 | 正常，通常走 Markdown 附件 |
| WorkBuddy 分享链接 | 正常，直接文本 | 会长时间卡在输入框交付阶段 |

这说明 WorkBuddy 的抓取和解析本身并没有坏；真正不稳定的是**同一份干净上下文如何交给不同网页 AI**。

### 根因方向

V0.3.0 只有一个近似全局策略：最终 payload 超过 `MAX_EDITOR_PAYLOAD_CHARS` 才转 Markdown 附件，否则直接把大段文本程序化写进网页编辑器。

DeepSeek 的编辑器对这种直接文本交付较宽容；ChatGPT 使用富文本/contenteditable/React 编辑器，程序化灌入整段对话的可靠性明显较差。于是同一个 WorkBuddy 上下文在 DeepSeek 成功，在 ChatGPT 可能卡住。

### V0.3.1 修复

加入 `planContextHandoff()`（交付策略规划器），把“来源是什么”和“目标 AI 是谁”一起纳入决策：

- **目标是 ChatGPT + 来源是 WorkBuddy / ChatGPT 分享对话**：统一优先生成干净 Markdown 附件；
- **目标是 ChatGPT + 普通内容达到 24,000 字符**：优先附件，避免大型程序化富文本注入；
- **DeepSeek / 其他目标**：保留原来的 250,000 字符全局硬阈值，因此当前已经稳定工作的 WorkBuddy → DeepSeek 直接文本行为不会被破坏；
- 二进制文件继续直接走附件；
- 不做“附件失败后悄悄退回超长文本注入”的 fail-open（失败放行），附件登记失败仍明确停止自动发送。

### 可观测性

进度面板新增 `handoff-plan` 阶段，会显示：

```text
目标 / Target: chatgpt.com
来源 / Source: workbuddy
大小 / Size: 18342 chars
方式 / Mode: Markdown 附件 / Markdown attachment
原因 / Reason: chatgpt-conversation-file-first
```

后台返回值也携带 `handoffMode`、`handoffReason` 和 `targetHost`，方便继续定位真实网页兼容问题。

### 攻击式自检

新增回归覆盖至少以下 14 个边界：

1. ChatGPT + WorkBuddy 短对话也走附件；
2. ChatGPT + ChatGPT Share 使用相同附件路径；
3. ChatGPT 子域继承策略；
4. 大小写和尾点域名规范化；
5. `evilchatgpt.com` 等相似域名不能误命中；
6. DeepSeek + WorkBuddy 保持文本；
7. DeepSeek + ChatGPT Share 保持文本；
8. ChatGPT 普通短内容保持文本；
9. ChatGPT 普通内容达到软阈值转附件；
10. 非 ChatGPT 目标保留全局硬阈值；
11. 负数/NaN 大小不能扰乱策略；
12. 后台必须把真实 sender host 传给策略层；
13. 进度面板必须收到目标/来源/大小/模式/原因；
14. 附件与文本结果必须暴露诊断元数据。

## English

V0.3.1 fixes a real target-specific asymmetry: WorkBuddy context could be extracted and sent as inline text on DeepSeek, while the same source could stall when injected into ChatGPT's rich composer. The problem was not the WorkBuddy extractor; it was the handoff strategy.

`planContextHandoff()` now makes delivery target-aware. Conversation sources (WorkBuddy and ChatGPT public shares) are file-first when the destination is ChatGPT. Generic ChatGPT context switches to a Markdown attachment at 24,000 characters. DeepSeek and other targets retain the existing 250,000-character global threshold so already-working inline behavior is preserved.

The progress UI now receives a `handoff-plan` stage with target host, source kind, payload size, selected mode, and reason. Regression tests cover host lookalikes, subdomains, thresholds, invalid sizes, background wiring, and diagnostic metadata.
