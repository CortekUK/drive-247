import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NEW_BOOKING_APP_DEV_URL,
  NEW_BOOKING_APP_TENANTS,
  OLD_BOOKING_APP_DEV_PORT,
  getApplyUrl,
  getBookingBaseUrl,
  getOfferUrl,
  usesNewBookingApp,
} from "@/lib/booking-url";
import { SITE_V2_DEV_PORT, getSiteV2BaseUrl } from "@/lib/site-v2-url";
import { bookingOriginFor } from "@/lib/booking-origin";
// apps/admin has no test runner, so its mirror is exercised from here.
import * as admin from "../../../../admin/lib/booking-site-url";
import { bookingUrlFor } from "../../../../admin/lib/sales-credentials";
import { readRepoSource } from "../helpers/edge-source";

/**
 * Northwind — and only Northwind — opens the NEW booking app (v2/apps/web),
 * which runs on port 3000 in development. The OLD booking app (apps/booking)
 * runs on 4001 and keeps serving every other tenant.
 *
 * The expected URLs are written out literally rather than derived from the
 * code under test.
 */

const OTHER_TENANTS = ["revtekrentals", "fleetvana", "haris-square", "acme"];

/** The portal resolvers read window.location.hostname. */
const realLocation = Object.getOwnPropertyDescriptor(window, "location");
function setHostname(hostname: string) {
  Object.defineProperty(window, "location", {
    value: { ...window.location, hostname, protocol: "http:" },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  if (realLocation) Object.defineProperty(window, "location", realLocation);
});

const devPort = (pkgPath: string): number => {
  const dev: string = JSON.parse(readRepoSource(pkgPath)).scripts.dev;
  return Number(/--port[= ](\d+)/.exec(dev)?.[1]);
};

const NEW_APP_ENV_DEV = readRepoSource("v2/apps/web/.env.development");
const envValue = (file: string, key: string): string | undefined =>
  new RegExp(`^${key}=(.*)$`, "m").exec(file)?.[1]?.trim();

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

describe("1. Northwind's local booking URL is http://localhost:3000", () => {
  it("portal", () => {
    setHostname("northwind.portal.localhost");
    expect(getBookingBaseUrl("northwind")).toBe("http://localhost:3000");
  });

  it("super admin", () => {
    expect(admin.openBookingUrl("northwind", true)).toBe("http://localhost:3000");
  });

  it("portal and admin agree on the address", () => {
    expect(NEW_BOOKING_APP_DEV_URL).toBe("http://localhost:3000");
    expect(admin.NEW_BOOKING_APP_DEV_URL).toBe(NEW_BOOKING_APP_DEV_URL);
  });
});

describe('2. Northwind "Open Booking Site" opens the NEW booking app', () => {
  const page = readRepoSource("apps/admin/app/admin/(protected)/rentals/[id]/page.tsx");

  it("the button's href comes from tenantBookingUrl, which is the shared resolver", () => {
    expect(page).toMatch(/href=\{tenantBookingUrl\(tenant\.slug\)\}[\s\S]{0,200}Open Booking Site/);
    expect(page).toContain("const tenantBookingUrl = (slug: string) => openBookingUrl(slug, IS_DEV);");
  });

  it("port 3000 is the new app's own dev port", () => {
    expect(devPort("v2/apps/web/package.json")).toBe(3000);
    expect(SITE_V2_DEV_PORT).toBe(3000);
    expect(new URL(NEW_BOOKING_APP_DEV_URL).port).toBe(String(devPort("v2/apps/web/package.json")));
  });

  it("plain localhost:3000 is Northwind on the new app (its development default tenant)", () => {
    expect(envValue(NEW_APP_ENV_DEV, "NEXT_PUBLIC_DEFAULT_TENANT_SLUG")).toBe("northwind");
    expect(NEW_BOOKING_APP_TENANTS).toContain(envValue(NEW_APP_ENV_DEV, "NEXT_PUBLIC_DEFAULT_TENANT_SLUG"));
  });

  it("the preview link does not send Northwind to the old app's /custom-booking-page", () => {
    expect(page).toMatch(/usesNewBookingApp\(tenant\.slug\)\s*\?\s*tenantBookingUrl\(tenant\.slug\)/);
  });

  it("the portal's own booking-site links (first-rental tour, CMS preview) use the resolver", () => {
    expect(readRepoSource("apps/portal/src/hooks/use-first-rental-tour.ts")).toContain(
      "bookingUrl: getBookingBaseUrl(tenant?.slug)",
    );
    expect(readRepoSource("apps/portal/src/app/(dashboard)/cms/new-website/page.tsx")).toMatch(
      /usesNewBookingApp\(slug\)\s*\?\s*getBookingBaseUrl\(slug\)/,
    );
  });
});

describe("3. Another tenant does NOT resolve to localhost:3000", () => {
  it.each(OTHER_TENANTS)("%s — every local resolver", (slug) => {
    setHostname(`${slug}.portal.localhost`);
    const urls = [
      getBookingBaseUrl(slug),
      getApplyUrl(slug),
      getOfferUrl(slug, "abc123"),
      bookingOriginFor(slug),
      admin.openBookingUrl(slug, true),
    ];
    for (const url of urls) expect(url).not.toMatch(/localhost:3000/);
  });

  it("the CMS preview for other tenants is not on :3000", () => {
    const cms = readRepoSource("apps/portal/src/app/(dashboard)/cms/new-website/page.tsx");
    expect(cms).not.toContain("`http://${slug}.localhost:3000`");
    expect(cms).toContain("`http://${slug}.localhost:${OLD_BOOKING_APP_DEV_PORT}`");
  });

  it("the hold checkout's local return address is not on :3000", () => {
    const hold = readRepoSource("apps/portal/src/components/shared/dialogs/add-hold-dialog.tsx");
    expect(hold).toContain('.replace(":3001", ":4001")');
    expect(hold).not.toContain('":3000"');
  });
});

describe("4. Other tenants keep their existing booking site", () => {
  it("the old booking app's port is its own package.json port", () => {
    expect(OLD_BOOKING_APP_DEV_PORT).toBe(devPort("apps/booking/package.json"));
    expect(admin.OLD_BOOKING_APP_DEV_PORT).toBe(devPort("apps/booking/package.json"));
    expect(OLD_BOOKING_APP_DEV_PORT).toBe(4001);
  });

  it.each(OTHER_TENANTS)("%s — portal: old app in dev, unchanged production URL", (slug) => {
    setHostname(`${slug}.portal.localhost`);
    expect(getBookingBaseUrl(slug)).toBe(`http://${slug}.localhost:4001`);
    expect(getApplyUrl(slug)).toBe(`http://${slug}.localhost:4001/apply`);
    expect(getOfferUrl(slug, "abc123")).toBe(`http://${slug}.localhost:4001/offer/abc123`);
    expect(bookingOriginFor(slug)).toBe(`http://${slug}.localhost:4001`);

    setHostname(`${slug}.portal.drive-247.com`);
    expect(getBookingBaseUrl(slug)).toBe(`https://${slug}.drive-247.com`);
    expect(bookingOriginFor(slug)).toBe(`https://${slug}.drive-247.com`);
  });

  it.each(OTHER_TENANTS)("%s — super admin: old app in dev, unchanged production URL", (slug) => {
    expect(admin.openBookingUrl(slug, true)).toBe(`http://${slug}.localhost:4001`);
    expect(admin.openBookingUrl(slug, false)).toBe(`https://${slug}.drive-247.com`);
    expect(admin.publicBookingUrl(slug)).toBe(`https://${slug}.drive-247.com`);
    expect(bookingUrlFor(slug)).toBe(`https://${slug}.drive-247.com`);
  });

  it("other tenants still reach the new app's CMS editor by their own subdomain", () => {
    setHostname("acme.portal.localhost");
    expect(getSiteV2BaseUrl("acme")).toBe("http://acme.localhost:3000");
  });
});

describe("5. The new Northwind app is configured to start on port 3000", () => {
  it("its dev script binds 3000, and the port-freeing script agrees", () => {
    expect(readRepoSource("v2/apps/web/package.json")).toContain('"dev": "next dev --port 3000"');
    expect(readRepoSource("package.json")).toContain('"dev:site": "node scripts/kill-dev-ports.mjs @drive247/web && npm --prefix v2/apps/web run dev"');
  });

  it("nothing still points at the new app's old port, 4006", () => {
    for (const file of [
      "v2/apps/web/package.json",
      "apps/portal/src/lib/site-v2-url.ts",
      "apps/portal/src/lib/booking-url.ts",
      "apps/admin/lib/booking-site-url.ts",
    ]) {
      expect(readRepoSource(file), file).not.toContain("4006");
    }
  });
});

describe("6. The old booking app no longer claims port 3000", () => {
  it("no app other than the new one declares 3000", () => {
    const apps = ["admin", "bonzah", "booking", "portal", "web"];
    for (const app of apps) {
      expect(devPort(`apps/${app}/package.json`), app).not.toBe(3000);
    }
    expect(devPort("apps/booking/package.json")).toBe(4001);
  });

  it("the old app's local addresses in the portal point at 4001", () => {
    expect(readRepoSource("apps/portal/src/lib/booking-origin.ts")).toContain('const LOCAL_BOOKING_PORT = "4001";');
  });
});

describe("7. No global booking configuration was changed by accident", () => {
  it("the new-app template never leaks to other tenants", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_V2_URL_TEMPLATE", "https://{slug}.v2-sites.example.com");
    setHostname("acme.portal.drive-247.com");
    expect(getBookingBaseUrl("acme")).toBe("https://acme.drive-247.com");
    expect(admin.publicBookingUrl("acme")).toBe("https://acme.drive-247.com");
    expect(admin.openBookingUrl("acme", false)).toBe("https://acme.drive-247.com");
    expect(admin.openBookingUrl("acme", true)).toBe("http://acme.localhost:4001");
  });

  it("an explicit booking-origin override and a custom base domain still win", () => {
    vi.stubEnv("NEXT_PUBLIC_BOOKING_BASE_URL", "https://book.example.com/");
    setHostname("acme.portal.localhost");
    expect(bookingOriginFor("acme")).toBe("https://book.example.com");
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_BOOKING_BASE_DOMAIN", "rentals.example.com");
    setHostname("acme.portal.rentals.example.com");
    expect(bookingOriginFor("acme")).toBe("https://acme.rentals.example.com");
  });

  it("Northwind's checkout pages stay on the old app, which is the only one that has them", () => {
    setHostname("northwind.portal.localhost");
    expect(bookingOriginFor("northwind")).toBe("http://northwind.localhost:4001");
    expect(readRepoSource("apps/portal/src/lib/booking-origin.ts")).not.toMatch(/northwind|usesNewBookingApp/);
  });

  it("the Northwind default tenant is development-only", () => {
    // .env.development is read by `next dev` only; and constants.ts ignores the
    // value unless NODE_ENV is development or the build is a Vercel preview.
    const constants = readRepoSource("v2/apps/web/src/lib/constants.ts");
    expect(constants).toMatch(/process\.env\.NODE_ENV === "development" \|\|[\s\S]*?NEXT_PUBLIC_VERCEL_ENV === "preview"\s*\?\s*process\.env\.NEXT_PUBLIC_DEFAULT_TENANT_SLUG \|\| null\s*:\s*null;/);
    expect(NEW_APP_ENV_DEV).not.toMatch(/SUPABASE|KEY|SECRET|TOKEN/);
  });

  it("new-tenant provisioning and the lean gate are untouched", () => {
    expect(readRepoSource("apps/admin/components/admin/CreateTenantDialog.tsx")).toContain(
      "bookingUrl: `https://${slug}.drive-247.com`,",
    );
    expect(readRepoSource("apps/portal/src/lib/lean-areas.ts")).not.toContain("NEW_BOOKING_APP_TENANTS");
  });

  it("the change is code and config only: no database write", () => {
    const src = readRepoSource("apps/portal/src/lib/booking-url.ts") + readRepoSource("apps/admin/lib/booking-site-url.ts");
    expect(src).not.toMatch(/supabase|\.from\(|\.update\(|\.insert\(/);
  });
});

describe("8. Northwind's production URL is environment-aware and never localhost", () => {
  const V2_PROD = "https://{slug}.v2-sites.example.com";

  it("uses NEXT_PUBLIC_SITE_V2_URL_TEMPLATE when it is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_V2_URL_TEMPLATE", V2_PROD);
    setHostname("northwind.portal.drive-247.com");
    expect(getBookingBaseUrl("northwind")).toBe("https://northwind.v2-sites.example.com");
    expect(admin.openBookingUrl("northwind", false)).toBe("https://northwind.v2-sites.example.com");
    expect(admin.publicBookingUrl("northwind")).toBe("https://northwind.v2-sites.example.com");
  });

  it("otherwise uses Northwind's own production host", () => {
    setHostname("northwind.portal.drive-247.com");
    expect(getBookingBaseUrl("northwind")).toBe("https://northwind.drive-247.com");
    expect(admin.openBookingUrl("northwind", false)).toBe("https://northwind.drive-247.com");
    expect(admin.publicBookingUrl("northwind")).toBe("https://northwind.drive-247.com");
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

  it("the Access URLs card shows the public address, never localhost", () => {
    const page = readRepoSource("apps/admin/app/admin/(protected)/rentals/[id]/page.tsx");
    expect(page).toContain("url: publicBookingUrl(tenant.slug),");
    expect(admin.publicBookingUrl("northwind")).not.toMatch(/localhost/);
  });
});
