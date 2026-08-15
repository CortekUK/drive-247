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
└── captions/            ← still empty, see below
    ├── 01-marketplace-dependency.en.vtt
    ├── 02-drive247-system-walkthrough.en.vtt
    ├── 03-frequently-asked-questions.en.vtt
    └── 04-who-this-is-for.en.vtt
```

## Current state (2026-08-15)

Videos and posters are **supplied and live**. They were transcoded from the
1080p60 masters (2.9 GB total, ~38 Mbps) down to 76 MB: 720p30 for the three
talking-head parts and 1080p30 for the screen-share walkthrough, all H.264
high@4.0 with `+faststart` so playback starts before the file is downloaded.

Captions are **not** supplied. `captions` is `null` for all four entries in
`src/lib/strategy-call/confirmation-content.ts`, and the player renders no
`<track>` when it is null. This is deliberate: a `<track>` whose `.vtt` is
missing does not fire the media error event, so the player would advertise an
"English" caption menu containing zero cues — worse for a deaf viewer than an
honestly absent option. Do not point `captions` at a file until that file
exists.

The videos do carry burned-in on-screen subtitles, which is **not** a
substitute: burned-in text cannot be read by a screen reader, resized, or
restyled.

## Before enabling `STRATEGY_CALL_CONFIRMATION_V2=true`

- [x] Four approved H.264, 16:9, web-optimized MP4 files.
- [x] Four meaningful 1280×720-or-larger WebP posters.
- [ ] Synchronized, human-checked English WebVTT captions, then set the four
      `captions` fields back to their paths.
- [ ] Approved verbatim transcripts in `confirmation-content.ts`.
- [ ] Confirm every title, claim, pricing reference and CTA with the funnel owner.
- [ ] Keyboard, mobile, slow-network and real GHL booking checks in staging.

For larger files, use the approved public media CDN instead and update only the
typed URLs in `confirmation-content.ts`. Do not commit huge uncompressed masters
or credentials.
