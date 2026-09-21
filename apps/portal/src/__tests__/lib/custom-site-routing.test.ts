import { describe, expect, it } from "vitest";
import { readRepoSource } from "../helpers/edge-source";
// The booking app has no test runner of its own; its routing module is plain
// logic with no Next.js imports, so it is exercised from here.
import {
  CUSTOM_SITE_PREFIX,
  OLD_PAGE_TO_CUSTOM,
  customSitePathFor,
  isCustomSiteOn,
} from "../../../../booking/src/lib/custom-site-routing";

/**
 * A tenant with the custom site switched on in Super Admin has ONE website.
 * Its home page serves the custom site, every old-site page moves to the
 * custom site's version, and the booking funnel and customer portal — which
 * both sites share — keep answering where they are.
 * See apps/booking/src/lib/custom-site-routing.ts and apps/booking/src/middleware.ts.
 */

describe("old-site pages move to the custom site", () => {
  it.each([
    ["/fleet", "/custom-booking-page/fleet"],
    ["/about", "/custom-booking-page/about"],
    ["/contact", "/custom-booking-page/contact"],
    ["/faq", "/custom-booking-page/faq"],
    ["/promotions", "/custom-booking-page/promotions"],
    ["/testimonials", "/custom-booking-page/reviews"],
    ["/blog", "/custom-booking-page/blog"],
    ["/blog/winter-driving-tips", "/custom-booking-page/blog/winter-driving-tips"],
    ["/privacy", "/custom-booking-page/privacy"],
    ["/terms", "/custom-booking-page/terms"],
    ["/fleet/", "/custom-booking-page/fleet"],
    ["/fleet/some-old-deep-link", "/custom-booking-page/fleet"],
  ])("%s → %s", (from, to) => {
    expect(customSitePathFor(from)).toBe(to);
  });

  it("every target page exists in the custom site, so no redirect lands on a 404", () => {
    for (const page of new Set(Object.values(OLD_PAGE_TO_CUSTOM))) {
      expect(() =>
        readRepoSource(`apps/booking/src/app/(legacy)${CUSTOM_SITE_PREFIX}/${page}/page.tsx`),
      ).not.toThrow();
    }
  });
});

describe("the shared booking funnel and customer portal are never moved", () => {
  it.each([
    "/",
    "/portal",
    "/portal/bookings",
    "/portal/settings",
    "/checkout",
    "/booking-success",
    "/booking-cancelled",
    "/booking-pending",
    "/booking-enquiry-submitted",
    "/pay/abc123",
    "/offer/abc123",
    "/verify/abc123",
    "/auth/callback",
    "/apply",
    "/register",
    "/sms-opt-in",
    "/custom-booking-page",
    "/custom-booking-page/fleet",
    "/no-such-page",
  ])("%s stays where it is", (path) => {
    expect(customSitePathFor(path)).toBeNull();
  });
});

describe("both Super Admin switches must be on", () => {
  it.each([
    [{ booking_v2_enabled: true, custom_site_eligible: true }, true],
    [{ booking_v2_enabled: true, custom_site_eligible: false }, false],
    [{ booking_v2_enabled: false, custom_site_eligible: true }, false],
    [{ booking_v2_enabled: null, custom_site_eligible: null }, false],
    [null, false],
    [undefined, false],
  ])("%j → %s", (row, on) => {
    expect(isCustomSiteOn(row)).toBe(on);
  });
});

describe("wiring", () => {
  const middleware = readRepoSource("apps/booking/src/middleware.ts");

  it("the middleware moves old-site pages only for a tenant on the custom site", () => {
    expect(middleware).toContain("customSitePathFor(pathname)");
    expect(middleware).toMatch(/isTenantOnCustomSite\(tenantSlug\)[\s\S]{0,200}NextResponse\.redirect\(url, 307\)/);
    expect(middleware).toContain(".select('booking_v2_enabled, custom_site_eligible')");
  });

  it("Northwind's own design is decided first and is not affected", () => {
    expect(middleware.indexOf("route.action === 'new-design'")).toBeLessThan(
      middleware.indexOf("customSitePathFor(pathname)"),
    );
  });

  it("a custom-site booking stays in the booking after the email code, the old site is unchanged", () => {
    expect(readRepoSource("apps/booking/src/components/custom-booking-page/booking-bar.tsx")).toContain(
      "<MultiStepBookingWidget stayInBookingAfterVerify />",
    );
    expect(readRepoSource("apps/booking/src/components/home/legacy-home.tsx")).toContain("<MultiStepBookingWidget />");
    const dialog = readRepoSource("apps/booking/src/components/booking/AuthPromptDialog.tsx");
    expect(dialog).toMatch(/if \(stayInBookingAfterVerify\) \{\s*onSuccess\(\);\s*return;\s*\}\s*window\.location\.href = '\/portal';/);
  });

  it("the Test tenant is made eligible for the switch, and nothing else is changed", () => {
    const sql = readRepoSource("supabase/migrations/20260921120000_custom_site_eligible_test_tenant.sql");
    expect(sql).toMatch(/SET custom_site_eligible = true\s+WHERE slug = 'test';/);
    expect(sql).not.toMatch(/booking_v2_enabled\s*=/);
  });
});
