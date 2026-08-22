# Third-party notices / 第三方依赖说明

## Mozilla Readability

Link2Context V0.6 vendors a pinned copy of Mozilla Readability for article-region extraction.

- Project: Mozilla Readability
- Upstream repository: `mozilla/readability`
- Pinned commit: `ab4027a8b37669745016869a37a504727992b2ba`
- Vendored source: `extension/vendor/Readability.js`
- Vendored license: `extension/vendor/READABILITY-LICENSE.md`
- License: Apache License 2.0

Link2Context uses Readability to identify the likely article/main-content region and metadata. Link2Context's own V0.6 structured DOM walker, provenance/trust model, media acquisition, target delivery, and browser reliability logic are separate project code.

Readability output is treated as untrusted external content and is not executed as trusted script/instructions by Link2Context.
