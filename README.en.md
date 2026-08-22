# Link2Context

English | [中文](./README.md)

**Send only a URL in a web-AI chat. Link2Context fetches the real content in your browser, cleans it into AI-ready context, and hands it back to the current AI.**

V0.3 focuses on more than fetching. It tries to keep only the useful context after retrieval. ChatGPT public shares and WorkBuddy shares now have dedicated conversation extractors instead of feeding a web AI roughly 1 MB of hydration/JSON internals.

**V0.3.1 adds target-aware handoff.** The same clean context is no longer forced through the same delivery mechanism on every web AI. On ChatGPT, WorkBuddy and ChatGPT conversation shares are file-first and use clean Markdown attachments to avoid rich-composer stalls. DeepSeek and other targets keep their already-working inline-text path for short and medium content.

## Normal workflow

1. Paste one `http://` or `https://` URL into ChatGPT, DeepSeek, Doubao, Kimi, Claude, Gemini, Qwen, or another enabled web AI.
2. Press Enter or click Send.
3. Link2Context intercepts the URL-only message → fetches locally → detects the source → cleans it → **chooses text or attachment based on the destination AI** → injects/uploads it → continues the send.

Delivery is now target-aware instead of controlled by one global size threshold:

- **ChatGPT + WorkBuddy / ChatGPT conversation shares**: prefer a clean `.md` (Markdown) attachment.
- **ChatGPT + generic content**: short content stays inline; at 24,000 characters it becomes an attachment.
- **DeepSeek / other targets**: retain the existing 250,000-character global hard threshold, preserving already-working short/medium inline behavior.
- **Binary files**: continue through the attachment path.

The progress panel shows the destination host, source kind, payload size, selected handoff mode, and reason.

## V0.3: clean conversation extraction

### ChatGPT public shares

For `https://chatgpt.com/share/...`, Link2Context now:

- recognizes the current public share-page `streamController.enqueue(...)` hydration payload;
- decodes the turbo-stream positional-flatten wire format;
- prefers `linear_conversation`, otherwise follows `current_node → parent` so alternate branches are not mixed into the active thread;
- keeps **User** and **Assistant** message text;
- omits system/tool/page-state/metadata noise by default;
- turns images, audio, and attachments into lightweight placeholders instead of exposing large base64 blobs or internal asset pointers;
- when direct fetch returns an unparseable shell/challenge page, automatic mode can open an inactive browser tab for the same public share URL, read its HTML, close the tab, and retry the clean extractor.

Instead of raw `streamController.enqueue(...)` serialization, the target is clean output such as:

```markdown
# Conversation title

Provider / 来源平台: ChatGPT
Source / 来源链接: https://chatgpt.com/share/...

## User / 用户
...

## Assistant / AI
...
```

### WorkBuddy shares

`workbuddy.link/p/...` still resolves to the public `conversation-data.json`, but now uses the same normalized conversation Markdown schema as ChatGPT. User/assistant text is kept while large images, reasoning bodies, and tool payloads are omitted or represented by small placeholders.

## Other link types

- **Regular pages**: removes active/noisy page blocks and extracts readable text as Markdown.
- **JSON / APIs**: parses the full JSON before rendering AI-readable structure and sniffs mislabeled responses.
- **Plain text / XML / JavaScript**: wraps content with source metadata.
- **PDF / images / ZIP / other binary files**: safely fetches and attempts to attach the file to the current web-AI message.
- **Very long text**: converts to a `.md` attachment according to the destination's stability policy instead of overflowing a composer.

## Built-in web AI support

ChatGPT, Claude, Gemini / Google AI Studio, Grok, Perplexity, DeepSeek, Doubao, Kimi, Qwen / Tongyi, Poe, Microsoft Copilot, Mistral Chat, and OpenRouter are built in.

For another web AI, open that site, click Link2Context once, and choose **Enable current site**. URL-only chat messages can then use the same automatic path.

## Install (Chrome / Edge)

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Enable Developer mode.
4. Click **Load unpacked**.
5. Select the repository's **`extension` directory**.
6. After updating the repository, run `git pull`, reload Link2Context on the extensions page, and preferably refresh already-open AI tabs.

## Security boundaries

Link2Context has powerful cross-origin fetch permissions, so automatic mode keeps strict boundaries:

- HTTP(S) only;
- credential-bearing URLs rejected;
- localhost, private/link-local, special-purpose IP ranges, and cloud metadata blocked;
- every redirect target revalidated;
- `targetAddressSpace: public` requested where Chromium supports it;
- 12 MiB response cap plus network timeouts;
- automatic fetch requires a real user event and the background verifies the calling web-AI host again;
- ChatGPT / WorkBuddy browser fallbacks are pinned to the expected official host/path and are not exposed as generic browser proxies;
- fetched text is explicitly marked as untrusted external data, not instructions;
- likely secret query parameters are redacted from generated context;
- ChatGPT serialized objects are decoded into null-prototype objects to prevent `__proto__` prototype pollution;
- decoder depth, slot count, search nodes, and output message counts are bounded;
- if an attachment cannot be confirmed by the destination AI, Link2Context does not silently fall back to dumping a large body into the composer; auto-send stops with an explicit error.

See [SECURITY.md](./SECURITY.md).

## Tests and adversarial review

```bash
npm test
npm run check
```

V0.3 adds **15 adversarial review rounds** focused on public AI conversations → clean context: branch contamination, malformed promises, cyclic mappings, prototype pollution, base64 bloat, prompt injection, invalid timestamps, shell-page fallback, host/path escape, manual/automatic divergence, and more.

V0.3.1 adds 14 target-aware handoff regressions covering ChatGPT/DeepSeek routing, lookalike hosts, soft/hard thresholds, invalid sizes, real sender-host binding, and progress/diagnostic metadata.

See:

- [V0.3 Adversarial Review](./docs/ATTACK-REVIEW-V0.3.md)
- [V0.3 Design](./docs/DESIGN-V0.3.md)
- [V0.3.1 Target-aware Handoff Fix](./docs/HOTFIX-V0.3.1.md)
- [References](./docs/REFERENCES.md)

## Prior art

V0.3 was preceded by a GitHub collision/prior-art check. The current ChatGPT-share wire-format understanding was informed by `chickensintrees/chatgpt-share-reader`, while `pionxzh/chatgpt-exporter` informed conversation-export ideas. Earlier versions also studied MCP SuperAssistant, MarkDownload, and Defuddle.

**Link2Context is an independent JavaScript implementation and does not directly copy source code from those projects.** The repository remains MIT-licensed.

## Compatibility boundary

“Handle any link” means best-effort handling of HTTP(S) content the user's browser can normally access. It does not bypass authentication, CAPTCHAs, DRM, paywalls, or enterprise network policy. Dedicated extractors may need updates when upstream sites change; failures should be explicit instead of silently treating a megabyte of useless page internals as success.

## License

MIT License. See [LICENSE](./LICENSE).