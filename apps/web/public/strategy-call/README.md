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
└── captions/            ← supplied, machine-transcribed, unproofread
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

Captions are supplied but are **machine-transcribed and not yet human-checked**.
They were produced locally with faster-whisper `small.en` (word-level timings,
VAD, domain vocabulary primed so "Turo" and "Drive247" are not mangled), then
validated: every cue is at most two lines of ≤42 characters, timings are
monotonic and inside the media duration, and no cue is empty.

Eight cues were spot-checked against the videos' own burned-in subtitles, which
are the producer's wording and therefore ground truth. Seven matched; one did
not — the video says "there's **genuinely** no risk", ASR heard "generally" —
and that one was corrected by hand. **Assume other single-word errors of that
kind remain.** A human proofread against the burned-in text is still owed
before this counts as compliant with the spec's "human-checked" requirement.

The burned-in on-screen subtitles are **not** a substitute for the caption
track: burned-in text cannot be read by a screen reader, resized, or restyled.

If a caption file is ever removed, set that entry's `captions` back to `null`
rather than leaving a dangling path. A `<track>` whose `.vtt` 404s does not fire
the media error event, so the player would advertise an "English" caption menu
containing zero cues — worse for a deaf viewer than an honestly absent option.
`confirmation-content.test.ts` fails the build if a referenced file is missing.

## Regenerating the captions

```bash
uv venv /tmp/asr && VIRTUAL_ENV=/tmp/asr uv pip install faster-whisper
# extract 16 kHz mono wav per video, then transcribe with word_timestamps=True
# and initial_prompt priming Turo / Getaround / Drive247. Never truncate a cue
# to fit a line budget — split it into another cue instead.
```

## Before enabling `STRATEGY_CALL_CONFIRMATION_V2=true`

- [x] Four H.264, 16:9, web-optimized MP4 files.
- [x] Four meaningful 1280×720-or-larger WebP posters.
- [x] Synchronized English WebVTT captions, structurally validated.
- [x] Four transcripts in `confirmation-content.ts`, word-for-word equal to the
      captions and enforced by `confirmation-content.test.ts`.
- [x] Corrected the 23 meaning-changing transcription errors found by sampling
      each video's burned-in subtitles (see "Known state" below).
- [ ] **Human proofread of captions + transcripts** against the burned-in
      subtitles. Sampling found errors at a high enough rate that the
      unsampled remainder almost certainly holds more.
- [ ] **Two contradictions the funnel owner must resolve — these look like they
      are in the videos themselves, not the transcription:**
      the launch guarantee is "seven days" in video 3 but "2 weeks" in video 4,
      and the same $18k fee recovery is credited to "Douglas in Atlanta" in
      video 1 but to "Marcus" in video 3.
- [ ] Confirm every title, claim, pricing reference and CTA with the funnel owner.
- [ ] Keyboard, mobile, slow-network and real GHL booking checks in staging.

## Known state of the text (2026-08-15)

Four independent passes sampled the videos' burned-in subtitles — the
producer's own wording, and therefore ground truth — against our text: 380
frames for video 1, and 33/32/59 sample points for videos 2/3/4. They found 23
meaning-changing errors and 21 cosmetic ones. All 44 are corrected, including:

- "back from **our** platform" → "**a** platform". The original inverted the
  pitch: it read as the operator escaping Drive247.
- "having to **fap** about" → "**faff** about". Vulgar slang, in marketing copy.
- "**Bonsa**" → "**Bonzah**" (×2). The insurance partner's actual name.
- "you're actually **putting** in" → "**pulling** in". Reversed the direction of
  money in a profitability claim.
- "**You've** got one car and you're starting out" → "**If you've** got one car
  and you're just starting out". Lost conditional; asserted it about the reader.
- "booking on **our** own site" → "**her** own site". It is Sarah's testimonial.
- "So just **some irritates**" → "So just **send me a text**".

The page discloses that the transcript is auto-generated, and no UI string
calls it "approved" — the funnel owner has not approved it.

For larger files, use the approved public media CDN instead and update only the
typed URLs in `confirmation-content.ts`. Do not commit huge uncompressed masters
or credentials.
