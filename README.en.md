# Link2Context

English | [中文](./README.md)

**Give a web AI one URL. Link2Context tries to acquire the real information completely, preserve structure, key images, and original files, then hand it to the current AI in a form that target can accept. Anything partial, unsupported, or unverified is surfaced explicitly instead of being silently dropped.**

> Current version: **V0.6.0 — Structured Context Bridge**. V0.6 is code-complete and functionally frozen. Third-party live-browser evidence is tracked separately from code completion in `docs/V0.6-LIVE-EVIDENCE.md`.

## V0.6 highlights

- **Structured canonical state:** headings, paragraphs, lists, quotes, code, tables, links, images, attachments, and provenance are preserved in a Context Model. Markdown is an output format, not the canonical state.
- **Mozilla Readability reuse:** article extraction uses a pinned Readability build plus a structured DOM walker instead of continuing to grow regex-only extraction.
- **Real mixed-media handling:** `src`, `srcset`, common lazy-image attributes, captions, deduplication, noise filtering, actual MIME validation, and bounded image downloads are supported. Failed media becomes explicit partial state and disables auto-send.
- **Safer pagination:** Article Identity and deduplication prevent a “next article” from being silently merged into the current document.
- **Bounded rendered acquisition:** after explicit Authorized Browser Context permission, Link2Context may wait for main content, DOM settling, limited scrolling, and limited load-more actions under timeout/size/cancellation limits.
- **Better legacy encodings:** BOM → HTTP charset → document declaration → UTF-8 validity → bounded fallback, with charset source/confidence recorded.
- **Target-aware delivery:** ChatGPT, DeepSeek, Doubao, and Qianwen have dedicated Target Profiles. Manual handoff and auto-send are separate capabilities; missing V0.6 live evidence stays `UNVERIFIED`.
- **Proven behavior is retained rather than rewritten:** Qianwen keeps the V0.5.3 CDP `Input.insertText` + real Enter path. PDFs, images, Office files, archives, audio/video, and unknown binary resources remain original-file attachments.

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
- localhost, private/link-local/special-purpose address space, and cloud metadata targets are blocked.
- Network redirect targets are revalidated. Authorized rendered navigation also rechecks authorization and the host deny-list.
- Automatic load-more actions are bounded; cross-origin anchor candidates are not auto-clicked.
- Ordinary fetching is unauthenticated by default. Authorized Browser Context is explicit opt-in, revocable, and deny-listable by host.
- Link2Context does not directly read Cookie values with `chrome.cookies`, and does not bypass login walls, CAPTCHAs, paywalls, DRM, or site access control.
- External page content is `untrusted-external` data, never promoted to system/user instructions.
- File handoff respects the site's `<input type="file" accept=...>` contract. An incompatible uploader fails closed instead of having its `accept` restriction removed.
- Disabled send controls are never force-enabled.
- `debugger` is not exposed as a generic automation interface. Qianwen keeps a small fixed input action set; other targets can use only a bounded Enter fallback when Auto-send is explicitly enabled.
- Auto-send requires independent post-send evidence or returns `SEND_UNCONFIRMED`.

See [SECURITY.md](./SECURITY.md).

## Built-in web-AI targets

ChatGPT, Claude, Gemini / Google AI Studio, Grok, Perplexity, DeepSeek, Doubao, Kimi, Qwen / Tongyi, Poe, Microsoft Copilot, Mistral Chat, and OpenRouter.

V0.6 maintains dedicated Target Profiles for ChatGPT, DeepSeek, Doubao, and Qianwen. Other targets continue to use the generic safe path or explicit per-site enablement.

## Install (Chrome / Edge)

1. Download or clone the repository.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable Developer mode.
4. Choose **Load unpacked**.
5. Select the repository's `extension` directory.
6. After an update, pull `main`, reload the extension, and refresh already-open AI pages.

## Tests and evidence

```bash
npm test
npm run check
```

V0.6 requires a fully green automated candidate and GitHub Actions CI. **Green CI does not mean third-party web-AI UIs are permanently compatible.**

Historical baseline: V0.5.3 live browser testing passed Qianwen's core text input/edit/delete flow and auto-send. A V0.6 capability that has not been retested on the V0.6 candidate remains `UNVERIFIED` rather than inheriting a V0.6 PASS automatically.

See:

- [V0.6 Design](./docs/V0.6-DESIGN.md)
- [V0.6 Scope Freeze](./docs/V0.6-SCOPE-FREEZE.md)
- [V0.6 Live Evidence](./docs/V0.6-LIVE-EVIDENCE.md)
- [Changelog](./CHANGELOG.md)

## Known boundaries

- Arbitrary SPA infinite scroll / load-more flows are not a universal guarantee.
- V0.6 does not automatically understand audio/video content itself; it preserves and hands off the original file.
- Third-party editors, attachment flows, and send mechanisms can drift. Real blocker/regression fixes are allowed when observed.
- **V0.6 feature development is frozen; scope is no longer expanded.**

## License

MIT
