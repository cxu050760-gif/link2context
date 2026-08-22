# Link2Context

English | [中文](./README.md)

**Send one URL in a web-AI chat. Link2Context fetches the resource in your browser, classifies it, cleans it into AI-ready context, and hands it to the current AI.**

> Current test branch: **V0.5.2**. V0.5.1 separated delivery format from send behavior and hardened real-page attachment/Qwen handling. V0.5.2 adds an independent handoff-reliability layer and makes 401 / 403 / client-render browser-context fallback **off by default, explicitly authorized by the user, and deny-listable per host**.

V0.4.0 explicitly separates the generic pipeline into:

```text
Acquire → Classify → Render if needed → Extract → Handoff
```

It is **byte-first**: raw bytes, file signatures, MIME, and URL extensions are considered before text decoding. PDF, images, archives, Office files, audio/video, and unknown binary resources default to original-file attachments instead of being decoded into garbage text.

V0.3 previously added clean ChatGPT/WorkBuddy conversation extraction, while V0.3.1 added target-aware delivery: ChatGPT is file-first for conversation sources and DeepSeek/other targets keep their stable short/medium inline path.

## Normal workflow

1. Paste one HTTP(S) URL into ChatGPT, DeepSeek, Doubao, Kimi, Claude, Gemini, Qwen, or another enabled web AI.
2. Press Enter or click Send.
3. Link2Context intercepts → fetches locally → classifies → cleans/parses → chooses text or attachment from both resource type and target AI → uploads/injects.
4. Since V0.5.1, send behavior is independent: manual review is the default, while auto-send is explicit opt-in. Merely pasting a URL never immediately sends it.
5. If a public fetch gets 401 / 403 or only a client-render shell, V0.5.2 can continue through browser context only after you explicitly authorize that capability in the popup. Without authorization it fails closed instead of silently borrowing your logged-in session.

## V0.5.2: authorized browser fallback and handoff reliability

- **Browser context stays off by default.** Credential-free public fetching remains the first path. Only explicit popup authorization allows 401 / 403 / `CLIENT_RENDER_CONTENT_MISSING` to route into the authorized browser fallback.
- **Revocable and host-deny-listable.** Authorization is persisted for usability, but can be revoked globally; denied hosts never use the logged-in browser context even when the global capability is enabled.
- **No direct cookie-value access.** Link2Context does not use `chrome.cookies` to read or store cookie values. Authorized fallback uses a browser tab's existing site context while retaining URL/final-URL, size, timeout, and access-control checks.
- **Send success needs independent evidence.** Clicking a send button is not enough. V0.5.2 looks for independent page evidence such as composer clearing, the sent message appearing, or compatible generation state. Legacy false-positive success is suppressed fail-closed.
- **Attachment evidence survives rerenders but expires.** MutationObserver mirrors only observed attachment proof into candidate scopes, with a TTL so stale proof cannot contaminate a later same-name upload.
- **Qwen document fallback is narrowly gated.** Only Qwen/Tongyi + explicit document mode + extension-generated synthetic file events may adapt a Markdown attachment to plain-text filename/MIME; content stays unchanged and trusted user file events are not rewritten.
- **Composer rerenders are recoverable.** Auto-send can re-resolve the newest composer while waiting for an enabled send control, but it never removes `disabled` / `aria-disabled`.
- **Auto-send remains opt-in.** A failed auto-send is surfaced as `SEND_UNCONFIRMED`; it cannot quietly masquerade as intended manual mode.

## V0.5.1: real-page delivery fixes

- Delivery format: Auto / Markdown document / long text.
- Send behavior: manual review (default, recommended) / auto-send.
- Truncated attachment-chip filenames can be confirmed through distinctive filename hints instead of requiring the full filename to remain visible.
- Qwen/Tongyi attachment discovery can open a generic `+ / More` menu and prefer file/attachment actions over image-only actions.
- Managed Qwen editors remain fail-closed: safe Paste/Input paths are verified, direct DOM mutation is avoided, and disabled send controls are never force-enabled.

## V0.4: universal URL pipeline hardening

### Binary is no longer text by default

Classification combines:

- **Magic signatures** such as `%PDF-`, PNG/JPEG, ZIP, MP3/MP4;
- **Content-Type / MIME**;
- **URL file extension**;
- byte-level text plausibility plus JSON/HTML sniffing.

A strong binary signature wins over a misleading `text/plain`. Conversely, if a server claims `text/html` or `application/json` but the bytes are clearly binary, Link2Context fails closed to binary handling.

Original-file attachment handling currently covers PDF, common images, ZIP/7z/RAR/gzip, DOCX/XLSX/PPTX and related documents, common audio/video, and unknown binary.

### Errors retain their real stage

Failures no longer collapse into `Page handoff failed`:

- `AUTH_REQUIRED_401` — authentication/authorization required;
- `FETCH_BLOCKED_403` — server denied the fetch;
- `NOT_FOUND_404`;
- `RATE_LIMITED_429`;
- `HTTP_5XX`;
- `FETCH_TIMEOUT`;
- `FETCH_NETWORK_ERROR`;
- `RESPONSE_TOO_LARGE`;
- `CLIENT_RENDER_CONTENT_MISSING` — HTML arrived but contains only a client-render shell;
- only actual upload/composer/send failures are `HANDOFF` failures.

401/403/404/429 are not pointlessly retried. Network failures, timeouts, and 5xx retain bounded retry behavior.

### Cleaner generic HTML

The lightweight extractor now favors semantic `<main>` / `<article>` and removes common navigation/footer/sidebar/form/menu/login/language/toolbar wrappers plus active script/style/iframe noise.

This remains a zero-dependency lightweight extractor; it does not claim parity with Mozilla Readability, Defuddle, or Trafilatura. If extraction quality becomes the dominant bottleneck, the project keeps the rule **Reuse > Adapt > Compose > Build from scratch** and should evaluate a mature extractor before growing endless site rules.

### Safe multi-page articles

V0.4 can follow same-origin `rel=next` or explicit article pagination such as “Next / 下一页” when the URL still belongs to the same article family:

- same origin only;
- generic Next links must remain in the same article family;
- maximum 8 pages;
- maximum 3 MiB per additional page;
- all pages still share the global 12 MiB budget;
- loop protection;
- if a later page fails, already-fetched pages are preserved and output is marked `PARTIAL`.

### Client-render shells: fail closed by default, explicit browser-context fallback in V0.5+

Large HTML with an empty `root/app/__next`, explicit JavaScript-required text, or almost no useful body content is classified as `CLIENT_RENDER_CONTENT_MISSING / RENDER`.

**Link2Context still never silently reuses a logged-in session.** Without authorization, it reports that browser-context authorization is required. After explicit user authorization, a controlled background tab may use the existing browser site context for that target; authorization can be revoked globally and denied for specific hosts. The separate WorkBuddy and ChatGPT Share fallbacks remain pinned to their exact public hosts/paths.

## V0.3: clean conversation extraction

### ChatGPT public shares

For `https://chatgpt.com/share/...`, Link2Context decodes public turbo-stream/hydration data, keeps only the active conversation branch, preserves User/Assistant text, and omits system/tool/page-state/large base64 noise. The browser fallback is restricted to the exact public ChatGPT Share URL.

### WorkBuddy shares

`workbuddy.link/p/...` resolves to the public `conversation-data.json` and uses the same clean conversation Markdown schema, omitting large images, reasoning bodies, and tool payloads.

## Target-aware handoff

- **ChatGPT + WorkBuddy / ChatGPT conversation share**: prefer a clean `.md` attachment.
- **ChatGPT + generic text**: short content stays inline; around 24,000 characters switches to attachment.
- **DeepSeek / other targets**: retain the 250,000-character global hard limit.
- **PDF / image / archive / Office / audio/video / other binary**: original-file attachment.

The progress panel covers fetch, classification, pagination, page handoff, attachment confirmation, send, and typed terminal errors.

## Other link types

- **HTML/article** → cleaned Markdown;
- **JSON/API** → structured Markdown;
- **plain text/XML/JavaScript/CSV** → text context;
- **PDF/images/archives/Office/audio/video** → original attachment;
- **very long text** → `.md` attachment according to the destination policy.

## Built-in web AI support

ChatGPT, Claude, Gemini / Google AI Studio, Grok, Perplexity, DeepSeek, Doubao, Kimi, Qwen / Tongyi, Poe, Microsoft Copilot, Mistral Chat, and OpenRouter.

For another web AI, open the site, click Link2Context, and choose **Enable current site**.

## Install (Chrome / Edge)

1. Download or clone this repository.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable Developer mode.
4. Click **Load unpacked**.
5. Select the repository's `extension` directory.
6. After an update, run `git pull`, reload the extension, and refresh already-open AI tabs.

## Security boundaries

- HTTP(S) only;
- credential-bearing URLs rejected;
- localhost/private/link-local/special-purpose/cloud-metadata addresses blocked;
- every redirect revalidated;
- `targetAddressSpace: public` requested when available;
- response/time budgets enforced, including the global 12 MiB cap;
- automatic fetch requires a real user gesture and verified destination-AI host;
- **normal fetching does not use the logged-in browser session; generic browser-context fallback activates only after explicit user authorization and supports global revocation plus a host deny list;**
- authorized fallback does not use `chrome.cookies` to directly read/store cookie values, and requested/final URLs remain revalidated;
- WorkBuddy/ChatGPT Share public browser fallbacks remain pinned to exact public hosts/paths;
- fetched text is explicitly marked untrusted external data, not instructions;
- likely secret query parameters are redacted;
- ChatGPT serialized objects are decoded into null-prototype objects;
- attachment confirmation failure never fails open into a giant composer dump;
- authentication, CAPTCHAs, DRM, paywalls, and site access controls are not bypassed;
- disabled / aria-disabled send controls are never force-enabled.

See [SECURITY.md](./SECURITY.md).

## Tests and adversarial review

```bash
npm test
npm run check
```

V0.4 adds attacks around raw-byte classification, 401/403/404/429/5xx, network/timeouts, client-render shells, main-content cleaning, pagination escape/loops, and stage-preserving diagnostics, while retaining all V0.1–V0.3.1 regressions.

V0.5.1 adds regressions for send-preference fail-safe behavior, accidental auto-send, truncated attachment names, Qwen add-menu/file targeting, disabled-send safety, manual-mode false failures, and managed-editor corruption boundaries.

V0.5.2 adds independent send evidence, legacy-success suppression, attachment-proof TTL, composer rerender recovery, Qwen document-adaptation boundaries, explicit authorized browser-context fallback, host deny-list behavior, and cancellation propagation. Current GitHub Actions result: **288/288 tests PASS + `npm run check` PASS**.

See:

- [V0.4 Universal Pipeline](./docs/V0.4-UNIVERSAL-PIPELINE.md)
- [V0.4 Adversarial Review](./docs/ATTACK-REVIEW-V0.4.md)
- [V0.3 Adversarial Review](./docs/ATTACK-REVIEW-V0.3.md)
- [V0.3.1 Target-aware Handoff](./docs/HOTFIX-V0.3.1.md)
- [References](./docs/REFERENCES.md)

## Compatibility boundary

“Any URL” means best-effort handling of **public, legitimate HTTP(S) resources permitted by browser/network policy**. It does not mean bypassing access control.

403 / 401 keep their real failure stage. **Without explicit browser-context authorization, Link2Context does not silently borrow logged-in cookies.** After the user opts in, it may retry through the existing browser site context, but it still does not promise to pass login walls, CDNs, CAPTCHAs, DRM, paywalls, or other access controls. Client-only SPAs request authorization/report RENDER rather than pretending a title-only shell is success.

## License

MIT License. See [LICENSE](./LICENSE).
