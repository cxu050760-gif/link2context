# Link2Context

English | [中文](./README.md)

**Turn links into clean, AI-ready context for web AIs.**

Link2Context is a local browser extension. Instead of requiring ChatGPT, Doubao, Kimi, Claude, Gemini, or another cloud AI to fetch arbitrary remote URLs, it fetches and normalizes content in your browser, then lets you copy Markdown or save/upload the resulting file to any web AI.

## What it supports today

- **WorkBuddy share links**: recognizes `https://workbuddy.link/p/...`, resolves the public `conversation-data.json`, extracts conversation text, and omits large image base64, tool arguments, and reasoning payloads.
- **Regular web pages**: fetches HTML, removes scripts/styles and obvious noise, and wraps extracted text as Markdown context.
- **JSON / API responses**: parses JSON first and renders readable Markdown, including responses with missing or incorrect `Content-Type` headers.
- **Plain text / XML / JavaScript**: wraps the response with source metadata.
- **PDF / images / archives / other binary files**: does not pretend to parse them; it safely downloads the original so it can be uploaded to a web AI.
- **Legacy text encodings**: honors supported response charsets such as UTF-8, GBK/GB2312, and ISO-8859-1.

## Why this helps web AIs

Cloud AI browsing tools often differ in domain access, response formats, size limits, timeouts, and security policies. Link2Context moves URL retrieval to **your browser**:

```text
URL
 ↓
Link2Context browser extension (local fetch)
 ↓
Markdown / original file
 ↓
ChatGPT / Doubao / Kimi / Claude / Gemini / other web AI
```

This avoids depending on any single AI platform's URL-fetch capability.

## Install (Chrome / Edge)

1. Download or clone this repository.
2. Open the extension manager:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
3. Enable Developer mode.
4. Click **Load unpacked**.
5. **Select the repository's `extension` directory.**
6. Pin Link2Context and open it when needed.

## Usage

1. Copy an `http://` or `https://` URL.
2. Open Link2Context.
3. Paste the URL and click **Convert**.
4. Text-like content becomes Markdown:
   - click **Copy** and paste it into any web AI; or
   - click **Save** and upload the `.md` file.
5. For PDFs, images, ZIPs, or other binary content, click **Download original** and upload that file to the AI.

## WorkBuddy example

Input:

```text
https://workbuddy.link/p/fqAaNqzcOZ0DzTS9JZGXsM?ext2=copy_link
```

The extension resolves it to:

```text
https://workbuddy-space-static.codebuddy.work/page/fqAaNqzcOZ0DzTS9JZGXsM/0/conversation-data.json
```

It then produces lightweight conversation Markdown without sending image base64 or bulky tool arguments into AI context.

## Security boundaries

V0.1 is intentionally not an unrestricted `curl` proxy. It:

- allows HTTP(S) only;
- rejects credential-bearing URLs;
- blocks localhost, common private/link-local targets, and cloud metadata hosts;
- **re-validates every redirect destination**;
- follows at most 5 redirects;
- caps each fetch at 12 MiB;
- times out after 25 seconds;
- redacts likely credential query parameters such as token, api_key, and secret from displayed source URLs;
- labels fetched content as untrusted data to reduce prompt-injection confusion.

A browser extension cannot perform the same post-DNS private-network validation as a controlled backend proxy, so V0.1 does not claim complete protection against every DNS-rebinding scenario. Do not expose it as a remotely callable arbitrary-URL proxy.

## Current limitations

- SPAs and heavily JavaScript-rendered pages may return sparse HTML when fetched directly. A future rendered-page mode can address this.
- PDFs, images, and Office files are downloaded, not OCR'd or converted to Markdown.
- V0.1 uses copy/save/upload to remain compatible with any web AI; it does **not yet inject content automatically into every AI site's input box**.
- Responses larger than 12 MiB are rejected.

## Tests

Requires Node.js 20+:

```bash
npm test
npm run check
```

V0.1 includes regression coverage for WorkBuddy parsing, large JSON, URL safety, redirects, malformed timestamps, encodings, and extension packaging.

## Adversarial self-review

At least six adversarial review rounds were performed. Each discovered issue was fixed and covered by regression tests. See:

[docs/ATTACK-REVIEW.md](./docs/ATTACK-REVIEW.md)

## License

MIT License. See [LICENSE](./LICENSE).
