# Link2Context

English | [中文](./README.md)

**Send one URL in a web-AI chat. Link2Context fetches the resource in your browser, classifies it, cleans it into AI-ready context, and hands it to the current AI.**

> Current test branch: **V0.5.3**. This release candidate focuses on real-browser handoff reliability. It keeps the V0.5.2 authorized-browser fallback and security boundaries, removes the old V0.5.1 + V0.5.2 stacked send-state design, and adds a Qwen/Tongyi adapter that requires evidence of the editor's real send state. **V0.5.3 remains a Draft candidate and is not merge-ready until the live smoke gate passes.**

## V0.5.3 closeout focus

- **Qwen visible UI is no longer accepted as real state.** Live testing produced an exact failure where extension-created content could not be deleted; after the user typed extra characters and sent, Qwen transmitted only those newly typed characters. That proves visible content can exist outside Qwen's actual send state.
- **Ordinary Qwen text uses the browser editing path.** The Qwen adapter uses the browser's editing command rather than assigning `innerHTML`, `textContent`, or manufacturing a synthetic `InputEvent` after the write. The text must survive blur/refocus reconciliation and Qwen's own send control must become enabled. Otherwise the handoff fails with `QWEN_EDITOR_STATE_UNCONFIRMED`.
- **Original PDF/image/binary resources remain original attachments.** A filename merely appearing in the DOM is insufficient evidence; Qwen must also expose an enabled send control or the adapter fails with `QWEN_ATTACHMENT_STATE_UNCONFIRMED`.
- **One owner per Qwen gesture.** `qwen-state-bridge-v053.js` loads before the generic `content-script-v053.js` and stops propagation for Qwen gestures it owns, preventing two send state machines from processing the same action.
- **Auto-send remains fail-closed.** A button click is never success by itself; independent page evidence is required or the result is `SEND_UNCONFIRMED`.
- **STOP covers the complete handoff.** Network acquisition, attachment waiting, editor delivery, and auto-send waiting can all be cancelled.
- **Pagination remains bounded.** Besides rel-next and numeric links, V0.5.3 recognizes declarative `data-url` / `data-page` and same-origin onclick navigation while retaining same-origin, article-family, page-count, and size limits.

## How it works

1. Paste a single `http://` or `https://` URL into a supported web-AI composer.
2. Link2Context intercepts that real user gesture and acquires, classifies, and cleans the target resource in the browser.
3. It chooses text or attachment delivery based on resource type and target AI.
4. Send behavior stays separate: manual review is the safe default, while auto-send is explicit opt-in.
5. If public acquisition hits 401 / 403 or a client-render shell, the user may explicitly authorize browser-context fallback in the popup. No authorization means no silent session reuse.

## Retained V0.5.2 capability: authorized browser fallback

- Public fetching is unauthenticated by default.
- 401 / 403 / `CLIENT_RENDER_CONTENT_MISSING` may enter Authorized Browser Context only after explicit user authorization.
- Authorization can be revoked and individual hosts can be deny-listed.
- Link2Context does not directly read or store Cookie values through `chrome.cookies`.
- Requested/final URLs, response size, timeout, and cancellation boundaries remain enforced.
- It does not bypass login walls, CAPTCHAs, DRM, paywalls, or site access controls.

## Generic resource pipeline

```text
Acquire → Classify → Render if needed → Extract → Handoff
```

Classification is byte-first: file signatures, MIME, and URL extensions are considered before decoding text. PDFs, images, archives, Office files, audio/video, and unknown binary resources default to original-file attachments instead of becoming garbage text.

HTML gets lightweight article extraction and common navigation/footer/sidebar/script/style noise removal. JSON, plain text, XML, and CSV become readable context. ChatGPT shares and WorkBuddy shares use dedicated clean conversation parsers.

## Pagination

Safe pagination currently covers:

- `<link rel="next">`;
- explicit Next links within the same article URL family;
- numeric pagination;
- `data-href` / `data-url` / `data-next-url` / `data-page-url`;
- `data-page` / `data-page-number` / `data-pageno`;
- same-origin onclick location navigation.

Pagination stays same-origin, is capped at eight pages, and remains subject to response-size and cancellation limits. V0.5.3 does not claim generic SPA infinite-scroll support.

## Built-in web-AI targets

ChatGPT, Claude, Gemini / Google AI Studio, Grok, Perplexity, DeepSeek, Doubao, Kimi, Qwen / Tongyi, Poe, Microsoft Copilot, Mistral Chat, and OpenRouter.

For another web AI, open that site, click the Link2Context icon once, and choose **Enable current site**.

## Install (Chrome / Edge)

1. Download or clone the repository.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable Developer mode.
4. Choose **Load unpacked**.
5. Select the repository's `extension` directory.
6. After an update, pull the branch, reload the extension, and refresh already-open AI pages.

## Security boundaries

- HTTP / HTTPS only.
- Credentials embedded in URLs are rejected.
- localhost, private/link-local/special-purpose IP space, and cloud metadata targets are blocked.
- Redirect destinations are revalidated.
- Response size and timeout are bounded.
- Automatic acquisition requires a real user event and the background validates the calling AI host again.
- Browser-context fallback is explicit opt-in, revocable, and deny-listable by host.
- Cookie values are not directly read.
- External page content is marked as untrusted data.
- Sensitive query parameters are redacted from display output.
- Link2Context never force-removes `disabled` / `aria-disabled` from site controls.
- On Qwen/Tongyi in particular, visible DOM state is not treated as proof of sendable editor state.

See [SECURITY.md](./SECURITY.md).

## Tests

```bash
npm test
npm run check
```

GitHub Actions runs syntax checks and the full Node regression suite. Green automation still cannot prove that a third-party site's live DOM has not changed, so Qwen, DeepSeek, Doubao, pagination, STOP, PDF, and image flows remain part of the minimal live-browser smoke gate.

## License

MIT
