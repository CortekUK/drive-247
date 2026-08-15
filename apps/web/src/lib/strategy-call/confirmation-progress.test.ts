import { describe, expect, it } from "vitest";
import {
  addWatchedRange,
  isVideoComplete,
  mergeWatchedRanges,
  sanitizeStoredRanges,
  watchedPercent,
} from "./confirmation-progress";

describe("confirmation video watched-range progress", () => {
  it("sorts and merges overlapping or adjacent watched ranges", () => {
    expect(
      mergeWatchedRanges([
        [8, 12],
        [0, 4],
        [3.9, 8.1],
        [20, 21],
      ]),
    ).toEqual([
      [0, 12],
      [20, 21],
    ]);
  });

  it("discards corrupt stored ranges without throwing", () => {
    expect(sanitizeStoredRanges("not-an-array")).toEqual([]);
    expect(
      sanitizeStoredRanges([
        [0, 5],
        [-1, 2],
        [4, Number.NaN],
        [8, 7],
        ["1", 3],
      ]),
    ).toEqual([[0, 5]]);
  });

  it("bounds the count and size of untrusted stored ranges", () => {
    const oversized = Array.from(
      { length: 600 },
      (_, index) => [index * 2, index * 2 + 1] as const,
    );
    oversized.unshift([0, 100_000]);
    const sanitized = sanitizeStoredRanges(oversized);

    expect(sanitized.length).toBeLessThanOrEqual(256);
    expect(sanitized.every(([, end]) => end <= 86_400)).toBe(true);
  });

  it("does not complete when a viewer seeks directly to the end", () => {
    const ranges = addWatchedRange([], 99, 100, 100);
    expect(watchedPercent(ranges, 100)).toBe(1);
    expect(isVideoComplete(ranges, 100, true)).toBe(false);
  });

  it("completes after at least 90% unique real coverage", () => {
    const ranges = mergeWatchedRanges([
      [0, 45],
      [45, 90],
    ]);
    expect(isVideoComplete(ranges, 100)).toBe(true);
  });

  it("accepts ended only with at least 80% real coverage", () => {
    expect(isVideoComplete([[0, 79.99]], 100, true)).toBe(false);
    expect(isVideoComplete([[0, 80]], 100, true)).toBe(true);
  });
});
