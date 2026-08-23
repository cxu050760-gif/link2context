# Link2Context Project Status / 项目阶段状态

> **阶段性收尾日期：2026-08-23。** 项目暂时停止继续扩功能。`main` 目前仍是 **V0.6.0**；PR #12 的 **V0.6.1** 作为安全/可靠性加固候选保留为 Draft（草稿），暂不合并，直到以后重新做真实浏览器回归。

## 现在应该用哪个版本？

### 1. 只追求“已经真实用过、证明确实能工作”

优先看 **V0.5.3 的千问路径**。

V0.5.3 在 `www.qianwen.com` 上有真实浏览器证据：

- CDP `Input.insertText` 写入后，文本处于真实编辑器状态；
- 文本可正常编辑、删除；
- 千问 Auto-send（自动发送）真实 PASS；
- PDF / 图片 / 其他原始二进制继续作为原文件附件处理。

因此，**目前最可靠的已验证基线不是“所有平台的 V0.5.3”，而是“V0.5.3 + 千问”这一条路径。**

### 2. 想用当前 `main` 的结构化网页能力

当前 `main` 是 **V0.6.0**。

V0.6.0 的自动化、结构化 Context Model、Readability、图文提取、分页身份、有限渲染等代码已经完成并曾通过 **322 / 322** 自动化测试及 GitHub Actions CI；但是 V0.6.0 合并后没有把 ChatGPT / DeepSeek / 豆包 / 千问的真实网页交付矩阵重新全部跑一遍。

所以它的准确状态是：

> **CODE PASS / LIVE UNVERIFIED（代码验证通过 / 真实网页未完整验证）**

使用 V0.6.0 时建议保持默认 **Manual review（手动确认发送）**，不要把未实测的 Auto-send 当成稳定能力。

### 3. 想看目前代码层面最严格的版本

PR #12 的 **V0.6.1** 是 V0.6.0 的 hardening candidate（加固候选）。

本轮完成额外安全/可靠性攻击和修复后，实现提交 `8f413c262ad7cbff16b367b663eebf65a8ee3b8a` 已通过：

- `npm run check`: PASS
- `npm test`: **350 / 350 PASS**
- GitHub Actions CI **#515**: SUCCESS

V0.6.1 加固了 trailing-dot localhost / metadata alias、HTTP 206 完整性、授权浏览器 origin pinning、credentialed redirect、STOP job identity、附件 input/accept/disabled 边界、同名附件假证据、重复发送副作用、legacy fallback 等问题。

但是：**V0.6.1 没有完成新的四平台真实浏览器验收。** 因此它只能叫“自动化通过的加固候选”，不能叫“全平台稳定版”。

## 版本状态总表

| Version | 仓库状态 | 自动化状态 | 真实浏览器状态 | 当前建议 |
| --- | --- | --- | --- | --- |
| **V0.5.3** | 已历史合并 | PASS | **千问核心路径 PASS**；ChatGPT / DeepSeek / 豆包 Auto-send 已知 FAIL | **需要已证明可用的千问路径时，优先作为基线** |
| **V0.6.0** | **当前 `main`** | **322 / 322 PASS；CI SUCCESS** | 四个主要目标的 V0.6 live matrix 未重新完整验证 | 可用于继续测试结构化能力；默认手动确认，不称全平台稳定 |
| **V0.6.1** | PR #12 Draft，未合并 | **350 / 350 PASS；CI #515 SUCCESS**（实现收口点） | V0.6.1 live matrix 仍未重新验证 | **代码层面最严格的候选；暂不作为已验证稳定发行版** |
| V0.5.2 | PR #9 未合并，已被取代 | 历史能力被后续版本继承 | 不再作为推荐基线 | 不建议继续使用 |

## 已经有真实证据的能力

| Version / Target | Capability | Verdict |
| --- | --- | --- |
| V0.5.3 / 千问 | 文本进入真实编辑器状态 | **PASS** |
| V0.5.3 / 千问 | 文本可编辑、可删除 | **PASS** |
| V0.5.3 / 千问 | Auto-send | **PASS** |
| V0.5.3 / generic HTML | 普通正文文本提取 | **PASS / PARTIAL**；纯文本/Markdown 路径会丢正文图片，因此不能叫完整图文上下文 |

## 已知不稳定 / 已知失败

| Version / Target | Capability | Verdict / 说明 |
| --- | --- | --- |
| V0.5.3 / ChatGPT | Auto-send | **FAIL / 不可靠** |
| V0.5.3 / DeepSeek | Auto-send | **FAIL** |
| V0.5.3 / 豆包 | Auto-send | **FAIL** |
| 任意版本 / 任意站点 | 第三方网页 DOM、编辑器、附件控件 | **可能随网站更新漂移**，不能从 CI 推导永久兼容 |
| V0.6.x | 任意 SPA 无限滚动 / 任意“加载更多” | **不保证全网通吃** |
| V0.6.x | 音视频内容理解 | **未实现**；只保留/交付原文件 |

## V0.6 / V0.6.1 目前没有真实验证的项目

在新的候选版本上，下面这些能力没有新的 live PASS 证据，因此统一保持 `UNVERIFIED`：

- ChatGPT：Manual text / editable state / mixed text + images / original binary / Auto-send / STOP；
- DeepSeek：同上；
- 豆包：同上；
- 千问 V0.6/V0.6.1：结构化交付、图文混合、原始文件、Auto-send、STOP 都需要重新回归；
- V0.5.3 的千问 PASS **不能自动继承成 V0.6/V0.6.1 PASS**。

完整矩阵见 [`V0.6-LIVE-EVIDENCE.md`](./V0.6-LIVE-EVIDENCE.md)。

## 为什么 PR #12 暂时不合并

不是因为当前还有已知自动化 blocker。实现收口点已经 350 / 350 全绿。

暂不合并的原因是：

1. 这次目标是阶段性收尾，而不是继续滚动开发；
2. V0.6.1 修改了多条网页交付、附件、浏览器授权和 legacy fallback 安全链；
3. 第三方网页兼容性只能通过真实浏览器证明，不能靠单元测试冒充；
4. 保持 Draft 能让未来重新开始时清楚看到“代码已加固，但 live gate 未完成”。

## 以后重新启动项目时，先做什么？

不要先继续扩功能。先完成最小真实回归矩阵：

1. ChatGPT / DeepSeek / 豆包 / 千问：普通网页 Manual text 各 1 次真实 PASS；
2. 千问：再次确认文本可编辑/删除；
3. 至少 1 个真实图文网页：正文 + 关键图片共同交付；
4. 至少 1 个 PDF / 图片原文件附件回归；
5. STOP 分别在抓取、渲染/等待、附件/交付、发送等待阶段验证；
6. Auto-send 每个平台单独验证，未 PASS 的继续 fail-closed，不阻塞手动模式。

完成这些后，再决定是否把 V0.6.1 从 Draft 提升为 Ready for Review / merge。

## 状态原则

后续任何人接手本项目时，请继续遵守：

> **CI PASS ≠ Live PASS。历史 PASS ≠ 新版本 PASS。没有真实证据就写 UNVERIFIED；已知失败就明确写 FAIL；不要为了“看起来完成”把未验证能力写成稳定。**
