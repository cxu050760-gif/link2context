# Link2Context

English | [中文](./README.md)

**Give a web AI one URL. Link2Context tries to acquire the real information completely, preserve structure, key images, and original files, then hand it to the current AI in a form that target can accept. Anything partial, unsupported, or unverified is surfaced explicitly instead of being silently dropped.**

> Current development candidate: **V0.6.1 — Structured Context Bridge hardening patch**. V0.6 feature scope remains frozen; V0.6.1 is limited to adversarial hardening and regression fixes. See [`docs/PROJECT-STATUS.md`](./docs/PROJECT-STATUS.md) and `docs/V0.6-LIVE-EVIDENCE.md` for the difference between code status and live-browser status.

## Which version is actually usable?

The project was **temporarily closed out on 2026-08-23**. A green automated suite must not be interpreted as “all web-AI targets are stable.”

| Version | Repository status | Live-use truth |
| --- | --- | --- |
| **V0.5.3** | Historical merged baseline | **Qianwen (`www.qianwen.com`) is the clearest proven working path**: real editor state, editable/deletable text, and Auto-send passed live-browser testing. ChatGPT / DeepSeek / Doubao Auto-send are known FAIL / unreliable in this version. |
| **V0.6.0** | **Current `main`** | Automated suite **322 / 322 PASS; CI SUCCESS**. Structured features are implemented, but the V0.6 live matrix for ChatGPT / DeepSeek / Doubao / Qianwen was not fully rerun. Status: **CODE PASS / LIVE UNVERIFIED**, not “cross-platform stable.” |
| **V0.6.1** | **PR #12 Draft, unmerged** | The most hardened code candidate. The implementation closeout point passed **350 / 350 tests and CI #515**. It still lacks a new four-target live-browser gate, so it remains **LIVE UNVERIFIED** and is not labeled a stable release. |
| V0.5.2 | PR #9 unmerged and superseded | Not recommended. |

**If you need the path that has actually been proven in a real browser, use V0.5.3 + Qianwen as the baseline.**

**If you use current `main` (V0.6.0), keep Manual review as the default and treat Auto-send / target UI compatibility as needing fresh live verification.**

See [Project Status](./docs/PROJECT-STATUS.md) for the complete matrix, known failures, unverified capabilities, and restart checklist.

## V0.6 highlights

- **Structured canonical state:** headings, paragraphs, lists, quotes, code, tables, links, images, attachments, and provenance are preserved in a Context Model. Markdown is an output format, not the canonical state.
- **Mozilla Readability reuse:** article extraction uses a pinned Readability build plus a structured DOM walker instead of continuing to grow regex-only extraction.
- **Real mixed-media handling:** `src`, `srcset`, common lazy-image attributes, captions, deduplication, noise filtering, actual MIME validation, and bounded image downloads are supported. Failed media becomes explicit partial state and disables auto-send.
- **Safer pagination:** Article Identity and deduplication prevent a “next article” from being silently merged into the current document.
- **Bounded rendered acquisition:** after explicit Authorized Browser Context permission, Link2Context may wait for main content, DOM settling, limited scrolling, and limited load-more actions under timeout/size/cancellation limits.
- **Better legacy encodings:** BOM → HTTP charset → document declaration → UTF-8 validity → bounded fallback, with charset source/confidence recorded.
- **Target-aware delivery:** ChatGPT, DeepSeek, Doubao, and Qianwen have dedicated Target Profiles. Manual handoff and auto-send are separate capabilities; missing live evidence stays `UNVERIFIED`.
- **Proven behavior is retained rather than rewritten:** Qianwen keeps the V0.5.3 CDP `Input.insertText` + real Enter path. PDFs, images, Office files, archives, audio/video, and unknown binary resources remain original-file attachments.
- **V0.6.1 adversarial hardening:** hardens network address-space handling, redirects, debugger TOCTOU, STOP job identity, attachment-input isolation, partial-state propagation, pagination identity, URL-secret redaction, parser resource limits, trailing-dot local/metadata aliases, unexpected HTTP 206, authorized-origin pinning, legacy cancellation, and attachment fallback behavior.

## How it works

1. Paste a single `http://` or `https://` URL into a supported web-AI composer.
2. Link2Context safely acquires and classifies the resource.
3. HTML becomes structured text plus bounded key-image assets when possible; original binary resources remain files.
4. Delivery is planned for the current AI as inline text, Markdown document, attachment, or mixed media.
5. Manual review is the default. Auto-send runs only when explicitly enabled.
6. Partial / unsupported / unverified states are shown explicitly instead of being called success.

```text
URL/resource
  → safe acquisition
  → type-aware decoding
  → structured context + original assets
  → target-aware delivery
  → explicit completeness/evidence state
```

## Security boundaries

- HTTP / HTTPS only; embedded URL credentials are rejected.
- localhost, private/link-local/special-purpose address space, cloud metadata targets, and equivalent trailing-dot host aliases are blocked.
- Network redirect targets are revalidated. Authorized rendered navigation also rechecks authorization, the host deny-list, and the originally authorized origin.
- Credentialed binary re-fetch inside an authorized browser tab does not follow redirects automatically.
- Automatic load-more actions are bounded; cross-origin anchors and form/submit controls are not auto-clicked.
- Ordinary fetching is unauthenticated by default. Authorized Browser Context is explicit opt-in, revocable, and deny-listable by host.
- Link2Context does not directly read Cookie values with `chrome.cookies`, and does not bypass login walls, CAPTCHAs, paywalls, DRM, or site access control.
- External page content is `untrusted-external` data, never promoted to system/user instructions.
- File handoff respects the site's `<input type="file" accept=...>` contract. Attachment proof is scoped to the active composer so unrelated page text cannot fake success.
- Disabled / `aria-disabled` controls are never force-enabled.
- `debugger` is not exposed as a generic automation interface. Qianwen's fixed input actions are restricted to supported HTTPS hosts; other targets can use only a bounded Enter fallback on fixed HTTPS AI hosts when Auto-send is explicitly enabled.
- Auto-send requires independent post-send evidence or returns `SEND_UNCONFIRMED`; an unconfirmed first side effect is not followed by a second send strategy.
- STOP keeps one `startedAt` job identity across V0.6 and legacy fallback paths so stale cancellation cannot kill a newer job and UI STOP cannot silently leave the background job running.

See [SECURITY.md](./SECURITY.md).

## Built-in web-AI targets

ChatGPT, Claude, Gemini / Google AI Studio, Grok, Perplexity, DeepSeek, Doubao, Kimi, Qwen / Tongyi, Poe, Microsoft Copilot, Mistral Chat, and OpenRouter.

V0.6 maintains dedicated Target Profiles for ChatGPT, DeepSeek, Doubao, and Qianwen. Other targets continue to use the generic safe path or explicit per-site enablement.

**A built-in target means code has a target profile/route; it does not mean the current version has a live PASS.**

## Install (Chrome / Edge)

1. Download or clone the repository.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable Developer mode.
4. Choose **Load unpacked**.
5. Select the repository's `extension` directory.
6. Current `main` is V0.6.0. Reload the extension after updates and refresh already-open AI pages. To test V0.6.1, explicitly use PR #12's branch; do not treat it as an already-merged stable release.

## Tests and evidence

```bash
npm test
npm run check
```

At project closeout:

- V0.6.0 (`main`) historical automation: **322 / 322 PASS**, GitHub Actions CI SUCCESS.
- V0.6.1 implementation closeout point: **350 / 350 PASS**, GitHub Actions **CI #515 SUCCESS**.
- **Green CI is not live-browser proof and does not imply permanent third-party compatibility.**

Historical live baseline: V0.5.3 passed Qianwen's core text input/edit/delete and Auto-send. V0.5.3 also has real FAIL evidence for ChatGPT / DeepSeek / Doubao Auto-send. A V0.6 / V0.6.1 capability that has not been retested remains `UNVERIFIED` rather than inheriting PASS automatically.

See:

- [Project Status](./docs/PROJECT-STATUS.md)
- [V0.6 Design](./docs/V0.6-DESIGN.md)
- [V0.6 Scope Freeze](./docs/V0.6-SCOPE-FREEZE.md)
- [V0.6 Live Evidence](./docs/V0.6-LIVE-EVIDENCE.md)
- [V0.6.1 Hardening](./docs/V0.6.1-HARDENING.md)
- [Changelog](./CHANGELOG.md)

## Known boundaries

- Arbitrary SPA infinite scroll / load-more flows are not a universal guarantee.
- V0.6 does not automatically understand audio/video content itself; it preserves and hands off the original file.
- Third-party editors, attachment flows, and send mechanisms can drift. Real blocker/regression fixes are allowed when observed.
- V0.5.3 Qianwen PASS does not automatically become V0.6/V0.6.1 PASS.
- **V0.6 feature scope remains frozen; V0.6.1 is restricted to security, correctness, reliability, and state-truth fixes.**

## License

MIT
