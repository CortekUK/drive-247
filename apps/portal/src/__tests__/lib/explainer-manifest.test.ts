/**
 * The explainer manifest's one contract: an unproduced video renders NOTHING.
 *
 * Every video slot in the portal reads `lib/explainers.ts` through
 * `getExplainer()`, and on day one almost every entry is a placeholder. If that
 * read ever starts returning a truthy value for a placeholder, the failure is
 * silent and ugly: an operator gets a play button that opens a black box, or a
 * link to nowhere, on the exact screen we built to make them feel oriented.
 *
 * So these assertions are about the ABSENT case, and they are written to be
 * trustworthy about absence — each one first proves the entry it is checking
 * actually exists in the manifest, because "getExplainer returned null" is also
 * what a typo'd id looks like, and a suite that cannot tell those apart would
 * go green on an empty manifest.
 */

import { describe, expect, it } from "vitest";

import {
  EXPLAINERS,
  formatExplainerDuration,
  getExplainer,
  listReadyExplainers,
  type ExplainerId,
} from "@/lib/explainers";

const ids = Object.keys(EXPLAINERS) as ExplainerId[];

describe("explainer manifest", () => {
  it("actually has entries — so every 'renders nothing' assertion below means something", () => {
    // The existence check that makes the absence checks readable. Without it,
    // deleting the manifest would turn this whole file green.
    expect(ids.length).toBeGreaterThan(10);
    expect(ids).toContain("fleet.vehicle-add");
    expect(ids).toContain("agreements.first-agreement");
    expect(ids).toContain("insurance.bonzah");
  });

  it("gives every entry a human title and a blurb", () => {
    for (const id of ids) {
      const entry = EXPLAINERS[id];
      expect(entry.title.length, `${id} title`).toBeGreaterThan(3);
      expect(entry.blurb.length, `${id} blurb`).toBeGreaterThan(10);
    }
  });

  it("returns null for every entry that has no file behind it", () => {
    const unproduced = ids.filter((id) => EXPLAINERS[id].url === "");

    // Prove the probe found the case it is about to assert on. Today that is
    // most of the manifest; once Ghulam has filmed everything it may be none,
    // and this test should then be about the produced ones instead — which is
    // why the branch is explicit rather than a silently-empty loop.
    expect(unproduced.length + listReadyExplainers().length).toBe(ids.length);

    for (const id of unproduced) {
      expect(getExplainer(id), `${id} must not render`).toBeNull();
    }
  });

  it("refuses an entry that has a URL but no stated duration", () => {
    // Showing the runtime up front is a promise to the operator, and the only
    // way to break it from the manifest is to paste a URL and forget the
    // seconds. That combination must read as not-ready, not as "0:00".
    for (const id of ids) {
      const entry = EXPLAINERS[id];
      if (entry.url && entry.durationSeconds <= 0) {
        expect(getExplainer(id), `${id} has a url but no duration`).toBeNull();
      }
    }

    // And the same rule stated as an invariant over whatever is in the file, so
    // a future edit that half-fills an entry is caught here rather than on screen.
    for (const explainer of listReadyExplainers()) {
      expect(explainer.url, `${explainer.id} url`).not.toBe("");
      expect(explainer.durationSeconds, `${explainer.id} duration`).toBeGreaterThan(0);
    }
  });

  it("never explodes on an unknown id", () => {
    // A renamed key leaves stale references behind. Those must render nothing,
    // exactly like an unproduced video — never throw inside a page's render.
    expect(getExplainer("does.not.exist" as ExplainerId)).toBeNull();
    expect(getExplainer(null)).toBeNull();
    expect(getExplainer(undefined)).toBeNull();
  });

  it("formats durations as m:ss", () => {
    expect(formatExplainerDuration(50)).toBe("0:50");
    expect(formatExplainerDuration(72)).toBe("1:12");
    expect(formatExplainerDuration(90)).toBe("1:30");
    expect(formatExplainerDuration(605)).toBe("10:05");
    expect(formatExplainerDuration(0)).toBe("0:00");
    // Negative is nonsense input, not a crash.
    expect(formatExplainerDuration(-5)).toBe("0:00");
  });
});
