import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NEW_BOOKING_APP_TENANTS,
  getApplyUrl,
  getBookingBaseUrl,
  getOfferUrl,
  usesNewBookingApp,
} from "@/lib/booking-url";
import { getSiteV2BaseUrl } from "@/lib/site-v2-url";
import { bookingOriginFor } from "@/lib/booking-origin";
// apps/admin has no test runner, so its mirror is exercised from here.
import * as admin from "../../../../admin/lib/booking-site-url";
import { bookingUrlFor } from "../../../../admin/lib/sales-credentials";
import { readRepoSource } from "../helpers/edge-source";

/**
 * Northwind — and only Northwind — opens the NEW booking app (v2/apps/web).
 *
 * Every other tenant must get exactly the URL it got before, so the "before"
 * formulas are written out literally below rather than derived from the code
 * under test.
 */

const OTHER_TENANTS = ["revtekrentals", "fleetvana", "haris-square", "acme"];

/** The portal resolvers read window.location.hostname. */
const realLocation = Object.getOwnPropertyDescriptor(window, "location");
function setHostname(hostname: string) {
  Object.defineProperty(window, "location", {
    value: { ...window.location, hostname },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  if (realLocation) Object.defineProperty(window, "location", realLocation);
});

const DEV_PORTAL_HOST = "northwind.portal.localhost";
const PROD_PORTAL_HOST = "northwind.portal.drive-247.com";

describe("Northwind is identified by its stable slug", () => {
  it("the list is exactly ['northwind'] in both portal and admin", () => {
    expect(NEW_BOOKING_APP_TENANTS).toEqual(["northwind"]);
    expect(admin.NEW_BOOKING_APP_TENANTS).toEqual(["northwind"]);
  });

  it("matches the slug only — not the display name, not a tenant id", () => {
    expect(usesNewBookingApp("northwind")).toBe(true);
    expect(usesNewBookingApp("Northwind Rentals")).toBe(false);
    expect(usesNewBookingApp("6e5c544f-b374-451f-a662-360a634bff15")).toBe(false);
    expect(usesNewBookingApp(null)).toBe(false);
    expect(usesNewBookingApp(undefined)).toBe(false);
    expect(usesNewBookingApp("")).toBe(false);
  });
});

describe("A. Northwind in development → the new app on :4006", () => {
  it("portal", () => {
    setHostname(DEV_PORTAL_HOST);
    expect(getBookingBaseUrl("northwind")).toBe("http://northwind.localhost:4006");
  });

  it("admin click-through", () => {
    expect(admin.openBookingUrl("northwind", true)).toBe("http://northwind.localhost:4006");
  });

  it("never the old app's :3000", () => {
    setHostname(DEV_PORTAL_HOST);
    expect(getBookingBaseUrl("northwind")).not.toContain(":3000");
    expect(admin.openBookingUrl("northwind", true)).not.toContain(":3000");
  });
});

describe("B. Northwind in production → the configured new-app URL, never localhost", () => {
  const V2_PROD = "https://{slug}.v2-sites.example.com";

  it("uses NEXT_PUBLIC_SITE_V2_URL_TEMPLATE when it is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_V2_URL_TEMPLATE", V2_PROD);
    setHostname(PROD_PORTAL_HOST);
    expect(getBookingBaseUrl("northwind")).toBe("https://northwind.v2-sites.example.com");
    expect(admin.openBookingUrl("northwind", false)).toBe("https://northwind.v2-sites.example.com");
    expect(admin.publicBookingUrl("northwind")).toBe("https://northwind.v2-sites.example.com");
  });

  it("otherwise uses Northwind's own production host", () => {
    setHostname(PROD_PORTAL_HOST);
    expect(getBookingBaseUrl("northwind")).toBe("https://northwind.drive-247.com");
    expect(admin.openBookingUrl("northwind", false)).toBe("https://northwind.drive-247.com");
  });

  it("server-side rendering never produces localhost", () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, "window");
    // @ts-expect-error — simulate the server, where there is no window
    delete globalThis.window;
    try {
      expect(getBookingBaseUrl("northwind")).toBe("https://northwind.drive-247.com");
    } finally {
      if (saved) Object.defineProperty(globalThis, "window", saved);
    }
  });

  it("is the same address the portal's CMS preview of the new app uses", () => {
    setHostname(PROD_PORTAL_HOST);
    expect(getBookingBaseUrl("northwind")).toBe(getSiteV2BaseUrl("northwind"));
    setHostname(DEV_PORTAL_HOST);
    expect(getBookingBaseUrl("northwind")).toBe(getSiteV2BaseUrl("northwind"));
  });

  it("the public address shown to staff never contains localhost", () => {
    expect(admin.publicBookingUrl("northwind")).not.toMatch(/localhost/);
  });
});

describe("C. Every other tenant keeps its existing booking URL", () => {
  it.each(OTHER_TENANTS)("%s — portal, dev and prod", (slug) => {
    setHostname(`${slug}.portal.localhost`);
    expect(getBookingBaseUrl(slug)).toBe(`http://${slug}.localhost:3000`);
    expect(getApplyUrl(slug)).toBe(`http://${slug}.localhost:3000/apply`);
    expect(getOfferUrl(slug, "abc123")).toBe(`http://${slug}.localhost:3000/offer/abc123`);

    setHostname(`${slug}.portal.drive-247.com`);
    expect(getBookingBaseUrl(slug)).toBe(`https://${slug}.drive-247.com`);
  });

  it.each(OTHER_TENANTS)("%s — admin, dev and prod", (slug) => {
    expect(admin.openBookingUrl(slug, true)).toBe(`http://${slug}.localhost:3000`);
    expect(admin.openBookingUrl(slug, false)).toBe(`https://${slug}.drive-247.com`);
    expect(admin.publicBookingUrl(slug)).toBe(`https://${slug}.drive-247.com`);
    expect(bookingUrlFor(slug)).toBe(`https://${slug}.drive-247.com`);
  });
});

describe('D. "Open Booking Site" opens the new app for Northwind', () => {
  const page = readRepoSource("apps/admin/app/admin/(protected)/rentals/[id]/page.tsx");

  it("the button's href comes from tenantBookingUrl", () => {
    expect(page).toMatch(/href=\{tenantBookingUrl\(tenant\.slug\)\}[\s\S]{0,200}Open Booking Site/);
  });

  it("tenantBookingUrl is the shared resolver, not a local formula", () => {
    expect(page).toContain("const tenantBookingUrl = (slug: string) => openBookingUrl(slug, IS_DEV);");
    expect(page).not.toContain("`http://${slug}.localhost:3000`");
  });

  it("the Access URLs card shows the new app's public address", () => {
    expect(page).toContain("url: publicBookingUrl(tenant.slug),");
  });

  it("which resolves to the new app for Northwind in both environments", () => {
    expect(admin.openBookingUrl("northwind", true)).toBe("http://northwind.localhost:4006");
    expect(admin.openBookingUrl("northwind", false)).toBe("https://northwind.drive-247.com");
  });

  it("the preview link does not send Northwind to the old app's /custom-booking-page", () => {
    expect(page).toMatch(/usesNewBookingApp\(tenant\.slug\)\s*\?\s*tenantBookingUrl\(tenant\.slug\)/);
  });

  it("the portal's own booking-site links (first-rental tour, CMS preview) use the resolver", () => {
    const tour = readRepoSource("apps/portal/src/hooks/use-first-rental-tour.ts");
    expect(tour).toContain("bookingUrl: getBookingBaseUrl(tenant?.slug)");
    const cms = readRepoSource("apps/portal/src/app/(dashboard)/cms/new-website/page.tsx");
    expect(cms).toMatch(/usesNewBookingApp\(slug\)\s*\?\s*getBookingBaseUrl\(slug\)/);
  });
});

describe("E. No global booking URL changed", () => {
  it("the old booking app's dev port is still 3000 for everyone else", () => {
    setHostname("acme.portal.localhost");
    expect(getBookingBaseUrl("acme")).toBe("http://acme.localhost:3000");
  });

  it("the payment/checkout origin is untouched — including for Northwind", () => {
    // Checkout success/cancel pages only exist on the old app; payment logic is
    // out of scope, so this resolver deliberately does not know about Northwind.
    setHostname("northwind.portal.localhost");
    expect(bookingOriginFor("northwind")).toBe("http://northwind.localhost:3000");
    setHostname("northwind.portal.drive-247.com");
    expect(bookingOriginFor("northwind")).toBe("https://northwind.drive-247.com");
    expect(readRepoSource("apps/portal/src/lib/booking-origin.ts")).not.toMatch(/northwind|usesNewBookingApp/);
  });

  it("the new-app template never leaks to other tenants", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_V2_URL_TEMPLATE", "https://{slug}.v2-sites.example.com");
    setHostname("acme.portal.drive-247.com");
    expect(getBookingBaseUrl("acme")).toBe("https://acme.drive-247.com");
    expect(admin.publicBookingUrl("acme")).toBe("https://acme.drive-247.com");
    expect(admin.openBookingUrl("acme", false)).toBe("https://acme.drive-247.com");
    expect(admin.openBookingUrl("acme", true)).toBe("http://acme.localhost:3000");
  });

  it("new-tenant provisioning still hands out the standard address", () => {
    const dialog = readRepoSource("apps/admin/components/admin/CreateTenantDialog.tsx");
    expect(dialog).toContain("bookingUrl: `https://${slug}.drive-247.com`,");
  });
});

describe("F. No existing tenant-specific booking configuration was overwritten", () => {
  it("an explicit booking-origin override still wins for every tenant", () => {
    vi.stubEnv("NEXT_PUBLIC_BOOKING_BASE_URL", "https://book.example.com/");
    setHostname("acme.portal.localhost");
    expect(bookingOriginFor("acme")).toBe("https://book.example.com");
  });

  it("a custom booking base domain is still honoured", () => {
    vi.stubEnv("NEXT_PUBLIC_BOOKING_BASE_DOMAIN", "rentals.example.com");
    setHostname("acme.portal.rentals.example.com");
    expect(bookingOriginFor("acme")).toBe("https://acme.rentals.example.com");
  });

  it("the lean-tenant gate is a separate list and was not touched", () => {
    const lean = readRepoSource("apps/portal/src/lib/lean-areas.ts");
    expect(lean).not.toContain("NEW_BOOKING_APP_TENANTS");
    expect(readRepoSource("apps/portal/src/lib/booking-url.ts")).not.toMatch(/LEAN_TENANTS\s*[,)\]]|from ["']\.\/lean/);
  });

  it("the change is code-only: no migration or tenant-row write was added", () => {
    const src = readRepoSource("apps/portal/src/lib/booking-url.ts") + readRepoSource("apps/admin/lib/booking-site-url.ts");
    expect(src).not.toMatch(/supabase|\.from\(|\.update\(|\.insert\(/);
  });
});
