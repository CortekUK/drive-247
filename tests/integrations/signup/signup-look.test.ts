import { readBrandColor, readSiteTheme, SIGNUP_BRAND_COLORS } from "../../../supabase/functions/_shared/signup-look";
import {
  DEFAULT_BRAND_COLOR,
  DEFAULT_SITE_THEME,
  isBrandColor,
  SIGNUP_BRAND_COLORS as FORM_COLORS,
} from "../../../apps/web/src/lib/signup-look";

// The look picked on the signup's business page (2026-11-23): the form offers
// these colours, signup-provision accepts only these.
describe("signup look: colour and theme", () => {
  it("offers exactly the colours the build accepts, in the same order", () => {
    expect(FORM_COLORS.map((c) => c.hex)).toEqual([...SIGNUP_BRAND_COLORS]);
  });

  it("starts on the v2 default colour and a dark booking site", () => {
    expect(DEFAULT_BRAND_COLOR).toBe("#442DD7");
    expect(DEFAULT_SITE_THEME).toBe("dark");
  });

  it("accepts an offered colour in any case, and nothing else", () => {
    expect(readBrandColor("#0f766e")).toBe("#0F766E");
    expect(readBrandColor("#123456")).toBeNull();
    expect(readBrandColor("teal")).toBeNull();
    expect(readBrandColor(undefined)).toBeNull();
    expect(isBrandColor("#be123c")).toBe(true);
    expect(isBrandColor("#ffffff")).toBe(false);
  });

  it("takes light or dark only; the locked `_only` modes stay a Settings choice", () => {
    expect(readSiteTheme("light")).toBe("light");
    expect(readSiteTheme("dark")).toBe("dark");
    expect(readSiteTheme("dark_only")).toBeNull();
    expect(readSiteTheme(1)).toBeNull();
  });
});
