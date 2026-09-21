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
 * The numbers are an approximation by design, so these tests pin the BEHAVIOUR
 * of the model — what fits, where it cuts, which hints fire — and the two caps
 * that are exact because `send-push` applies them
 * (supabase/functions/send-push/index.ts MAX_TITLE / MAX_BODY).
 */

const { iphone, android } = PUSH_DEVICE_PROFILES;

/** Exactly `n` characters of word-shaped text, never ending in a space. */
function words(n: number): string {
  let s = "";
  while (s.length < n) s += (s ? " " : "") + "word";
  return s.slice(0, n).replace(/\s$/, "x");
}

describe("caps", () => {
  it("match send-push's MAX_TITLE and MAX_BODY", () => {
    expect(PUSH_TITLE_MAX).toBe(100);
    expect(PUSH_BODY_MAX).toBe(300);
  });
});

describe("device profiles", () => {
  it("cover an iPhone and an Android phone", () => {
    expect(PUSH_DEVICES).toEqual(["iphone", "android"]);
    expect(iphone.id).toBe("iphone");
    expect(android.id).toBe("android");
  });

  it("fit the text column inside the card inside the screen", () => {
    for (const d of PUSH_DEVICES) {
      const p = PUSH_DEVICE_PROFILES[d];
      expect(p.contentWidth).toBeGreaterThan(150);
      expect(p.contentWidth).toBeLessThan(p.cardWidth);
      expect(p.cardWidth).toBeLessThanOrEqual(p.screenWidth);
    }
  });

  it("show at least as much expanded as collapsed", () => {
    for (const d of PUSH_DEVICES) {
      const p = PUSH_DEVICE_PROFILES[d];
      expect(p.body.maxLines.expanded).toBeGreaterThanOrEqual(p.body.maxLines.collapsed);
      expect(p.title.maxLines.expanded).toBeGreaterThanOrEqual(p.title.maxLines.collapsed);
    }
  });
});

describe("charsPerLine", () => {
  it("gives the title's first line less room when the time sits beside it", () => {
    expect(iphone.titleReserve).toBeGreaterThan(0);
    expect(charsPerLine(iphone, "title", true)).toBeLessThan(charsPerLine(iphone, "title", false));
  });

  it("gives every title line the same room when nothing sits beside it", () => {
    expect(android.titleReserve).toBe(0);
    expect(charsPerLine(android, "title", true)).toBe(charsPerLine(android, "title", false));
  });

  it("never returns less than one character", () => {
    const hostile = { ...android, contentWidth: 1 };
    expect(charsPerLine(hostile, "body")).toBeGreaterThanOrEqual(1);
  });

  it("fits fewer characters on the narrower phone", () => {
    expect(charsPerLine(android, "body")).toBeLessThan(charsPerLine(iphone, "body"));
  });
});

describe("estimateVisibleChars", () => {
  it("shows all of a text that fits", () => {
    const short = "Paid";
    expect(estimateVisibleChars(short, iphone, 4)).toBe(short.length);
  });

  it("shows none of an empty text", () => {
    expect(estimateVisibleChars("", iphone, 4)).toBe(0);
  });

  it("stops at a line break when there is no line left for what follows", () => {
    expect(estimateVisibleChars("one\ntwo", iphone, 1)).toBe(3);
    expect(estimateVisibleChars("one\ntwo", iphone, 2)).toBe("one\ntwo".length);
  });

  it("leaves room for the '…' when it cuts mid-word", () => {
    const cpl = charsPerLine(android, "body");
    const oneLongWord = "x".repeat(cpl * 3);
    expect(estimateVisibleChars(oneLongWord, android, 1)).toBe(cpl - 1);
  });

  it("moves a word that does not fit onto the next line instead of splitting it", () => {
    const cpl = charsPerLine(iphone, "body");
    // "short" then a word far too long for the rest of line 1: the long word has
    // to start line 2, so line 1 shows only "short" and the two lines together
    // show well under the 2 x cpl a character-counting model would report.
    const wrapped = estimateVisibleChars("short " + "L".repeat(cpl + 10) + " tail", iphone, 2);
    const unbroken = estimateVisibleChars("L".repeat(cpl * 4), iphone, 2);
    expect(wrapped).toBeLessThan(unbroken);
    expect(wrapped).toBeLessThan(cpl * 2);
  });

  it("never shows less with more lines", () => {
    const text = words(400);
    let previous = 0;
    for (const lines of [1, 2, 3, 4, 8, 12]) {
      const visible = estimateVisibleChars(text, iphone, lines);
      expect(visible).toBeGreaterThanOrEqual(previous);
      expect(visible).toBeLessThanOrEqual(text.length);
      previous = visible;
    }
  });

  it("shows less on the phone with the narrower, shorter card", () => {
    const text = words(300);
    const onIphone = estimateVisibleChars(text, iphone, iphone.body.maxLines.collapsed);
    const onAndroid = estimateVisibleChars(text, android, android.body.maxLines.collapsed);
    expect(onAndroid).toBeLessThan(onIphone);
  });
});

describe("estimateTruncation", () => {
  it("adds the '…' only when it cut something, and never leaves a space before it", () => {
    const text = words(300);
    const cut = estimateTruncation(text, android, 1);
    expect(cut.truncated).toBe(true);
    expect(cut.shown.endsWith("…")).toBe(true);
    expect(cut.shown).not.toMatch(/\s…$/);
    expect(text.startsWith(cut.shown.slice(0, -1))).toBe(true);

    const whole = estimateTruncation("Paid", iphone, 4);
    expect(whole.truncated).toBe(false);
    expect(whole.shown).toBe("Paid");
    expect(whole.visibleChars).toBe(4);
  });
});

describe("pushLengthWarnings", () => {
  it("says nothing about an empty template", () => {
    expect(pushLengthWarnings(null)).toEqual([]);
    expect(pushLengthWarnings({ title: "", body: "" })).toEqual([]);
  });

  it("says nothing about a short title and a short message", () => {
    expect(pushLengthWarnings({ title: "Payment received", body: words(120) })).toEqual([]);
  });

  it("reports the hard caps first, with the real counts", () => {
    const hints = pushLengthWarnings({ title: "T".repeat(150), body: words(400) });
    expect(hints[0]).toContain(String(PUSH_TITLE_MAX));
    expect(hints[0]).toContain("150");
    expect(hints[1]).toContain(String(PUSH_BODY_MAX));
    expect(hints[1]).toContain("400");
  });

  it("counts the way send-push counts, ignoring space at the ends", () => {
    expect(pushLengthWarnings({ title: "  " + "T".repeat(PUSH_TITLE_MAX) + "  ", body: "" }).join(" ")).not.toContain(
      "cut at 100 characters when sent",
    );
    expect(pushLengthWarnings({ title: "T".repeat(PUSH_TITLE_MAX + 1), body: "" }).join(" ")).toContain(
      "cut at 100 characters when sent",
    );
  });

  it("warns that a long title is cut on a phone long before the 100-character cap", () => {
    const title = words(60);
    expect(title.length).toBeLessThan(PUSH_TITLE_MAX);
    const hints = pushLengthWarnings({ title, body: "" });
    expect(hints.some((h) => h.includes("Put the key words first"))).toBe(true);
  });

  it("warns about Android when even the expanded card cannot show the whole message", () => {
    const hints = pushLengthWarnings({ title: "Update", body: words(280) });
    expect(hints.some((h) => h.includes("Android"))).toBe(true);
    expect(hints.some((h) => h.includes("iPhone"))).toBe(false);
  });

  it("warns about the iPhone lock screen when only that one cuts the message", () => {
    const hints = pushLengthWarnings({ title: "Update", body: words(200) });
    expect(hints.some((h) => h.includes("iPhone"))).toBe(true);
    expect(hints.some((h) => h.includes("Android"))).toBe(false);
  });
});
