import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIRMATION_VIDEOS } from "./confirmation-content";

const PUBLIC_DIR = join(__dirname, "..", "..", "..", "public");
const asset = (publicPath: string) => join(PUBLIC_DIR, publicPath);

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

  it("does not label provisional copy as an approved transcript", () => {
    expect(CONFIRMATION_VIDEOS.every((video) => video.transcript === null)).toBe(true);
  });

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
