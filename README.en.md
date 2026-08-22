# Link2Context

English | [中文](./README.md)

**Send one URL in a web-AI chat. Link2Context fetches the resource in your browser, classifies it, cleans it into AI-ready context, and hands it to the current AI.**

> Current `main` version: **V0.5.3**. PR #10 was merged on 2026-08-22. V0.5.3 focuses on real-browser handoff reliability: it removes the old V0.5.1 + V0.5.2 stacked send-state design, adds a tightly scoped `chrome.debugger` + CDP (Chrome DevTools Protocol) real-input path for Chinese Qianwen, and retains the V0.5.2 authorized-browser fallback and security boundaries.

## V0.5.3 highlights

- **Chinese Qianwen now uses real browser editing state.** `qianwen.com`, `www.qianwen.com`, and `qwenwork.cn` no longer rely on DOM-painted text as the delivery mechanism. Text is inserted through CDP `Input.insertText`, which follows Chrome's real editing path. Live browser testing confirmed that extracted text is now normally editable and deletable instead of becoming visible-but-unsendable ghost state.
- **Qianwen auto-send uses a real Enter key path.** CDP `Input.dispatchKeyEvent` sends Enter instead of guessing Qianwen's unstable send-button DOM. Sending still requires independent post-send evidence; otherwise Link2Context returns `SEND_UNCONFIRMED` rather than treating the key press itself as success.
- **The `debugger` permission is tightly scoped.** Only Link2Context's own content-script messages are accepted; only the top frame is allowed; only `qianwen.com` / `qwenwork.cn` and their subdomains are accepted; each operation attaches temporarily and detaches immediately afterward. If another debugger already owns the tab, the operation fails explicitly with `QIANWEN_DEBUGGER_BUSY`.
- **PDF, image, and other original binary resources remain original attachments.** Binary files are not decoded into garbage text.
- **Auto-send remains fail-closed.** On generic web-AI targets, clicking a button is never sufficient proof of successful sending; independent page evidence is still required.
- **STOP covers the complete job lifecycle.** Network acquisition, pagination, attachment waiting, editor handoff, and auto-send waiting are all cancellable.
- **Pagination is broader but still bounded.** V0.5.3 supports `rel=next`, numeric pagination, declarative `data-url` / `data-page`, and same-origin `onclick location` navigation while retaining same-origin, article-family, eight-page, and total-size limits.

## How it works

1. Paste a single `http://` or `https://` URL into a supported web-AI composer.
2. Link2Context intercepts that real user gesture and acquires, classifies, and cleans the target resource in the browser.
3. It chooses text or attachment delivery based on resource type and target AI.
4. Send behavior stays separate: manual review is the safe default; auto-send is explicit opt-in.
5. If public acquisition hits 401 / 403 or a client-render shell, the user may explicitly authorize browser-context fallback in the popup. No authorization means no silent session reuse.

### Qianwen-specific note

V0.5.3 adds Chrome's `debugger` permission for `qianwen.com` / `qwenwork.cn`. Chrome may show a banner indicating that the extension is debugging the browser or tab while an input operation is in progress. That is expected for this real-input path.

After upgrading to V0.5.3, reload Link2Context from `chrome://extensions` and refresh already-open Qianwen pages. Chrome may ask you to confirm the newly added permission.

## Authorized Browser Context

- Public fetching is unauthenticated by default.
- 401 / 403 / `CLIENT_RENDER_CONTENT_MISSING` may enter Authorized Browser Context only after explicit user authorization.
- Authorization is revocable and individual hosts can be deny-listed.
- Link2Context does not directly read or store Cookie values through `chrome.cookies`.
- Requested/final URLs, response size, timeout, and cancellation boundaries remain enforced.
- It does not bypass login walls, CAPTCHAs, DRM, paywalls, or site access controls.

## Generic resource pipeline

```text
Acquire → Classify → Render if needed → Extract → Handoff
```

Classification is byte-first: file signatures, MIME, and URL extensions are considered before decoding text. PDFs, images, archives, Office files, audio/video, and unknown binary resources default to original-file attachments instead of becoming garbage text.

HTML gets lightweight article extraction and common navigation/footer/sidebar/script/style noise removal. JSON, plain text, XML, and CSV become readable context. ChatGPT shares and WorkBuddy shares use dedicated clean conversation parsers that keep useful user/assistant text while dropping large image, reasoning, and tool payloads.

## Pagination

Safe pagination currently covers:

- `<link rel="next">`;
- explicit Next links within the same article URL family;
- numeric pagination;
- `data-href` / `data-url` / `data-next-url` / `data-page-url`;
- `data-page` / `data-page-number` / `data-pageno`;
- same-origin onclick location navigation.

Pagination stays same-origin, is capped at eight pages, and remains subject to response-size and cancellation limits. **V0.5.3 does not claim generic support for arbitrary SPA infinite scroll or every “load more” UI.**

## Built-in web-AI targets

ChatGPT, Claude, Gemini / Google AI Studio, Grok, Perplexity, DeepSeek, Doubao, Kimi, Qwen / Tongyi, Poe, Microsoft Copilot, Mistral Chat, and OpenRouter.

For another web AI, open that site, click the Link2Context icon once, and choose **Enable current site**.

## Install (Chrome / Edge)

1. Download or clone the repository.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable Developer mode.
4. Choose **Load unpacked**.
5. Select the repository's `extension` directory.
6. After an update, pull `main`, reload the extension, and refresh already-open AI pages.

## Security boundaries

- HTTP / HTTPS only.
- Credentials embedded in URLs are rejected.
- localhost, private/link-local/special-purpose address space, and cloud metadata targets are blocked.
- Redirect destinations are revalidated.
- Response size and timeout are bounded.
- Automatic acquisition requires a real user event and the background validates the calling web-AI host again.
- Browser-context fallback is explicit opt-in, revocable, and deny-listable by host.
- Cookie values are not directly read.
- External page content is marked as untrusted data.
- Sensitive query parameters are redacted from display output.
- Link2Context never force-removes `disabled` / `aria-disabled` from site controls.
- The `debugger` permission is used only for the tightly scoped Chinese-Qianwen text-input / Enter-key bridge, not as a generic browser-control capability.
- On Qianwen, visible DOM state is not treated as proof of sendable editor state.

See [SECURITY.md](./SECURITY.md).

## Tests and validation

```bash
npm test
npm run check
```

Before merge, V0.5.3 completed **292 / 292 passing tests**, passed `npm run check`, and had a successful GitHub Actions CI run.

For live-browser validation, the core `www.qianwen.com` text-handoff regression has been closed: extracted text now enters a real editable state. Third-party web UIs continue to change, so green automation cannot guarantee permanent compatibility with every target; live-browser smoke tests remain the final signal when a site changes.

## Known boundaries

- Arbitrary SPA infinite scroll / “load more” flows are not a universal guarantee.
- The Qianwen CDP path requires Chrome's `debugger` permission. If DevTools or another debugger already owns the same tab, Link2Context may return `QIANWEN_DEBUGGER_BUSY`.
- Third-party web-AI DOM/editor/send changes may require future adapter updates.
- Auto-send is off by default; manual review is recommended when validating a target site for the first time.

## License

MIT
