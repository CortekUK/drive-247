import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIRMATION_VIDEOS } from "./confirmation-content";

const PUBLIC_DIR = join(__dirname, "..", "..", "..", "public");
const asset = (publicPath: string) => join(PUBLIC_DIR, publicPath);

const CUE_TIMING = /^(\d{2}):(\d{2}):(\d{2}\.\d{3}) --> (\d{2}):(\d{2}):(\d{2}\.\d{3})$/;
const toSeconds = (h: string, m: string, s: string) =>
  Number(h) * 3600 + Number(m) * 60 + Number(s);

type Cue = { start: number; end: number; lines: string[] };

function parseVtt(source: string): Cue[] {
  const lines = source.split("\n");
  const cues: Cue[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = CUE_TIMING.exec(lines[i] ?? "");
    if (!match) continue;
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== "") {
      body.push(lines[j]);
      j += 1;
    }
    cues.push({
      start: toSeconds(match[1], match[2], match[3]),
      end: toSeconds(match[4], match[5], match[6]),
      lines: body,
    });
    i = j;
  }
  return cues;
}

describe("confirmation funnel video configuration", () => {
  it("contains exactly four uniquely ordered videos", () => {
    expect(CONFIRMATION_VIDEOS).toHaveLength(4);
    expect(CONFIRMATION_VIDEOS.map((video) => video.order)).toEqual([1, 2, 3, 4]);
    expect(new Set(CONFIRMATION_VIDEOS.map((video) => video.slug)).size).toBe(4);
  });

  it("keeps the approved funnel order", () => {
    expect(CONFIRMATION_VIDEOS.map((video) => video.slug)).toEqual([
      "marketplace-control",
      "system-walkthrough",
      "faqs",
      "who-its-for",
    ]);
  });

  it("ships a non-empty transcript for every video", () => {
    for (const video of CONFIRMATION_VIDEOS) {
      expect(video.transcript, `${video.slug} has no transcript`).not.toBeNull();
      expect(video.transcript!.length).toBeGreaterThan(0);
      for (const paragraph of video.transcript!) {
        expect(paragraph.trim()).not.toBe("");
      }
    }
  });

  // The transcript is the accessible equivalent of the audio, so it has to be
  // the whole audio. It is derived from the caption cues, and the generator
  // that produced it once dropped every word past a length budget — so assert
  // the two still carry the same words rather than trusting that they do.
  it.each(CONFIRMATION_VIDEOS.map((video) => [video.slug, video] as const))(
    "%s transcript covers the same words as its captions",
    (_slug, video) => {
      const words = (text: string) =>
        text.toLowerCase().replace(/\s+/g, " ").trim().split(" ").filter(Boolean);

      const captionText = readFileSync(asset(video.captions!), "utf8")
        .split("\n")
        .filter((line) => line && line !== "WEBVTT" && !line.includes("-->"))
        .join(" ");

      const fromCaptions = words(captionText);
      const fromTranscript = words(video.transcript!.join(" "));

      expect(fromTranscript.length).toBe(fromCaptions.length);
      expect(fromTranscript.join(" ")).toBe(fromCaptions.join(" "));
    },
  );

  // Every referenced asset must exist. A missing .mp4 or poster is a visible
  // break, but a missing .vtt is worse: a <track> whose file 404s does not fire
  // the media error event, so the player would silently offer an "English"
  // caption menu with zero cues. That is why `captions` must be null until the
  // file is actually on disk — and why this test refuses a path that isn't.
  it.each(CONFIRMATION_VIDEOS.map((video) => [video.slug, video] as const))(
    "%s references only assets that exist on disk",
    (_slug, video) => {
      expect(existsSync(asset(video.src))).toBe(true);
      expect(existsSync(asset(video.poster))).toBe(true);
      if (video.captions !== null) {
        expect(existsSync(asset(video.captions))).toBe(true);
      }
    },
  );

  it("serves posters as WebP and videos as MP4", () => {
    for (const video of CONFIRMATION_VIDEOS) {
      expect(video.poster.endsWith(".webp")).toBe(true);
      expect(video.src.endsWith(".mp4")).toBe(true);
    }
  });
});

// The captions are machine-transcribed, so the risk is not a missing file (the
// test above covers that) but a malformed or unreadable one. A caption that
// overflows two lines covers the video; a reversed or out-of-order timing makes
// the track unusable. An earlier generator silently truncated every cue past 84
// characters, dropping whole words mid-sentence — these assertions exist so that
// class of mistake cannot reach a viewer again.
describe("confirmation funnel captions", () => {
  const withCaptions = CONFIRMATION_VIDEOS.filter(
    (video): video is (typeof CONFIRMATION_VIDEOS)[number] & { captions: string } =>
      video.captions !== null,
  );

  it("has a caption track for every video", () => {
    expect(withCaptions).toHaveLength(CONFIRMATION_VIDEOS.length);
  });

  it.each(withCaptions.map((video) => [video.slug, video] as const))(
    "%s is well-formed WebVTT",
    (_slug, video) => {
      const source = readFileSync(asset(video.captions), "utf8");
      expect(source.startsWith("WEBVTT")).toBe(true);

      const cues = parseVtt(source);
      expect(cues.length).toBeGreaterThan(0);

      let previousStart = -1;
      for (const cue of cues) {
        expect(cue.end).toBeGreaterThan(cue.start);
        expect(cue.start).toBeGreaterThanOrEqual(previousStart);
        previousStart = cue.start;

        expect(cue.lines.length).toBeGreaterThan(0);
        expect(cue.lines.length).toBeLessThanOrEqual(2);
        for (const line of cue.lines) {
          expect(line.trim()).not.toBe("");
          expect(line.length).toBeLessThanOrEqual(42);
        }
      }
    },
  );
});
