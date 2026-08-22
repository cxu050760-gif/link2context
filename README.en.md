# Link2Context

English | [中文](./README.md)

**Send one URL in a web-AI chat. Link2Context fetches the resource in your browser, classifies it, cleans it into AI-ready context, and hands it to the current AI.**

V0.4.0 explicitly separates the generic pipeline into:

```text
Acquire → Classify → Render if needed → Extract → Handoff
```

It is now **byte-first**: raw bytes, file signatures, MIME, and URL extensions are considered before text decoding. PDF, images, archives, Office files, audio/video, and unknown binary resources default to original-file attachments instead of being decoded into garbage text.

V0.3 previously added clean ChatGPT/WorkBuddy conversation extraction, while V0.3.1 added target-aware delivery: ChatGPT is file-first for conversation sources and DeepSeek/other targets keep their stable short/medium inline path.

## Normal workflow

1. Paste one HTTP(S) URL into ChatGPT, DeepSeek, Doubao, Kimi, Claude, Gemini, Qwen, or another enabled web AI.
2. Press Enter or click Send.
3. Link2Context intercepts → fetches locally → classifies → cleans/parses → chooses text or attachment from both resource type and target AI → uploads/injects → continues send.

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

### Client-render shells: explicit failure, no silent session reuse

Large HTML with an empty `root/app/__next`, explicit JavaScript-required text, or almost no useful body content becomes `CLIENT_RENDER_CONTENT_MISSING / RENDER`.

**Generic browser navigation fallback is intentionally not enabled for arbitrary URLs.** Browser navigation may carry cookies and logged-in sessions. Silently reading private DOM and then handing it to another AI would create an unacceptable data-exfiltration boundary. Existing WorkBuddy and ChatGPT Share fallbacks remain pinned to their public-share hosts and paths.

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

The progress panel now covers fetch, classification, pagination, page handoff, attachment confirmation, send, and typed terminal errors.

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
- WorkBuddy/ChatGPT Share browser fallbacks pinned to exact public hosts/paths;
- fetched text explicitly marked untrusted external data, not instructions;
- likely secret query parameters redacted;
- ChatGPT serialized objects decoded into null-prototype objects;
- attachment confirmation failure never fails open into a giant composer dump;
- no bypass of authentication, CAPTCHAs, DRM, paywalls, or site access control.

See [SECURITY.md](./SECURITY.md).

## Tests and adversarial review

```bash
npm test
npm run check
```

V0.4 adds attacks around raw-byte classification, 401/403/404/429/5xx, network/timeouts, client-render shells, main-content cleaning, pagination escape/loops, and stage-preserving diagnostics, while retaining all V0.1–V0.3.1 regressions.

See:

- [V0.4 Universal Pipeline](./docs/V0.4-UNIVERSAL-PIPELINE.md)
- [V0.4 Adversarial Review](./docs/ATTACK-REVIEW-V0.4.md)
- [V0.3 Adversarial Review](./docs/ATTACK-REVIEW-V0.3.md)
- [V0.3.1 Target-aware Handoff](./docs/HOTFIX-V0.3.1.md)
- [References](./docs/REFERENCES.md)

## Compatibility boundary

“Any URL” means best-effort handling of **public, legitimate HTTP(S) resources permitted by browser/network policy**. It does not mean bypassing access control.

A 403 is now accurately reported as `FETCH_BLOCKED_403`, but Link2Context does not claim to bypass the remote CDN. A 401 becomes `AUTH_REQUIRED_401`, without stealing logged-in cookies. Client-only SPAs are reported as missing rendered content instead of treating a title-only shell as success.

## License

MIT License. See [LICENSE](./LICENSE).
