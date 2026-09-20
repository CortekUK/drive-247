/**
 * The v2 Branding limits and helpers (lib/appearance/logo.ts, presets.ts):
 * what each logo slot accepts, the size and shape checks, the geometry used to
 * draw a file, SVG sizing, the upload file name, and the five brand colours.
 * Every expected value is worked out by hand in the comment beside it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ uploads: [] as { path: string; contentType?: string }[] }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: async (path: string, _blob: Blob, options: { contentType?: string }) => {
          storage.uploads.push({ path, contentType: options.contentType });
          return { error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
      }),
    },
  },
}));

import {
  BRAND_MARK_FALLBACK_INITIALS,
  BRAND_MARK_FONT_STACK,
  BRAND_MARK_PX,
  brandMarkDataUrl,
  brandMarkPaint,
  clearBrandMarkCache,
  containInSquare,
  fitWithinEdge,
  LARGE_LOGO_ACCEPT,
  LOGO_MAX_BYTES,
  LOGO_SLOT_NAMES,
  logoBestResultsText,
  logoFileProblem,
  logoFormatOf,
  logoHelpText,
  logoSizeProblem,
  logoSlotNoun,
  parseSvgSize,
  PLATFORM_TAB_ICON,
  resolveBrandIcon,
  SMALL_LOGO_ACCEPT,
  uploadLogoBlob,
  withSvgSize,
} from "@/lib/appearance/logo";
import { V2_BRAND_PRESETS, V2_DEFAULT_BRAND_COLOR, V2_DEFAULT_BRAND_NAME } from "@/lib/appearance/presets";
import { judgeBrandColor } from "@/lib/appearance/color";
import { getBrandInitials } from "@/components/shared/layout/brand-logo";
import { expectedMarkUrl, installCanvas, type CanvasStub } from "../helpers/canvas-stub";

describe("logo limits", () => {
  it("caps a logo at 10 MB (10 × 1024 × 1024 = 10,485,760 bytes)", () => {
    expect(LOGO_MAX_BYTES).toBe(10_485_760);
    expect(logoFileProblem("large", { name: "a.png", type: "image/png", size: 10_485_760 })).toBeNull();
    expect(logoFileProblem("large", { name: "a.png", type: "image/png", size: 10_485_761 })).toContain("This file is 10.1 MB.");
    // 15,000,000 / 1,048,576 = 14.305 MB, rounded up to one decimal: 14.4.
    expect(logoFileProblem("small", { name: "a.png", type: "image/png", size: 15_000_000 })).toContain("This file is 14.4 MB.");
    expect(logoFileProblem("small", { name: "a.png", type: "image/png", size: 0 })).toBe("This file is empty. Choose the logo file again.");
  });

  it("knows a file by its type, and by its extension only when the type is missing", () => {
    expect(logoFormatOf({ name: "favicon.ico", type: "" })).toBe("ICO");
    expect(logoFormatOf({ name: "favicon.ico", type: "image/vnd.microsoft.icon" })).toBe("ICO");
    expect(logoFormatOf({ name: "LOGO.JPEG", type: "" })).toBe("JPG");
    expect(logoFormatOf({ name: "mark.svg", type: "application/octet-stream" })).toBe("SVG");
    expect(logoFormatOf({ name: "logo.png", type: "image/gif" })).toBeNull(); // a renamed GIF
    expect(logoFormatOf({ name: "logo.bmp", type: "" })).toBeNull();
  });

  it("the accept lists match the slots: ICO for the small logo only", () => {
    expect(SMALL_LOGO_ACCEPT).toBe(
      ".png,image/png,.webp,image/webp,.jpg,.jpeg,image/jpeg,.svg,image/svg+xml,.ico,image/x-icon,image/vnd.microsoft.icon",
    );
    expect(LARGE_LOGO_ACCEPT).toBe(".png,image/png,.webp,image/webp,.jpg,.jpeg,image/jpeg,.svg,image/svg+xml");
    expect(logoFileProblem("large", { name: "f.ico", type: "image/x-icon", size: 100 })).toBe(
      "We can't use this type of file. Upload a PNG, WebP, JPG or SVG file.",
    );
    expect(logoFileProblem("small", { name: "f.ico", type: "image/x-icon", size: 100 })).toBeNull();
  });

  it("square icon: 128 to 4096 px a side, and square within 0.9 to 1.1", () => {
    expect(logoSizeProblem("small", { width: 128, height: 128, vector: false })).toBeNull();
    expect(logoSizeProblem("small", { width: 128, height: 127, vector: false })?.kind).toBe("too-small");
    // 512 / 569 = 0.8998, just under 0.9; 512 / 568 = 0.9014, just over.
    expect(logoSizeProblem("small", { width: 512, height: 569, vector: false })?.kind).toBe("not-square");
    expect(logoSizeProblem("small", { width: 512, height: 568, vector: false })).toBeNull();
    // 1.1 × 500 = 550 exactly is allowed; 551 / 500 = 1.102 is not.
    expect(logoSizeProblem("small", { width: 550, height: 500, vector: false })).toBeNull();
    expect(logoSizeProblem("small", { width: 551, height: 500, vector: false })?.kind).toBe("not-square");
    // The top of the range: 4096 a side is allowed, 4097 either way is not.
    expect(logoSizeProblem("small", { width: 4096, height: 4096, vector: false })).toBeNull();
    expect(logoSizeProblem("small", { width: 4097, height: 4000, vector: false })?.kind).toBe("too-large");
    expect(logoSizeProblem("small", { width: 4000, height: 4097, vector: false })?.kind).toBe("too-large");
    // Too big AND not square (5000 / 2000 = 2.5): the size is the problem to fix first,
    // so no "Fit into a square" offer for a file we would refuse anyway.
    expect(logoSizeProblem("small", { width: 5000, height: 2000, vector: false })?.kind).toBe("too-large");
    // An SVG has no pixel size, so neither end applies, but its shape still counts.
    expect(logoSizeProblem("small", { width: 16, height: 16, vector: true })).toBeNull();
    expect(logoSizeProblem("small", { width: 9000, height: 9000, vector: true })).toBeNull();
    expect(logoSizeProblem("small", { width: 32, height: 16, vector: true })?.kind).toBe("not-square");
  });

  it("full logo: 400 to 6000 px wide, 100 to 3000 px tall, between 1:1 and 8:1", () => {
    expect(logoSizeProblem("large", { width: 400, height: 100, vector: false })).toBeNull(); // 4:1
    expect(logoSizeProblem("large", { width: 400, height: 400, vector: false })).toBeNull(); // 1:1
    expect(logoSizeProblem("large", { width: 800, height: 100, vector: false })).toBeNull(); // 8:1
    expect(logoSizeProblem("large", { width: 801, height: 100, vector: false })?.kind).toBe("too-wide");
    expect(logoSizeProblem("large", { width: 400, height: 99, vector: false })?.kind).toBe("too-small");
    expect(logoSizeProblem("large", { width: 400, height: 401, vector: false })?.kind).toBe("too-tall");
    expect(logoSizeProblem("large", { width: 120, height: 30, vector: true })).toBeNull();
    // The top of the range. 6000 × 3000 is 2:1 and 6000 × 750 is 8:1, both allowed.
    expect(logoSizeProblem("large", { width: 6000, height: 3000, vector: false })).toBeNull();
    expect(logoSizeProblem("large", { width: 6000, height: 750, vector: false })).toBeNull();
    // 6001 × 3000 is 2.0003:1, a fine shape: only the width is out.
    expect(logoSizeProblem("large", { width: 6001, height: 3000, vector: false })?.kind).toBe("too-large");
    // 3001 × 3001 is 1:1: only the height is out.
    expect(logoSizeProblem("large", { width: 3001, height: 3001, vector: false })?.kind).toBe("too-large");
    expect(logoSizeProblem("large", { width: 12000, height: 3000, vector: true })).toBeNull();
  });

  it("every end of every range, one step inside and one step outside", () => {
    // File size: 1 byte is the smallest real file, 0 is empty; 10,485,760 is the cap.
    const file = (size: number) => logoFileProblem("small", { name: "a.png", type: "image/png", size });
    expect(file(1)).toBeNull();
    expect(file(0)).not.toBeNull();
    expect(file(10_485_760)).toBeNull();
    expect(file(10_485_761)).not.toBeNull();

    // Square icon, each side on its own: 128 and 4096 are in, 127 and 4097 are out.
    // Width and height stay within 0.9 to 1.1 of each other (127 / 128 = 0.992,
    // 4097 / 4096 = 1.0002), so only the size can be what is wrong.
    const small = (width: number, height: number) => logoSizeProblem("small", { width, height, vector: false });
    expect(small(128, 128)).toBeNull();
    expect(small(127, 128)?.kind).toBe("too-small");
    expect(small(128, 127)?.kind).toBe("too-small");
    expect(small(4096, 4096)).toBeNull();
    expect(small(4097, 4096)?.kind).toBe("too-large");
    expect(small(4096, 4097)?.kind).toBe("too-large");
    // The message names the file's own size and the rule it broke.
    expect(small(127, 128)!.message).toBe(
      "This image is 127 × 128 px. The square icon needs to be at least 128 × 128 px, and 512 × 512 px looks sharpest.",
    );

    // Full logo width 400 to 6000 (height 400 keeps it 1:1 at the low end).
    const large = (width: number, height: number) => logoSizeProblem("large", { width, height, vector: false });
    expect(large(400, 400)).toBeNull();
    expect(large(399, 100)?.kind).toBe("too-small");
    expect(large(6000, 1000)).toBeNull(); // 6:1
    expect(large(6001, 1000)?.kind).toBe("too-large"); // 6.001:1, a fine shape
    // Height 100 to 3000.
    expect(large(400, 100)).toBeNull(); // 4:1
    expect(large(400, 99)?.kind).toBe("too-small");
    expect(large(3000, 3000)).toBeNull(); // 1:1
    expect(large(3001, 3001)?.kind).toBe("too-large"); // 1:1, only the height is out
    expect(large(399, 100)!.message).toBe(
      "This image is 399 × 100 px. The full logo needs to be at least 400 px wide and 100 px tall.",
    );

    // Shape 1:1 to 8:1. 1000 × 1000 is 1:1 (in), 1000 × 1001 is taller than wide (out);
    // 1600 × 200 is 8:1 (in), 1601 × 200 is 8.005:1 (out).
    expect(large(1000, 1000)).toBeNull();
    expect(large(1000, 1001)?.kind).toBe("too-tall");
    expect(large(1600, 200)).toBeNull();
    expect(large(1601, 200)?.kind).toBe("too-wide");
  });

  it("names the slots Square icon and Full logo in every message, never small, large or favicon", () => {
    expect(LOGO_SLOT_NAMES).toEqual({ small: "Square icon", large: "Full logo" });
    expect(logoSlotNoun("small")).toBe("square icon");
    expect(logoSlotNoun("large")).toBe("full logo");
    const messages = [
      logoSizeProblem("small", { width: 100, height: 100, vector: false })!.message,
      logoSizeProblem("small", { width: 5000, height: 5000, vector: false })!.message,
      logoSizeProblem("small", { width: 600, height: 300, vector: false })!.message,
      logoSizeProblem("large", { width: 300, height: 100, vector: false })!.message,
      logoSizeProblem("large", { width: 7000, height: 1000, vector: false })!.message,
      logoSizeProblem("large", { width: 500, height: 600, vector: false })!.message,
      logoSizeProblem("large", { width: 900, height: 100, vector: false })!.message,
      logoHelpText("small"),
      logoHelpText("large"),
      logoBestResultsText(),
    ];
    for (const message of messages) expect(message.toLowerCase()).not.toMatch(/small logo|large logo|favicon/);
    // Each size message names the file's own pixel size.
    expect(messages[1]).toBe(
      "This image is 5000 × 5000 px. The square icon can be at most 4096 × 4096 px. Save a smaller copy (512 × 512 px is best) and try again.",
    );
    expect(messages[4]).toBe(
      "This image is 7000 × 1000 px. The full logo can be at most 6000 px wide and 3000 px tall. Save a smaller copy (1200 px wide is plenty) and try again.",
    );
  });

  it("builds the help lines and the best-results line from the limits", () => {
    expect(logoHelpText("small")).toBe("PNG, WebP, JPG, SVG or ICO · up to 10 MB · square, 128 to 4096 px a side");
    expect(logoHelpText("large")).toBe("PNG, WebP, JPG or SVG · up to 10 MB · 400 to 6000 px wide, 100 to 3000 px tall");
    expect(logoBestResultsText()).toBe(
      "Best results: a PNG with a transparent background. Square icon at least 512 × 512 px; full logo at least 1200 px wide.",
    );
  });
});

describe("drawing geometry", () => {
  it("only shrinks a large logo whose longest edge is over 1200 px", () => {
    expect(fitWithinEdge(1000, 250, 1200)).toEqual({ width: 1000, height: 250 });
    expect(fitWithinEdge(1200, 300, 1200)).toEqual({ width: 1200, height: 300 });
    // 2400 × 600 at 0.5 = 1200 × 300.
    expect(fitWithinEdge(2400, 600, 1200)).toEqual({ width: 1200, height: 300 });
    // 3000 × 700 at 0.4 = 1200 × 280.
    expect(fitWithinEdge(3000, 700, 1200)).toEqual({ width: 1200, height: 280 });
  });

  it("centres a non-square image whole inside the 512 px square", () => {
    // 300 × 200 scaled by 512 / 300: 512 × 341.33, with (512 - 341.33) / 2 = 85.33 above and below.
    const at = containInSquare(300, 200, 512);
    expect(at.x).toBe(0);
    expect(at.width).toBe(512);
    expect(at.height).toBeCloseTo(341.333, 3);
    expect(at.y).toBeCloseTo(85.333, 3);
    // A square fills it exactly.
    expect(containInSquare(128, 128, 512)).toEqual({ x: 0, y: 0, width: 512, height: 512 });
  });
});

describe("SVG sizing", () => {
  it("reads width and height, else the viewBox, keeping the viewBox's shape", () => {
    expect(parseSvgSize('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 60"><path/></svg>')).toEqual({ width: 240, height: 60 });
    expect(parseSvgSize('<svg width="100" height="50" viewBox="0 0 10 5">')).toEqual({ width: 100, height: 50 });
    expect(parseSvgSize('<svg width="120px" height="40px">')).toEqual({ width: 120, height: 40 });
    // Width 300 with a 120 × 40 viewBox: 300 × 40 / 120 = 100 tall.
    expect(parseSvgSize('<svg width="300" viewBox="0 0 120 40">')).toEqual({ width: 300, height: 100 });
    // Relative sizes say nothing about pixels; the viewBox does.
    expect(parseSvgSize('<svg width="100%" height="100%" viewBox="0 0 64 64">')).toEqual({ width: 64, height: 64 });
    // stroke-width is not width.
    expect(parseSvgSize('<svg stroke-width="2">')).toBeNull();
    expect(parseSvgSize("<html></html>")).toBeNull();
  });

  it("writes an explicit px size, adding a viewBox when there is none", () => {
    expect(withSvgSize('<svg viewBox="0 0 24 24" width="1em"><path/></svg>', 24, 24)).toBe(
      '<svg width="24" height="24" viewBox="0 0 24 24"><path/></svg>',
    );
    expect(withSvgSize('<svg width="10" height="5"></svg>', 10, 5)).toBe('<svg width="10" height="5" viewBox="0 0 10 5"></svg>');
  });
});

describe("uploadLogoBlob", () => {
  beforeEach(() => {
    storage.uploads = [];
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
  });
  afterEach(() => vi.restoreAllMocks());

  it("names the file after its type, under the tenant's folder", async () => {
    await uploadLogoBlob(new Blob(["a"], { type: "image/png" }), "t1", "favicon");
    await uploadLogoBlob(new Blob(["a"], { type: "image/jpeg" }), "t1", "logo");
    await uploadLogoBlob(new Blob(["a"], { type: "image/webp" }), "t1", "logo");
    const url = await uploadLogoBlob(new Blob(["a"], { type: "image/svg+xml" }), "t1", "logo");
    expect(storage.uploads).toEqual([
      { path: "t1/favicon-1700000000000.png", contentType: "image/png" },
      { path: "t1/logo-1700000000000.jpg", contentType: "image/jpeg" },
      { path: "t1/logo-1700000000000.webp", contentType: "image/webp" },
      { path: "t1/logo-1700000000000.svg", contentType: "image/svg+xml" },
    ]);
    expect(url).toBe("https://cdn.test/t1/logo-1700000000000.svg");
  });
});

describe("v2 brand colours", () => {
  it('are exactly Default, Blue, Teal, Rose and Graphite: the default is called "Default", never by its hue', () => {
    expect(V2_DEFAULT_BRAND_COLOR).toBe("#442DD7");
    expect(V2_DEFAULT_BRAND_NAME).toBe("Default");
    expect(V2_BRAND_PRESETS.map((p) => [p.name, p.hex])).toEqual([
      ["Default", "#442DD7"],
      ["Blue", "#2563EB"],
      ["Teal", "#0F766E"],
      ["Rose", "#BE123C"],
      ["Graphite", "#1E293B"],
    ]);
  });

  it("each carries white text at 4.5:1 or better, so none shows a warning", () => {
    // Hand-computed WCAG ratios against white: 8.07, 5.17, 5.47, 6.29, 14.63.
    const expected = [8.07, 5.17, 5.47, 6.29, 14.63];
    V2_BRAND_PRESETS.forEach((preset, i) => {
      const verdict = judgeBrandColor(preset.hex)!;
      expect(verdict.grade).toBe("excellent");
      expect(verdict.foreground).toBe("#FFFFFF");
      expect(verdict.ratio).toBeCloseTo(expected[i], 1);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* What the browser tab and the sidebar badge show                             */
/*                                                                             */
/* One chain, `resolveBrandIcon`, so the picture in Settings › Branding and     */
/* the real tab cannot disagree:                                               */
/*                                                                             */
/*   square icon -> a mark drawn from the name's initials -> the platform icon  */
/*                                                                             */
/* The full logo is deliberately NOT a step: the two slots are independent.     */
/* -------------------------------------------------------------------------- */

describe("the tab icon chain", () => {
  let canvas: CanvasStub | null = null;

  beforeEach(() => {
    // The drawn marks are cached for the life of the module: without this a
    // test that stubs a canvas hands its drawing to the one that stubs none.
    clearBrandMarkCache();
  });

  afterEach(() => {
    canvas?.restore();
    canvas = null;
    vi.restoreAllMocks();
  });

  it("takes the square icon when there is one, trimmed, whatever else exists", () => {
    expect(resolveBrandIcon("  https://cdn.test/icon.png  ", "Northwind Rentals")).toEqual({
      kind: "icon",
      src: "https://cdn.test/icon.png",
    });
  });

  it("has no place for a full logo: the chain takes the icon and the name, nothing else", () => {
    // Two required parameters (`options` has a default and does not count).
    // A logo_url has nowhere to enter, which is the point: a wordmark with the
    // company name in it must never stand in for a 16px tab icon.
    expect(resolveBrandIcon.length).toBe(2);
    // A blank, whitespace-only or missing icon all mean "no square icon".
    for (const empty of [null, undefined, "", "   "]) {
      expect(resolveBrandIcon(empty, "Northwind Rentals", { generate: false }).kind).toBe("initials");
    }
  });

  it("falls to the name's initials, by the sidebar badge's own rule", () => {
    // getBrandInitials: two or more words -> first letters (up to 3); one word
    // -> its first two letters. "Northwind Rentals" -> NR, "Northwind" -> NO.
    expect(getBrandInitials("Northwind Rentals")).toBe("NR");
    expect(resolveBrandIcon(null, "Northwind Rentals", { generate: false }).initials).toBe("NR");
    expect(resolveBrandIcon(null, "Northwind", { generate: false }).initials).toBe("NO");
    // A name with no letters at all gets what OrgMark's chip shows.
    expect(BRAND_MARK_FALLBACK_INITIALS).toBe("O");
    expect(resolveBrandIcon(null, "   ", { generate: false }).initials).toBe("O");
    expect(resolveBrandIcon(null, null, { generate: false }).initials).toBe("O");
  });

  it("draws the mark on a 64px canvas: a quarter-box round, the plate then the letters", () => {
    canvas = installCanvas();
    expect(BRAND_MARK_PX).toBe(64);
    const icon = resolveBrandIcon(null, "Alpha Rentals", { root: null, brandColor: "#0F766E" });

    expect(icon.kind).toBe("initials");
    expect(icon.src).toBe(
      expectedMarkUrl({
        initials: "AR",
        background: "#0F766E",
        // #0F766E is dark: white reads on it (5.47:1, from the preset table above).
        foreground: "#FFFFFF",
        fontFamily: BRAND_MARK_FONT_STACK,
      }),
    );

    const drawn = canvas.drawn.at(-1)!;
    expect(drawn.size).toBe(64);
    // `rounded-lg` is 8px on OrgMark's 32px badge: a quarter of the box, so 16 at 64.
    expect(drawn.rounded).toBe(true);
    expect(drawn.radius).toBe(16);
    // `text-[12px] font-semibold` in a 32px badge: 0.375 × 64 = 24px at 600.
    expect(drawn.fonts).toEqual([`600 24px ${BRAND_MARK_FONT_STACK}`]);
    expect(drawn.texts).toEqual(["AR"]);
    expect([drawn.align, drawn.baseline]).toEqual(["center", "middle"]);
  });

  it("picks the letter colour the brand can carry, light brand or dark", () => {
    canvas = installCanvas();
    // #FDE68A is pale: near-black reads on it, white does not.
    expect(brandMarkPaint(null, "#FDE68A")).toEqual({
      background: "#FDE68A",
      foreground: "#0A0A0A",
      fontFamily: BRAND_MARK_FONT_STACK,
    });
    expect(brandMarkPaint(null, "#0F766E").foreground).toBe("#FFFFFF");
    // No colour to hand: the same default the stylesheet would have fallen back to.
    expect(brandMarkPaint(null, null).background).toBe(V2_DEFAULT_BRAND_COLOR);
    expect(brandMarkPaint(null, "not a colour").background).toBe(V2_DEFAULT_BRAND_COLOR);
  });

  it("prefers the running page's own --primary, which is what the sidebar chip paints with", () => {
    const root = document.createElement("div");
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name: string) =>
        name === "--primary" ? " 175 77% 26% " : name === "--primary-foreground" ? "0 0% 3.9%" : "",
      fontFamily: "Manrope, sans-serif",
    } as unknown as CSSStyleDeclaration);

    // hsl(175 77% 26%) by hand: c = (1 − |0.52 − 1|) × 0.77 = 0.52 × 0.77 = 0.4004;
    // 175/60 = 2.9167, %2 = 0.9167, so x = 0.4004 × (1 − 0.08333) = 0.367033;
    // m = 0.26 − 0.2002 = 0.0598. Hue 175 is in [120,180): (r,g,b) = (0, c, x).
    // → 15.249, 117.351, 108.843 → 15, 117, 109 → #0F756D.
    // hsl(0 0% 3.9%) → 0.039 × 255 = 9.945 → 10 → #0A0A0A.
    expect(brandMarkPaint(root, "#FDE68A")).toEqual({
      background: "#0F756D",
      foreground: "#0A0A0A",
      fontFamily: "Manrope, sans-serif",
    });
  });

  it("hands back the same string for the same mark, so nothing refetches or flickers", () => {
    canvas = installCanvas();
    const paint = { background: "#2563EB", foreground: "#FFFFFF", fontFamily: BRAND_MARK_FONT_STACK };
    const once = brandMarkDataUrl("BL", paint);
    expect(once).toBe(brandMarkDataUrl("BL", paint));
    // A different tenant, or a different colour, is a different string.
    expect(brandMarkDataUrl("BM", paint)).not.toBe(once);
    expect(brandMarkDataUrl("BL", { ...paint, background: "#BE123C" })).not.toBe(once);
  });

  it("gives up and lets the platform icon stand where no canvas can be had", () => {
    // jsdom's own canvas: getContext('2d') is null and toDataURL() is "data:,".
    expect(resolveBrandIcon(null, "Ghost Rentals", { root: null, brandColor: "#0F766E" })).toEqual({
      kind: "initials",
      src: null,
      initials: "GR",
    });
    expect(PLATFORM_TAB_ICON).toBe("/icons/favicon-light.png");
  });

  it("does not draw before there is a DOM to draw on", () => {
    canvas = installCanvas();
    expect(resolveBrandIcon(null, "Alpha Rentals", { generate: false }).src).toBeNull();
    expect(canvas.drawn).toHaveLength(0);
  });

  /**
   * DARK MODE. `styles/v2-theme.css` writes the dark tokens as
   * `calc(var(--brand-h) - 2) calc(var(--brand-s) - 7%) 42%`, and a custom
   * property's COMPUTED value keeps the calc() unevaluated — it is resolved only
   * in the property that consumes it. Reading it as three plain numbers failed,
   * so every dark page fell back to the saved brand hex and the mark no longer
   * matched the sidebar chip beside it.
   */
  it("reads the dark tokens, whose calc() a computed custom property keeps", () => {
    const root = document.createElement("div");
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name: string) =>
        name === "--primary"
          ? "calc(248 - 2) calc(68% - 7%) 42%"
          : name === "--primary-foreground"
            ? "226 100% 97%"
            : "",
      fontFamily: "",
    } as unknown as CSSStyleDeclaration);

    // hsl(246 61% 42%) by hand: c = (1 − |0.84 − 1|) × 0.61 = 0.84 × 0.61 = 0.5124;
    // 246/60 = 4.1, %2 = 0.1, so x = 0.5124 × (1 − 0.9) = 0.05124;
    // m = 0.42 − 0.2562 = 0.1638. Hue 246 is in [240,300): (r,g,b) = (x, 0, c).
    // → 54.77, 41.769, 172.41 → 55, 42, 172 → #372AAC.
    // hsl(226 100% 97%) → c = (1 − 0.94) × 1 = 0.06; 226/60 = 3.7667, %2 = 1.7667,
    // x = 0.06 × (1 − 0.7667) = 0.014; m = 0.97 − 0.03 = 0.94. Hue 226 is in
    // [180,240): (r,g,b) = (0, x, c) → 239.7, 243.27, 255 → 240, 243, 255 → #F0F3FF.
    expect(brandMarkPaint(root, "#FDE68A")).toEqual({
      background: "#372AAC",
      foreground: "#F0F3FF",
      fontFamily: BRAND_MARK_FONT_STACK,
    });
  });

  it("never pairs the page's letter colour with a fallback plate", () => {
    // --primary-foreground is the readable text for --primary and for nothing
    // else. Taking it alone, while the plate fell back to a pale saved brand,
    // put ivory letters on a pale tile and the initials disappeared.
    const root = document.createElement("div");
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name: string) => (name === "--primary-foreground" ? "226 100% 97%" : "not a colour"),
      fontFamily: "",
    } as unknown as CSSStyleDeclaration);

    expect(brandMarkPaint(root, "#FDE68A")).toEqual({
      background: "#FDE68A",
      // Worked out for the plate actually used, not inherited from a page whose
      // own plate was rejected.
      foreground: "#0A0A0A",
      fontFamily: BRAND_MARK_FONT_STACK,
    });
  });

  it("does not mistake a token that carries an alpha for a colour", () => {
    const root = document.createElement("div");
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      // `--border` in dark v2 is `0 0% 100% / 10%`: four parts, not three.
      getPropertyValue: () => "0 0% 100% / 10%",
      fontFamily: "",
    } as unknown as CSSStyleDeclaration);
    expect(brandMarkPaint(root, "#0F766E").background).toBe("#0F766E");
  });
});
