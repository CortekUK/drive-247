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
  containInSquare,
  fitWithinEdge,
  LARGE_LOGO_ACCEPT,
  LOGO_MAX_BYTES,
  logoFileProblem,
  logoFormatOf,
  logoSizeProblem,
  parseSvgSize,
  SMALL_LOGO_ACCEPT,
  uploadLogoBlob,
  withSvgSize,
} from "@/lib/appearance/logo";
import { V2_BRAND_PRESETS, V2_DEFAULT_BRAND_COLOR } from "@/lib/appearance/presets";
import { judgeBrandColor } from "@/lib/appearance/color";

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

  it("small logo: at least 128 px a side, and square within 0.9 to 1.1", () => {
    expect(logoSizeProblem("small", { width: 128, height: 128, vector: false })).toBeNull();
    expect(logoSizeProblem("small", { width: 128, height: 127, vector: false })?.kind).toBe("too-small");
    // 512 / 569 = 0.8998, just under 0.9; 512 / 568 = 0.9014, just over.
    expect(logoSizeProblem("small", { width: 512, height: 569, vector: false })?.kind).toBe("not-square");
    expect(logoSizeProblem("small", { width: 512, height: 568, vector: false })).toBeNull();
    // 1.1 × 500 = 550 exactly is allowed; 551 / 500 = 1.102 is not.
    expect(logoSizeProblem("small", { width: 550, height: 500, vector: false })).toBeNull();
    expect(logoSizeProblem("small", { width: 551, height: 500, vector: false })?.kind).toBe("not-square");
    // An SVG has no pixel minimum, but its shape still counts.
    expect(logoSizeProblem("small", { width: 16, height: 16, vector: true })).toBeNull();
    expect(logoSizeProblem("small", { width: 32, height: 16, vector: true })?.kind).toBe("not-square");
  });

  it("large logo: at least 400 × 100 px, between 1:1 and 8:1", () => {
    expect(logoSizeProblem("large", { width: 400, height: 100, vector: false })).toBeNull(); // 4:1
    expect(logoSizeProblem("large", { width: 400, height: 400, vector: false })).toBeNull(); // 1:1
    expect(logoSizeProblem("large", { width: 800, height: 100, vector: false })).toBeNull(); // 8:1
    expect(logoSizeProblem("large", { width: 801, height: 100, vector: false })?.kind).toBe("too-wide");
    expect(logoSizeProblem("large", { width: 400, height: 99, vector: false })?.kind).toBe("too-small");
    expect(logoSizeProblem("large", { width: 400, height: 401, vector: false })?.kind).toBe("too-tall");
    expect(logoSizeProblem("large", { width: 120, height: 30, vector: true })).toBeNull();
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
  it("are exactly Indigo (the default), Blue, Teal, Rose and Graphite", () => {
    expect(V2_DEFAULT_BRAND_COLOR).toBe("#442DD7");
    expect(V2_BRAND_PRESETS.map((p) => [p.name, p.hex])).toEqual([
      ["Indigo", "#442DD7"],
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
