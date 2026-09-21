import { describe, it, expect } from "vitest";
import {
  PUSH_BODY_MAX,
  PUSH_DEVICES,
  PUSH_DEVICE_PROFILES,
  PUSH_TITLE_MAX,
  charsPerLine,
  estimateTruncation,
  estimateVisibleChars,
  pushLengthWarnings,
} from "@/lib/notifications-v2/push-display";

/**
 * The push preview has to show where a phone puts the "…" (transcript §3.9).
 * These numbers are an approximation; the tests pin the behaviour of the model
 * (what fits, where it cuts, which hints fire), not exact pixel values.
 */

const { iphone, android } = PUSH_DEVICE_PROFILES;

describe("caps", () => {
  it("match send-push's MAX_TITLE and MAX_BODY", () => {
    expect(PUSH_TITLE_MAX).toBe(100);
    expect(PUSH_BODY_MAX).toBe(300);
  });
});

describe("PUSH_DEVICE_PROFILES", () => {
  it("has an iPhone and an Android profile", () => {
    expect(PUSH_DEVICES).toEqual(["iphone", "android"]);
    expect(iphone.id).toBe("iphone");
    expect(android.id).toBe("android");
  });

  it("fits the text column inside the card inside the screen", () => {
    for (const d of PUSH_DEVICES) {
      const p = PUSH_DEVICE_PROFILES[d];
      expect(p.contentWidth).toBeGreaterThan(150);
      expect(p.contentWidth).toBeLessThan(p.cardWidth);
      expect(p.cardWidth).toBeLessThanOrEqual(p.screenWidth);
    }
  });

  it("uses the line limits phones use", () => {
    // iOS lock screen: 1 title line, up to 4 body lines until expanded.
    expect(iphone.title.maxLines.collapsed).toBe(1);
    expect(iphone.body.maxLines.collapsed).toBe(4);
    // Android shade: 1 title line and 1 body line collapsed, ~7 body lines expanded.
    expect(android.title.maxLines).toEqual({ collapsed: 1, expanded: 1 });
    expect(android.body.maxLines).toEqual({ collapsed: 1, expanded: 7 });
    for (const d of PUSH_DEVICES) {
      const p = PUSH_DEVICE_PROFILES[d];
      expect(p.body.maxLines.expanded).toBeGreaterThanOrEqual(p.body.maxLines.collapsed);
      expect(p.title.maxLines.expanded).toBeGreaterThanOrEqual(p.title.maxLines.collapsed);
    }
  });

  it("gives realistic characters per line (roughly 30 to 45)", () => {
    for (const d of PUSH_DEVICES) {
      for (const part of ["title", "body"] as const) {
        const n = charsPerLine(PUSH_DEVICE_PROFILES[d], part);
        expect(n).toBeGreaterThanOrEqual(28);
        expect(n).toBeLessThanOrEqual(45);
      }
    }
  });
});

describe("estimateVisibleChars", () => {
  it("returns the whole length when the text fits", () => {
    expect(estimateVisibleChars("Booking confirmed", iphone, 1, "title")).toBe(17);
    expect(estimateVisibleChars("", android, 3)).toBe(0);
  });

  it("cuts the lead's example title on both phones, mid-word, before the end", () => {
    const title = "My name is Ghulam Muhyuddin, my name is Ghulam";
    for (const d of PUSH_DEVICES) {
      const p = PUSH_DEVICE_PROFILES[d];
      const t = estimateTruncation(title, p, p.title.maxLines.collapsed, "title");
      expect(t.truncated).toBe(true);
      expect(t.shown.endsWith("…")).toBe(true);
      expect(t.visibleChars).toBeLessThan(title.length);
      expect(t.visibleChars).toBe(charsPerLine(p, "title") - 1); // one glyph of room for "…"
    }
  });

  it("shows more with more lines, never more than the text", () => {
    const body = "Hi Jordan, your 2024 Toyota RAV4 is booked from 12 Oct to 19 Oct. Pick it up at 10:00 from our Market Street office.";
    let prev = 0;
    for (let lines = 1; lines <= 6; lines++) {
      const n = estimateVisibleChars(body, android, lines);
      expect(n).toBeGreaterThanOrEqual(prev);
      expect(n).toBeLessThanOrEqual(body.length);
      prev = n;
    }
    expect(prev).toBe(body.length);
  });

  it("wraps at spaces, so a later line starts at a word", () => {
    const words = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike";
    const firstLine = estimateVisibleChars(words, android, 1);
    const twoLines = estimateVisibleChars(words, android, 2);
    // The second line holds at least one full word more than the first.
    expect(twoLines - firstLine).toBeGreaterThan(5);
  });

  it("honours line breaks in the text", () => {
    const text = "line one\nline two\nline three";
    expect(estimateVisibleChars(text, android, 2)).toBe("line one\nline two".length);
    expect(estimateVisibleChars(text, android, 3)).toBe(text.length);
  });

  it("breaks a word longer than the line anywhere", () => {
    const long = "x".repeat(100);
    const cpl = charsPerLine(android, "body");
    expect(estimateVisibleChars(long, android, 2)).toBe(cpl + cpl - 1);
  });

  it("leaves the iPhone title less room than the body (the time sits on the title row)", () => {
    const tWidth = iphone.contentWidth - iphone.titleReserve;
    expect(tWidth).toBeLessThan(iphone.contentWidth);
    expect(charsPerLine(iphone, "title")).toBeLessThan(charsPerLine(iphone, "body"));
  });
});

describe("pushLengthWarnings", () => {
  it("says nothing for a short title and message", () => {
    expect(pushLengthWarnings({ title: "Booking confirmed", body: "Your RAV4 is booked." })).toEqual([]);
    expect(pushLengthWarnings({ title: "", body: "" })).toEqual([]);
    expect(pushLengthWarnings(null)).toEqual([]);
  });

  it("warns that a long title is usually cut off on phones", () => {
    const hints = pushLengthWarnings({ title: "My name is Ghulam Muhyuddin, my name is Ghulam", body: "" });
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatch(/^Titles over ~\d+ characters are usually cut off on phones\./);
  });

  it("reports the hard caps with the actual counts, counting trimmed text like send-push", () => {
    const hints = pushLengthWarnings({ title: "x".repeat(120), body: "word ".repeat(70) });
    expect(hints[0]).toBe("Titles are cut at 100 characters when sent. This one has 120.");
    expect(hints[1]).toBe("Messages are cut at 300 characters when sent. This one has 349.");
    expect(pushLengthWarnings({ title: "  " + "x".repeat(100) + "  ", body: "" }).join(" ")).not.toContain("cut at 100");
  });

  it("warns when an iPhone lock screen would cut the message", () => {
    const body = "word ".repeat(36).trim(); // ~180 characters
    const hints = pushLengthWarnings({ title: "Hi", body });
    expect(hints.some((h) => h.startsWith("An iPhone lock screen shows about"))).toBe(true);
  });

  it("warns when even an expanded Android notification would cut the message", () => {
    const body = "word ".repeat(55).trim(); // ~275 characters, under the 300 cap
    const hints = pushLengthWarnings({ title: "Hi", body });
    expect(hints.some((h) => h.startsWith("Even expanded, Android shows only about"))).toBe(true);
  });
});
