# Strategy-call confirmation media

The v2 confirmation funnel expects this exact public asset layout:

```text
strategy-call/
├── videos/
│   ├── 01-marketplace-dependency.mp4
│   ├── 02-drive247-system-walkthrough.mp4
│   ├── 03-frequently-asked-questions.mp4
│   └── 04-who-this-is-for.mp4
├── posters/
│   ├── 01-marketplace-dependency.webp
│   ├── 02-drive247-system-walkthrough.webp
│   ├── 03-frequently-asked-questions.webp
│   └── 04-who-this-is-for.webp
└── captions/
    ├── 01-marketplace-dependency.en.vtt
    ├── 02-drive247-system-walkthrough.en.vtt
    ├── 03-frequently-asked-questions.en.vtt
    └── 04-who-this-is-for.en.vtt
```

Before enabling `STRATEGY_CALL_CONFIRMATION_V2=true`:

- Supply all four approved H.264, 16:9, web-optimized MP4 files.
- Supply all four meaningful 1280×720 or larger WebP posters.
- Supply synchronized, human-checked English WebVTT captions.
- Add the approved verbatim transcripts to
  `src/lib/strategy-call/confirmation-content.ts`.
- Confirm every title, claim, pricing reference and CTA with the funnel owner.
- Run keyboard, mobile, slow-network and real GHL booking checks in staging.

For larger files, use the approved public media CDN instead and update only the
typed URLs in `confirmation-content.ts`. Do not commit huge uncompressed masters
or credentials.
