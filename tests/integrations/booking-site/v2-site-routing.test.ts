import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  NEW_DESIGN_V2_PREFIX,
  routeBookingRequest,
  tenantGetsV2Site,
} from "../../../apps/booking/src/lib/booking-design";

const repo = resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(join(repo, rel), "utf8");

const v2Stripe = { portal_experience: "v2", payment_provider: "stripe" };

describe("which companies get the v2 booking site", () => {
  it("gives it to a company on the v2 portal", () => {
    expect(tenantGetsV2Site(v2Stripe)).toBe(true);
  });

  it("leaves v1 portal companies on the site they have", () => {
    expect(tenantGetsV2Site({ portal_experience: "v1", payment_provider: "stripe" })).toBe(false);
    expect(tenantGetsV2Site({ payment_provider: "stripe" })).toBe(false);
  });

  it("keeps Square companies off it, because v2 checkout only takes Stripe", () => {
    expect(tenantGetsV2Site({ portal_experience: "v2", payment_provider: "square" })).toBe(false);
  });

  it("keeps a company on its custom site", () => {
    expect(tenantGetsV2Site({ ...v2Stripe, booking_v2_enabled: true, custom_site_eligible: true })).toBe(false);
    expect(tenantGetsV2Site({ ...v2Stripe, booking_v2_enabled: true, custom_site_eligible: false })).toBe(true);
  });

  it("serves the original site when the company cannot be read", () => {
    expect(tenantGetsV2Site(null)).toBe(false);
    expect(tenantGetsV2Site(undefined)).toBe(false);
  });
});

describe("routing a v2 portal company", () => {
  it.each([
    ["/", NEW_DESIGN_V2_PREFIX],
    ["/fleet", `${NEW_DESIGN_V2_PREFIX}/fleet`],
    ["/booking/abc", `${NEW_DESIGN_V2_PREFIX}/booking/abc`],
    ["/contact", `${NEW_DESIGN_V2_PREFIX}/contact`],
    ["/portal/bookings", `${NEW_DESIGN_V2_PREFIX}/portal-v2/bookings`],
  ])("opens %s from the v2 site", (path, expected) => {
    expect(routeBookingRequest("neema-cars", path, "v1", true)).toEqual({ action: "new-design", path: expected });
  });

  it.each(["/pay/abc", "/checkout", "/booking-success", "/verify/abc", "/manifest.webmanifest"])(
    "keeps the link %s working on the original pages",
    (path) => {
      expect(routeBookingRequest("neema-cars", path, "v1", true)).toEqual({ action: "original" });
    },
  );
});

describe("everyone else is unchanged", () => {
  it("leaves a v1 company on the original site", () => {
    expect(routeBookingRequest("globalmotiontransport", "/", "v1", false)).toEqual({ action: "original" });
    expect(routeBookingRequest("globalmotiontransport", "/fleet", "v1", false)).toEqual({ action: "original" });
    expect(routeBookingRequest("globalmotiontransport", "/booking", "v1", false)).toEqual({ action: "redirect-home" });
  });

  it("keeps Northwind on the v2 site with or without the portal flag", () => {
    const expected = { action: "new-design", path: `${NEW_DESIGN_V2_PREFIX}/fleet` };
    expect(routeBookingRequest("northwind", "/fleet", "v1", false)).toEqual(expected);
    expect(routeBookingRequest("northwind", "/fleet", "v1", true)).toEqual(expected);
  });
});

describe("the v2 site is right for any company", () => {
  const contact = read("apps/booking/src/northwind-site/components/forms/contact-form-logic.ts");

  it("really sends contact messages to the company", () => {
    expect(contact).toContain('supabase.functions.invoke("send-contact-email"');
    expect(contact).toContain("adminEmail: recipient.email");
    expect(contact).not.toContain("console.log");
  });

  it("does not offer another fleet's cars on the contact form", () => {
    expect(contact).not.toMatch(/Porsche|Rolls-Royce|Aston Martin/);
  });

  it("names the rental company on the card authorisation", () => {
    const panel = read("apps/booking/src/northwind-site/site-v2/booking/payment-panel.tsx");
    expect(panel).toContain('tenant?.app_name || tenant?.company_name || "the rental company"');
    expect(panel).not.toContain(">Drive247</strong>");
  });
});
