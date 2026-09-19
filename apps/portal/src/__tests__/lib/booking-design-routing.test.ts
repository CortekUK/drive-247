import { afterEach, describe, expect, it } from "vitest";
import { getBookingBaseUrl } from "@/lib/booking-url";
import { readRepoSource } from "../helpers/edge-source";
// The booking app has no test runner of its own; its routing module is plain
// logic with no Next.js imports, so it is exercised from here.
import {
  NEW_DESIGN_PREFIX,
  NEW_DESIGN_TENANTS,
  ORIGINAL_ONLY_SEGMENTS,
  routeBookingRequest,
  usesNewDesign,
} from "../../../../booking/src/lib/booking-design";

/**
 * One booking app on port 3000 serves every tenant. Northwind gets the NEW
 * design (moved in from v2/apps/web); every other tenant gets its ORIGINAL
 * design, unchanged. The decision is made per request from the tenant slug —
 * see apps/booking/src/lib/booking-design.ts and apps/booking/src/middleware.ts.
 */

const OTHER_TENANTS = ["revtekrentals", "rbvs", "globalmotiontransport", "acme"];
const DESIGN_PAGES = ["/", "/about", "/fleet", "/reviews", "/promotions", "/contact", "/login", "/signup", "/booking", "/booking/6bc8667b", "/portal", "/portal/bookings", "/no-such-page"];

const realLocation = Object.getOwnPropertyDescriptor(window, "location");
function setHostname(hostname: string) {
  Object.defineProperty(window, "location", {
    value: { ...window.location, hostname },
    configurable: true,
    writable: true,
  });
}
afterEach(() => {
  if (realLocation) Object.defineProperty(window, "location", realLocation);
});

const devPort = (pkgPath: string): number => {
  const dev: string = JSON.parse(readRepoSource(pkgPath)).scripts.dev;
  return Number(/--port[= ](\d+)/.exec(dev)?.[1]);
};

describe("Northwind is identified by its stable slug", () => {
  it("the new-design list is exactly ['northwind']", () => {
    expect(NEW_DESIGN_TENANTS).toEqual(["northwind"]);
  });

  it("matches the slug only — not the display name, not a database id", () => {
    expect(usesNewDesign("northwind")).toBe(true);
    expect(usesNewDesign("Northwind Rentals")).toBe(false);
    expect(usesNewDesign("6e5c544f-b374-451f-a662-360a634bff15")).toBe(false);
    expect(usesNewDesign(null)).toBe(false);
    expect(usesNewDesign(undefined)).toBe(false);
  });
});

describe("TEST 1 — Northwind on localhost:3000 gets the NEW design", () => {
  it("Northwind's booking address is on port 3000", () => {
    setHostname("northwind.portal.localhost");
    expect(getBookingBaseUrl("northwind")).toBe("http://northwind.localhost:3000");
  });

  it.each(DESIGN_PAGES)("%s is served from the new design (same address, rewritten)", (path) => {
    const route = routeBookingRequest("northwind", path);
    expect(route).toEqual({ action: "new-design", path: path === "/" ? NEW_DESIGN_PREFIX : `${NEW_DESIGN_PREFIX}${path}` });
  });

  it("pages only the original app has (payment links, invites, callbacks) stay on it", () => {
    for (const seg of ORIGINAL_ONLY_SEGMENTS) {
      expect(routeBookingRequest("northwind", `/${seg}`)).toEqual({ action: "original" });
      expect(routeBookingRequest("northwind", `/${seg}/abc`)).toEqual({ action: "original" });
    }
    expect(ORIGINAL_ONLY_SEGMENTS).toEqual(expect.arrayContaining(["checkout", "pay", "booking-success", "register", "verify", "auth"]));
  });
});

describe("TEST 2 & 3 — every other tenant on localhost:3000 keeps its ORIGINAL design", () => {
  it.each(OTHER_TENANTS)("%s: every page is the original, exactly as before", (slug) => {
    setHostname(`${slug}.portal.localhost`);
    expect(getBookingBaseUrl(slug)).toBe(`http://${slug}.localhost:3000`);
    for (const path of ["/", "/about", "/fleet", "/reviews", "/contact", "/portal", "/portal/bookings", "/checkout/x", "/booking-success", "/no-such-page"]) {
      expect(routeBookingRequest(slug, path), `${slug} ${path}`).toEqual({ action: "original" });
    }
  });

  it.each(OTHER_TENANTS)("%s: the retired /booking flow still goes home (moved from next.config.ts)", (slug) => {
    expect(routeBookingRequest(slug, "/booking")).toEqual({ action: "redirect-home" });
    expect(routeBookingRequest(slug, "/booking/step-2")).toEqual({ action: "redirect-home" });
    // Neighbouring routes are NOT caught, as before.
    expect(routeBookingRequest(slug, "/booking-success")).toEqual({ action: "original" });
    expect(routeBookingRequest(slug, "/booking-enquiry-submitted")).toEqual({ action: "original" });
  });

  it.each(OTHER_TENANTS)("%s: cannot reach the new design's pages", (slug) => {
    expect(routeBookingRequest(slug, NEW_DESIGN_PREFIX)).toEqual({ action: "not-found" });
    expect(routeBookingRequest(slug, `${NEW_DESIGN_PREFIX}/about`)).toEqual({ action: "not-found" });
  });

  it("a request with no tenant is treated like any other tenant", () => {
    expect(routeBookingRequest(null, "/")).toEqual({ action: "original" });
    expect(routeBookingRequest(null, `${NEW_DESIGN_PREFIX}/about`)).toEqual({ action: "not-found" });
  });
});

describe('TEST 4 & 5 — "Open Booking Site" uses the one normal booking address for every tenant', () => {
  const adminPage = readRepoSource("apps/admin/app/admin/(protected)/rentals/[id]/page.tsx");

  it("the super admin button opens {slug}.localhost:3000 in development, {slug}.drive-247.com in production", () => {
    expect(adminPage).toMatch(/href=\{tenantBookingUrl\(tenant\.slug\)\}[\s\S]{0,200}Open Booking Site/);
    expect(adminPage).toContain("IS_DEV ? `http://${slug}.localhost:3000` : `https://${slug}.drive-247.com`");
  });

  it("Northwind's address routes to the new design; everyone else's to the original", () => {
    setHostname("northwind.portal.localhost");
    expect(getBookingBaseUrl("northwind")).toBe("http://northwind.localhost:3000");
    expect(routeBookingRequest("northwind", "/").action).toBe("new-design");
    for (const slug of OTHER_TENANTS) {
      setHostname(`${slug}.portal.localhost`);
      expect(getBookingBaseUrl(slug)).toBe(`http://${slug}.localhost:3000`);
      expect(routeBookingRequest(slug, "/").action).toBe("original");
    }
  });

  it("production addresses are unchanged and never localhost", () => {
    setHostname("northwind.portal.drive-247.com");
    expect(getBookingBaseUrl("northwind")).toBe("https://northwind.drive-247.com");
    setHostname("acme.portal.drive-247.com");
    expect(getBookingBaseUrl("acme")).toBe("https://acme.drive-247.com");
  });
});

describe("TEST 6 — port 4006 is not part of the Northwind booking flow", () => {
  it("the booking app holds the new design itself", () => {
    const layout = readRepoSource("apps/booking/src/app/(northwind)/layout.tsx");
    expect(layout).toContain('from "@nw/site-css"');
    expect(readRepoSource("apps/booking/tsconfig.json")).toContain('"@nw/*"');
    expect(readRepoSource("apps/booking/src/middleware.ts")).toContain("routeBookingRequest(tenantSlug, pathname)");
  });

  it("nothing in the booking app's routing or the moved design points at 4006", () => {
    for (const file of [
      "apps/booking/src/middleware.ts",
      "apps/booking/src/lib/booking-design.ts",
      "apps/booking/src/app/(northwind)/layout.tsx",
      "apps/booking/src/northwind-site/lib/constants.ts",
      "apps/booking/src/northwind-site/site-css.ts",
      "apps/portal/src/lib/booking-url.ts",
    ]) {
      expect(readRepoSource(file), file).not.toMatch(/4006/);
    }
  });

  it("the new design's stylesheet is served by the booking app itself", () => {
    const href = /NORTHWIND_SITE_CSS = "([^"]+)"/.exec(readRepoSource("apps/booking/src/northwind-site/site-css.ts"))?.[1];
    expect(href).toMatch(/^\/nw-assets\/site\.[0-9a-f]+\.css$/);
    expect(readRepoSource(`apps/booking/public${href}`).length).toBeGreaterThan(50_000);
  });
});

describe("TEST 7 — port 4001 is not used", () => {
  it("the booking app runs on 3000 and no app declares 4001", () => {
    expect(devPort("apps/booking/package.json")).toBe(3000);
    for (const app of ["admin", "bonzah", "booking", "portal", "web"]) {
      expect(devPort(`apps/${app}/package.json`), app).not.toBe(4001);
    }
  });

  it("booking links in the portal and super admin point at 3000", () => {
    for (const file of ["apps/portal/src/lib/booking-url.ts", "apps/portal/src/lib/booking-origin.ts"]) {
      const src = readRepoSource(file);
      expect(src, file).not.toMatch(/4001/);
      expect(src, file).toMatch(/3000/);
    }
  });
});

describe("The two designs cannot restyle each other", () => {
  it("the original design's Tailwind build excludes the new design's routes", () => {
    expect(readRepoSource("apps/booking/tailwind.config.ts")).toContain("'!./src/app/[(]northwind[)]/**'");
  });

  it("each design has its own root layout, and only the new one links the new stylesheet", () => {
    expect(readRepoSource("apps/booking/src/app/(legacy)/layout.tsx")).not.toMatch(/nw-assets|northwind-site|@nw\//);
    expect(readRepoSource("apps/booking/src/app/(legacy)/layout.tsx")).toContain("import './globals.css';");
    expect(readRepoSource("apps/booking/src/app/(northwind)/layout.tsx")).toContain("<link rel=\"stylesheet\" href={NORTHWIND_SITE_CSS} />");
  });

  it("unknown addresses get the original design's 404 with a real 404 status", () => {
    expect(readRepoSource("apps/booking/next.config.ts")).toContain("globalNotFound: true");
    expect(readRepoSource("apps/booking/src/app/global-not-found.tsx")).toContain("<LegacyNotFound />");
  });
});
