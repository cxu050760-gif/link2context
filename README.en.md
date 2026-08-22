# Link2Context

English | [中文](./README.md)

**Send only a link in a web AI chat. Link2Context fetches the real content locally, converts it, injects it back into the current composer, and continues the send.**

V0.2 is not just a downloader. It is a local link bridge for web AIs such as ChatGPT, Doubao, Kimi, Claude, Gemini, DeepSeek, and Qwen when their own URL-fetch tools cannot read a target.

## Normal workflow

1. Paste one `http://` or `https://` URL into a supported web AI composer.
2. Press Enter or click Send.
3. Link2Context intercepts a URL-only message.
4. The browser extension fetches the target locally.
5. It normalizes the content into AI-ready context.
6. It replaces the URL-only draft and continues the send.

No manual download, Markdown conversion, copy, or upload is needed in the normal path.

## Built-in web AI support

ChatGPT, Claude, Gemini / Google AI Studio, Grok, Perplexity, DeepSeek, Doubao, Kimi, Qwen / Tongyi, Poe, Microsoft Copilot, Mistral Chat, and OpenRouter are built in.

For another web AI, open that site, click Link2Context once, and choose **Enable current site**. URL-only chat messages can then use the same automatic path.

## Link types

- **WorkBuddy shares**: resolves `workbuddy.link/p/...` to the underlying `conversation-data.json`, extracts conversation text, and omits image base64, tool arguments, and reasoning payloads.
- **Regular pages**: extracts readable HTML text and wraps it as Markdown context.
- **JSON / APIs**: parses the full JSON before rendering AI-readable Markdown and also sniffs mislabeled responses.
- **Plain text / XML / JavaScript**: wraps content with source metadata.
- **PDF / images / archives / other binary files**: fetches the file and attempts to attach it to the current web-AI message.
- **Very long text**: automatically becomes a `.md` attachment instead of overflowing a chat composer.

## Install (Chrome / Edge)

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Enable Developer mode.
4. Click **Load unpacked**.
5. Select the repository's **`extension` directory**.
6. Open a supported web AI and send a URL-only message.

## Security boundaries

Because Link2Context can retrieve broad HTTP(S) targets, V0.2 keeps automatic fetches on a user-initiated path:

- HTTP(S) only;
- credential-bearing URLs rejected;
- localhost, private/link-local, special-purpose ranges, and cloud metadata blocked;
- every redirect target revalidated;
- `targetAddressSpace: public` requested where Chromium supports it;
- 12 MiB response cap and 25-second default timeout;
- ordinary web pages cannot directly call the extension;
- automatic interception requires real trusted browser events;
- the background re-checks the calling web-AI host;
- likely secret query parameters are redacted in generated context;
- fetched text is explicitly marked as untrusted external data.

See [SECURITY.md](./SECURITY.md).

## Compatibility note

“Any URL” does not mean bypassing authentication, CAPTCHAs, DRM, paywalls, or browser/enterprise network policy. V0.2 targets HTTP(S) resources the user's browser is normally allowed to retrieve, so the web AI no longer needs its own generic URL-fetch capability.

Heavily client-rendered SPAs may expose little useful text to a direct GET. Automatic binary upload also depends on the target AI exposing a compatible file input. The popup keeps the manual converter as a fallback.

## Tests and adversarial review

```bash
npm test
npm run check
```

On top of the six V0.1 review rounds, V0.2 received **15 adversarial rounds** focused on the zero-touch web-AI path: SSRF variants, redirects, false send success, upload races, rich-text editors, malicious-page abuse, oversized context, and more.

See:

- [V0.2 Adversarial Review](./docs/ATTACK-REVIEW-V0.2.md)
- [References](./docs/REFERENCES.md)

## Prior art

Before implementation, V0.2 checked existing GitHub projects and reused architectural ideas from MCP SuperAssistant (web-AI result injection), MarkDownload (browser-side web-to-Markdown), and Defuddle (main-content extraction). **No code from those projects is copied into Link2Context.** This repository remains MIT-licensed.

## License

MIT License. See [LICENSE](./LICENSE).
