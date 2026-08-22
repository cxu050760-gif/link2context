# Link2Context V0.2 — 15-round adversarial review / 15 轮攻击式自审

目标 / Target: **URL-only message in a web AI → local fetch → normalization/attachment → same composer → send**, with no manual download/copy/upload in the normal path. / **网页 AI 里只发链接 → 本机抓取 → 整理/附件 → 回填同一输入框 → 发送**。

## Round 1 — hostile attachment filenames / 恶意附件文件名

- Attack: a filename made only of control/illegal characters.
- Found: sanitization could leave a meaningless `-`.
- Fix: require a usable alphanumeric/Unicode filename or fall back to `download.bin`.
- Regression: `auto-bridge.test.js`.

## Round 2 — SSRF alternate IP forms / SSRF 另类 IP 写法

- Attack: IPv4-mapped IPv6 plus CGNAT/benchmark/documentation ranges.
- Found: earlier literal checks missed several special ranges.
- Fix: expanded IPv4/IPv6 blocking, including mapped IPv6 fail-closed handling.
- Regression: `security-v02.test.js`.

## Round 3 — first-paste race / 页面刚打开立刻粘贴

- Attack: paste a URL immediately before background site-status returns.
- Found: first paste could be missed.
- Fix: built-in AI hosts enable synchronously; background status remains a second check.
- Regression: `security-v02.test.js`.

## Round 4 — rich editor destruction / 富文本编辑器结构破坏

- Attack: ProseMirror/Lexical/contenteditable composer.
- Found: replacing children could destroy editor-owned DOM structure.
- Fix: preserve the editor root and use native/range text insertion plus input events.
- Regression: `security-v02.test.js`.

## Round 5 — wrong file input / 传到错误附件入口

- Attack: a page with avatar upload plus chat attachment input.
- Found: document-wide first-match selection could target the wrong file input.
- Fix: scope near the chat editor first and honor the input `accept` rules.
- Regression: `auto-bridge.test.js`.

## Round 6 — non-chat input interception / 误伤搜索框或设置框

- Attack: URL pasted into an AI site's unrelated single-line input.
- Found: URL-only logic alone was too broad.
- Fix: single-line fields require a nearby Send-like control; rich chat composers remain supported.
- Regression: `security-v02.test.js`.

## Round 7 — huge context / 超长上下文

- Attack: hundreds of thousands of characters returned from a URL.
- Found: direct injection can exceed or destabilize a web-AI composer.
- Fix: payloads over the editor threshold become a Markdown attachment automatically.
- Regression: `auto-bridge.test.js`, `security-v02.test.js`.

## Round 8 — DNS rebinding layer / DNS rebinding 第二道防线

- Attack: public-looking hostname resolving toward local/private address space.
- Fix: keep literal URL/range/redirect checks and additionally request `targetAddressSpace: public` where Chromium enforces it.
- Regression: `fetch-url.test.js`.
- Note: no claim of universal perfect DNS-rebinding defense.

## Round 9 — false send success / 假发送成功

- Attack: `.click()` runs but target AI ignores the synthetic submit.
- Found: programmatic click alone is not proof that the message was sent.
- Fix: verify that the composer cleared/changed/was replaced; try `requestSubmit`; otherwise report prepared-but-not-sent.
- Regression: `security-v02.test.js`.

## Round 10 — attachment upload race / 附件上传抢跑

- Attack: large binary attached and auto-send attempted immediately.
- Found: fixed delay was not enough evidence that the AI page registered the file.
- Fix: wait for attachment registration before submit.
- Regression: `security-v02.test.js`.

## Round 11 — ARIA-disabled submitter / 逻辑禁用发送按钮

- Attack: user clicks a button with `aria-disabled="true"` while fetch is in progress.
- Found: remembered submitter originally checked only the DOM `disabled` property.
- Fix: remembered submitter now also respects `aria-disabled`.
- Regression: `security-v02.test.js`.

## Round 12 — extension message ceiling / 扩展消息大小上限

- Attack: worst-case 12 MiB binary becomes roughly 16 MiB Base64 in runtime messaging.
- Result: PASS. Chromium's extension message limit is 64 MiB, leaving substantial headroom under Link2Context's 12 MiB fetch cap.
- Change: none; do not add needless chunking complexity.

## Round 13 — attachment confirmation ignored / 附件确认结果被忽略

- Attack: target AI never shows/registers the selected attachment.
- Found: the wait function's `false` result was previously ignored, allowing later auto-send.
- Fix: extend confirmation window and fail closed; no auto-send if attachment registration is not confirmed.
- Regression: `security-v02.test.js`.

## Round 14 — real Chromium DOM flow / 真实 Chromium 输入发送链

- Attack: real Chromium DOM, real keyboard events, textarea + Send button, with only the network result stubbed because the execution environment blocks ordinary websites by enterprise policy.
- Result: PASS. Typing a URL and pressing Enter caused the composer to send the transformed marker `LINK2CONTEXT_DOM_E2E_OK`, not the original URL.
- Change: no production change required.

## Round 15 — malicious page abusing the fetch bridge / 恶意网页借扩展抓任意 URL

- Attack: ordinary page attempts to invoke or spoof the extension bridge.
- Result: PASS after layered gates: no `externally_connectable`, no page `postMessage` bridge, trusted browser events required, sender host/top-frame checked again in background.
- Regression: `security-v02.test.js`.

## Final local gate / 最终本地门禁

Run / 执行：

```bash
npm test
npm run check
```

All V0.2 attack findings above are either fixed with regression coverage or explicitly recorded as PASS/known boundary. / 上述发现均已修复并补回归，或明确记录为 PASS/边界。
