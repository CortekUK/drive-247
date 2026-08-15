import { describe, expect, it } from "vitest";
import { CONFIRMATION_VIDEOS } from "./confirmation-content";

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
});
